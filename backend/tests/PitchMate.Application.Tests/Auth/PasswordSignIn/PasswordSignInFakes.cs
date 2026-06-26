using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.PasswordSignIn;

// Hand-written, in-memory test doubles for SignInWithPasswordHandler (task 11.2). These are
// real fakes — lists and dictionaries, never a database and never a mocking-framework stub —
// so the handler can be exercised as a pure Application unit test. Every type here is prefixed
// "PasswordSignIn" and lives in the Auth/PasswordSignIn folder so it never collides with the
// fakes authored by sibling test tasks.

/// <summary>
/// A controllable <see cref="TimeProvider"/> anchored at a fixed instant so the handler's clock
/// reads are deterministic. Stands in for a FakeTimeProvider.
/// </summary>
internal sealed class PasswordSignInFakeClock(DateTimeOffset utcNow) : TimeProvider
{
    private readonly DateTimeOffset _utcNow = utcNow.ToUniversalTime();

    /// <summary>A stable default instant used when a test does not care about the exact clock value.</summary>
    public static DateTimeOffset DefaultNow { get; } = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    public PasswordSignInFakeClock() : this(DefaultNow)
    {
    }

    public override DateTimeOffset GetUtcNow() => _utcNow;
}

/// <summary>
/// A deterministic <see cref="IPasswordHasher"/> fake. <see cref="Hash"/> prefixes the plaintext
/// (no real cryptography — these are pure Application-layer tests); <see cref="Verify"/> reports
/// success only when the stored hash is exactly the hash of the supplied plaintext. It records
/// every verification so a test can confirm the fixed-time verification was (or was not) performed.
/// </summary>
internal sealed class PasswordSignInPasswordHasherFake : IPasswordHasher
{
    private const string Prefix = "hashed:";

    /// <summary>The stored hashes passed to <see cref="Verify"/>, in call order.</summary>
    public List<string?> VerifiedStoredHashes { get; } = [];

    public string Hash(string plaintext)
    {
        ArgumentNullException.ThrowIfNull(plaintext);
        return Prefix + plaintext;
    }

    public PasswordVerification Verify(string? storedHash, string plaintext)
    {
        VerifiedStoredHashes.Add(storedHash);
        return storedHash == Prefix + plaintext
            ? PasswordVerification.Success
            : PasswordVerification.Failure;
    }
}

/// <summary>
/// An <see cref="ITokenService"/> fake that records every issuance so a test can assert that a
/// failed sign-in issues nothing. <see cref="IssueAccessToken"/> and
/// <see cref="GenerateRefreshToken"/> mint placeholder secrets; neither is reached on a failure path.
/// </summary>
internal sealed class PasswordSignInTokenServiceFake(TimeProvider clock) : ITokenService
{
    private const string SecretHashPrefix = "sechash::";

    public TimeSpan AccessTokenLifetime { get; init; } = TimeSpan.FromMinutes(15);

    public TimeSpan RefreshTokenLifetime { get; init; } = TimeSpan.FromDays(30);

    /// <summary>The user ids access tokens were issued for, in call order.</summary>
    public List<Guid> IssuedFor { get; } = [];

    /// <summary>The number of refresh-token secrets generated.</summary>
    public int RefreshTokensGenerated { get; private set; }

    public AccessTokenResult IssueAccessToken(User user)
    {
        ArgumentNullException.ThrowIfNull(user);
        IssuedFor.Add(user.Id);
        DateTimeOffset expiresAt = clock.GetUtcNow() + AccessTokenLifetime;
        return new AccessTokenResult($"access-{user.Id:N}-{Guid.NewGuid():N}", expiresAt);
    }

    public AccessTokenValidation ValidateAccessToken(string? token) =>
        throw new NotSupportedException("Validation is not exercised by password sign-in.");

    public RefreshTokenSecret GenerateRefreshToken()
    {
        RefreshTokensGenerated++;
        string plaintext = "refresh-" + Guid.NewGuid().ToString("N");
        DateTimeOffset expiresAt = clock.GetUtcNow() + RefreshTokenLifetime;
        return new RefreshTokenSecret(plaintext, SecretHashPrefix + plaintext, expiresAt);
    }
}

/// <summary>
/// In-memory <see cref="IAuthIdentityRepository"/> that resolves solely on the pair
/// (<see cref="AuthProvider"/>, providerUserId) — the only resolution path the handler uses.
/// </summary>
internal sealed class PasswordSignInAuthIdentityRepositoryFake : IAuthIdentityRepository
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
        ArgumentNullException.ThrowIfNull(identity);
        _identities.Add(identity);
        return Task.CompletedTask;
    }

    public void Remove(AuthIdentity identity)
    {
        ArgumentNullException.ThrowIfNull(identity);
        _identities.Remove(identity);
    }
}

/// <summary>In-memory <see cref="IUserRepository"/> exposing the by-id lookup the handler needs.</summary>
internal sealed class PasswordSignInUserRepositoryFake : IUserRepository
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
        ArgumentNullException.ThrowIfNull(user);
        _byId[user.Id] = user;
        return Task.CompletedTask;
    }
}

/// <summary>
/// In-memory <see cref="IRefreshTokenStore"/> that records every persisted token so a test can
/// assert that a failed sign-in persists no refresh-token hash.
/// </summary>
internal sealed class PasswordSignInRefreshTokenStoreFake(TimeProvider clock) : IRefreshTokenStore
{
    private readonly List<RefreshToken> _tokens = [];

    public IReadOnlyList<RefreshToken> All => _tokens;

    public Task AddAsync(RefreshToken token, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(token);
        _tokens.Add(token);
        return Task.CompletedTask;
    }

    public Task<RefreshToken?> FindByHashAsync(string tokenHash, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        RefreshToken? match = _tokens.FirstOrDefault(t => t.TokenHash == tokenHash);
        return Task.FromResult(match);
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
        DateTimeOffset now = clock.GetUtcNow();
        IReadOnlyList<RefreshToken> active = _tokens
            .Where(t => t.UserId == userId && t.IsActiveAt(now))
            .ToList();
        return Task.FromResult(active);
    }
}

/// <summary>
/// A no-op <see cref="ISignInAttemptTracker"/> that records whether it was consulted. With the
/// lockout gate disabled (the MVP default), the handler never calls it.
/// </summary>
internal sealed class PasswordSignInAttemptTrackerFake : ISignInAttemptTracker
{
    public int CountCalls { get; private set; }

    public int RecordCalls { get; private set; }

    public int ClearCalls { get; private set; }

    public Task<int> CountFailedAttemptsAsync(string normalisedEmail, DateTimeOffset since, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        CountCalls++;
        return Task.FromResult(0);
    }

    public Task RecordFailedAttemptAsync(string normalisedEmail, DateTimeOffset at, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        RecordCalls++;
        return Task.CompletedTask;
    }

    public Task ClearFailedAttemptsAsync(string normalisedEmail, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        ClearCalls++;
        return Task.CompletedTask;
    }
}

/// <summary>
/// An <see cref="IUnitOfWork"/> fake that counts commits, so a test can confirm whether a failed
/// sign-in persisted any state.
/// </summary>
internal sealed class PasswordSignInUnitOfWorkFake : IUnitOfWork
{
    public int SaveCount { get; private set; }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        SaveCount++;
        return Task.FromResult(0);
    }
}
