using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.PasswordSignIn;

// Hand-written, in-memory test doubles for the malformed-sign-in property test (task 11.3,
// Property 21). These are real fakes — dictionaries, lists, and call counters, never a database
// and never a mocking-framework stub — so the sign-in handler is exercised as a pure Application
// unit test. Every type here is prefixed "MalformedSignIn" and lives in the Auth/PasswordSignIn
// folder so it never collides with fakes authored by sibling sign-in test tasks.

/// <summary>
/// A controllable <see cref="TimeProvider"/> anchored at a fixed instant, so the handler's clock
/// reads are deterministic across property iterations.
/// </summary>
internal sealed class MalformedSignInFakeClock(DateTimeOffset utcNow) : TimeProvider
{
    private readonly DateTimeOffset _utcNow = utcNow.ToUniversalTime();

    /// <summary>A stable default instant used when a test does not care about the exact clock value.</summary>
    public static DateTimeOffset DefaultNow { get; } = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    public MalformedSignInFakeClock() : this(DefaultNow)
    {
    }

    public override DateTimeOffset GetUtcNow() => _utcNow;
}

/// <summary>
/// A spying <see cref="IPasswordHasher"/> that records how many times <see cref="Hash"/> and
/// <see cref="Verify"/> are invoked. Property 21 asserts that malformed input performs <em>no</em>
/// password-hash verification, so <see cref="VerifyCallCount"/> must stay zero. <see cref="Verify"/>
/// would otherwise report success, proving the handler short-circuits before ever reaching it.
/// </summary>
internal sealed class MalformedSignInPasswordHasherSpy : IPasswordHasher
{
    private const string Prefix = "pwhash::";

    public int HashCallCount { get; private set; }

    public int VerifyCallCount { get; private set; }

    public string Hash(string plaintext)
    {
        HashCallCount++;
        return Prefix + plaintext;
    }

    public PasswordVerification Verify(string? storedHash, string plaintext)
    {
        VerifyCallCount++;
        return PasswordVerification.Success;
    }
}

/// <summary>
/// In-memory <see cref="IAuthIdentityRepository"/> that resolves solely on the provider key pair,
/// mirroring the production contract. Seeded with a single Password identity so that, were the
/// handler not to short-circuit on malformed input, a credential <em>would</em> be found and
/// verification attempted — making the zero-verification assertion meaningful.
/// </summary>
internal sealed class MalformedSignInAuthIdentityRepositoryFake : IAuthIdentityRepository
{
    private readonly List<AuthIdentity> _identities = [];

    public int FindCallCount { get; private set; }

    public void Seed(AuthIdentity identity) => _identities.Add(identity);

    public Task<AuthIdentity?> FindByProviderKeyAsync(
        AuthProvider provider, string providerUserId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        FindCallCount++;
        AuthIdentity? match = _identities.FirstOrDefault(
            i => i.Provider == provider && i.ProviderUserId == providerUserId);
        return Task.FromResult(match);
    }

    public Task<IReadOnlyList<AuthIdentity>> ListForUserAsync(Guid userId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        IReadOnlyList<AuthIdentity> owned = _identities.Where(i => i.UserId == userId).ToList();
        return Task.FromResult(owned);
    }

    public Task AddAsync(AuthIdentity identity, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        _identities.Add(identity);
        return Task.CompletedTask;
    }

    public void Remove(AuthIdentity identity) => _identities.Remove(identity);
}

/// <summary>
/// In-memory <see cref="IUserRepository"/>. Not expected to be consulted on the malformed-input
/// path, but seeded so the handler could resolve a user were it to proceed.
/// </summary>
internal sealed class MalformedSignInUserRepositoryFake : IUserRepository
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
/// An <see cref="ITokenService"/> fake that records issuance/generation calls. On the malformed
/// path none of these must be invoked, so the counters must stay zero.
/// </summary>
internal sealed class MalformedSignInTokenServiceFake(TimeProvider clock) : ITokenService
{
    public int IssueCallCount { get; private set; }

    public int GenerateCallCount { get; private set; }

    public AccessTokenResult IssueAccessToken(User user)
    {
        IssueCallCount++;
        return new AccessTokenResult($"access-{user.Id:N}", clock.GetUtcNow() + TimeSpan.FromMinutes(15));
    }

    public AccessTokenValidation ValidateAccessToken(string? token) =>
        throw new NotSupportedException("Validation is not exercised by the sign-in use case.");

    public RefreshTokenSecret GenerateRefreshToken()
    {
        GenerateCallCount++;
        string plaintext = "refresh-" + Guid.NewGuid().ToString("N");
        return new RefreshTokenSecret(plaintext, "sechash::" + plaintext, clock.GetUtcNow() + TimeSpan.FromDays(30));
    }
}

/// <summary>
/// In-memory <see cref="IRefreshTokenStore"/> that records every persisted token, so a test can
/// assert that the malformed path writes no Refresh_Token_Hash.
/// </summary>
internal sealed class MalformedSignInRefreshTokenStoreFake : IRefreshTokenStore
{
    private readonly List<RefreshToken> _tokens = [];

    public IReadOnlyList<RefreshToken> All => _tokens;

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
        IReadOnlyList<RefreshToken> owned = _tokens.Where(t => t.UserId == userId).ToList();
        return Task.FromResult(owned);
    }
}

/// <summary>
/// An <see cref="ISignInAttemptTracker"/> fake. With lockout disabled (the MVP default) the handler
/// never consults it; the call counter lets a test confirm that.
/// </summary>
internal sealed class MalformedSignInAttemptTrackerFake : ISignInAttemptTracker
{
    public int Interactions { get; private set; }

    public Task<int> CountFailedAttemptsAsync(string normalisedEmail, DateTimeOffset since, CancellationToken ct)
    {
        Interactions++;
        return Task.FromResult(0);
    }

    public Task RecordFailedAttemptAsync(string normalisedEmail, DateTimeOffset at, CancellationToken ct)
    {
        Interactions++;
        return Task.CompletedTask;
    }

    public Task ClearFailedAttemptsAsync(string normalisedEmail, CancellationToken ct)
    {
        Interactions++;
        return Task.CompletedTask;
    }
}

/// <summary>
/// An <see cref="IUnitOfWork"/> fake that counts commits, so a test can confirm the malformed path
/// persists nothing.
/// </summary>
internal sealed class MalformedSignInUnitOfWorkFake : IUnitOfWork
{
    public int SaveCount { get; private set; }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        SaveCount++;
        return Task.FromResult(0);
    }
}
