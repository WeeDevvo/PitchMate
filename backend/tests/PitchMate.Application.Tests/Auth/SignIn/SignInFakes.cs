using System.Security.Cryptography;
using System.Text;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.SignIn;

// Hand-written, in-memory test doubles for the email + password sign-in use case
// (task 11.1, SignInWithPasswordHandler). These are real fakes — dictionaries, lists, and a
// genuine SHA-256 transform, never a database and never a mocking-framework stub — so the
// handler can be exercised as a pure Application unit test. Every type here is prefixed
// "SignIn" and lives in the Auth/SignIn folder so it never collides with fakes authored by
// sibling test tasks.

/// <summary>
/// The one-way hash used to persist a refresh-token secret in these tests. A real SHA-256
/// over the plaintext mirrors the production <c>Sha256SecretHasher</c>: it is deterministic
/// (so the stored hash can be recomputed from the returned plaintext) yet contains none of
/// the plaintext, so a test can assert the secret never appears in any persisted field.
/// </summary>
internal static class SignInRefreshHashing
{
    public static string Hash(string plaintext)
    {
        byte[] digest = SHA256.HashData(Encoding.UTF8.GetBytes(plaintext));
        return Convert.ToBase64String(digest);
    }
}

/// <summary>
/// A controllable <see cref="TimeProvider"/> anchored at a fixed instant so refresh-token
/// expiry is deterministic. Stands in for a FakeTimeProvider.
/// </summary>
internal sealed class SignInFakeClock(DateTimeOffset utcNow) : TimeProvider
{
    private readonly DateTimeOffset _utcNow = utcNow.ToUniversalTime();

    public override DateTimeOffset GetUtcNow() => _utcNow;
}

/// <summary>
/// A deterministic <see cref="IPasswordHasher"/> fake. A stored credential hash has the form
/// <c>pwhash::&lt;password&gt;</c>; verification succeeds exactly when the presented password
/// reproduces that marker. No real cryptography — these are pure Application-layer tests.
/// </summary>
internal sealed class SignInFakePasswordHasher : IPasswordHasher
{
    private const string Prefix = "pwhash::";

    public static string HashFor(string plaintext) => Prefix + plaintext;

    public string Hash(string plaintext)
    {
        ArgumentNullException.ThrowIfNull(plaintext);
        return Prefix + plaintext;
    }

    public PasswordVerification Verify(string? storedHash, string plaintext) =>
        storedHash == Prefix + plaintext ? PasswordVerification.Success : PasswordVerification.Failure;
}

/// <summary>
/// An <see cref="ITokenService"/> fake. <see cref="IssueAccessToken"/> mints a unique
/// signed-looking string with a fixed lifetime; <see cref="GenerateRefreshToken"/> yields a
/// fresh random plaintext each call, its SHA-256 hash (via <see cref="SignInRefreshHashing"/>),
/// and an expiry of the injected clock plus <see cref="RefreshTokenLifetime"/>. The most
/// recently issued refresh secret is captured so a test can compare what was returned to the
/// caller against what was persisted.
/// </summary>
internal sealed class SignInFakeTokenService(TimeProvider clock) : ITokenService
{
    public TimeSpan AccessTokenLifetime { get; init; } = TimeSpan.FromMinutes(15);

    public TimeSpan RefreshTokenLifetime { get; init; } = TimeSpan.FromDays(30);

    /// <summary>The refresh secret produced by the last <see cref="GenerateRefreshToken"/> call.</summary>
    public RefreshTokenSecret? LastRefreshSecret { get; private set; }

    public AccessTokenResult IssueAccessToken(User user)
    {
        ArgumentNullException.ThrowIfNull(user);
        DateTimeOffset expiresAt = clock.GetUtcNow() + AccessTokenLifetime;
        return new AccessTokenResult($"access-{user.Id:N}-{Guid.NewGuid():N}", expiresAt);
    }

    public AccessTokenValidation ValidateAccessToken(string? token) =>
        throw new NotSupportedException("Validation is not exercised by the sign-in use case.");

    public RefreshTokenSecret GenerateRefreshToken()
    {
        string plaintext = "refresh-" + Guid.NewGuid().ToString("N");
        DateTimeOffset expiresAt = clock.GetUtcNow() + RefreshTokenLifetime;
        var secret = new RefreshTokenSecret(plaintext, SignInRefreshHashing.Hash(plaintext), expiresAt);
        LastRefreshSecret = secret;
        return secret;
    }
}

/// <summary>
/// In-memory <see cref="IAuthIdentityRepository"/> resolving solely on the pair
/// (<see cref="AuthProvider"/>, providerUserId), eager-loading the credential as the
/// production repository does.
/// </summary>
internal sealed class SignInFakeAuthIdentityRepository : IAuthIdentityRepository
{
    private readonly List<AuthIdentity> _identities = [];

    public void Seed(AuthIdentity identity) => _identities.Add(identity);

    public Task<AuthIdentity?> FindByProviderKeyAsync(
        AuthProvider provider, string providerUserId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        AuthIdentity? match = _identities.FirstOrDefault(
            i => i.Provider == provider && i.ProviderUserId == providerUserId);
        return Task.FromResult(match);
    }

    public Task<IReadOnlyList<AuthIdentity>> ListForUserAsync(Guid userId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        IReadOnlyList<AuthIdentity> list = _identities.Where(i => i.UserId == userId).ToList();
        return Task.FromResult(list);
    }

    public Task AddAsync(AuthIdentity identity, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        _identities.Add(identity);
        return Task.CompletedTask;
    }

    public void Remove(AuthIdentity identity) => _identities.Remove(identity);
}

/// <summary>In-memory <see cref="IUserRepository"/> exposing the by-id lookup the handler needs.</summary>
internal sealed class SignInFakeUserRepository : IUserRepository
{
    private readonly Dictionary<Guid, User> _byId = new();

    public void Seed(User user) => _byId[user.Id] = user;

    public Task<User?> GetByIdAsync(Guid id, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        _byId.TryGetValue(id, out User? user);
        return Task.FromResult(user);
    }

    public Task AddAsync(User user, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        _byId[user.Id] = user;
        return Task.CompletedTask;
    }
}

/// <summary>
/// In-memory <see cref="IRefreshTokenStore"/> capturing every persisted <see cref="RefreshToken"/>
/// so a test can inspect exactly what was written to the revocation store.
/// </summary>
internal sealed class SignInFakeRefreshTokenStore : IRefreshTokenStore
{
    private readonly List<RefreshToken> _tokens = [];

    /// <summary>Every refresh token persisted so far, in insertion order.</summary>
    public IReadOnlyList<RefreshToken> Tokens => _tokens;

    public Task AddAsync(RefreshToken token, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        _tokens.Add(token);
        return Task.CompletedTask;
    }

    public Task<RefreshToken?> FindByHashAsync(string tokenHash, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(_tokens.FirstOrDefault(t => t.TokenHash == tokenHash));
    }

    public Task<IReadOnlyList<RefreshToken>> ListFamilyAsync(Guid tokenFamilyId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        IReadOnlyList<RefreshToken> family = _tokens.Where(t => t.TokenFamilyId == tokenFamilyId).ToList();
        return Task.FromResult(family);
    }

    public Task<IReadOnlyList<RefreshToken>> ListActiveForUserAsync(Guid userId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        IReadOnlyList<RefreshToken> active = _tokens.Where(t => t.UserId == userId).ToList();
        return Task.FromResult(active);
    }
}

/// <summary>An <see cref="IUnitOfWork"/> fake that counts commits, so a test can confirm a save occurred.</summary>
internal sealed class SignInFakeUnitOfWork : IUnitOfWork
{
    public int SaveCount { get; private set; }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        SaveCount++;
        return Task.FromResult(0);
    }
}

/// <summary>
/// A no-op <see cref="ISignInAttemptTracker"/>; the lockout gate is disabled for this property,
/// so the handler never consults it, but the dependency must still be supplied.
/// </summary>
internal sealed class SignInFakeAttemptTracker : ISignInAttemptTracker
{
    public Task<int> CountFailedAttemptsAsync(string normalisedEmail, DateTimeOffset since, CancellationToken ct) =>
        Task.FromResult(0);

    public Task RecordFailedAttemptAsync(string normalisedEmail, DateTimeOffset at, CancellationToken ct) =>
        Task.CompletedTask;

    public Task ClearFailedAttemptsAsync(string normalisedEmail, CancellationToken ct) =>
        Task.CompletedTask;
}
