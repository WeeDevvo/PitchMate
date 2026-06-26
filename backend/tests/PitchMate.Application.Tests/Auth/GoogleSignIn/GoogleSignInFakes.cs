using PitchMate.Application.Auth;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.GoogleSignIn;

// Hand-written, in-memory test doubles for the Google sign-in use case (task 11.5). These are real
// fakes — lists and a settable result — never a database and never a mocking-framework stub, so the
// handler's pure orchestration can be exercised as an Application unit test. Every type is prefixed
// "GoogleSignIn" and lives in its own folder so it never collides with sibling test tasks' fakes.

/// <summary>
/// A shared in-memory backing store modelling the Unit-of-Work boundary: repository <c>AddAsync</c>
/// calls only <em>stage</em> entities, which become visible only when <see cref="Commit"/> runs as
/// part of a successful save; a failing save <see cref="DiscardPending">discards</see> them.
/// </summary>
internal sealed class GoogleSignInStore
{
    private readonly List<User> _users = [];
    private readonly List<AuthIdentity> _identities = [];
    private readonly List<RefreshToken> _refreshTokens = [];
    private readonly List<User> _pendingUsers = [];
    private readonly List<AuthIdentity> _pendingIdentities = [];
    private readonly List<RefreshToken> _pendingRefreshTokens = [];

    public IReadOnlyList<User> Users => _users;
    public IReadOnlyList<AuthIdentity> Identities => _identities;
    public IReadOnlyList<RefreshToken> RefreshTokens => _refreshTokens;
    public int SaveCallCount { get; private set; }

    /// <summary>Commits a pre-existing user + identity directly (test setup, bypassing staging).</summary>
    public void SeedUser(User user) => _users.Add(user);
    public void SeedIdentity(AuthIdentity identity) => _identities.Add(identity);

    public void StageUser(User user) => _pendingUsers.Add(user);
    public void StageIdentity(AuthIdentity identity) => _pendingIdentities.Add(identity);
    public void StageRefreshToken(RefreshToken token) => _pendingRefreshTokens.Add(token);

    public User? FindUser(Guid id) => _users.FirstOrDefault(u => u.Id == id);

    /// <summary>Resolves an identity solely on the pair (provider, providerUserId) — the only path.</summary>
    public AuthIdentity? FindIdentity(AuthProvider provider, string providerUserId) =>
        _identities.FirstOrDefault(i => i.Provider == provider && i.ProviderUserId == providerUserId);

    public void RecordSaveCall() => SaveCallCount++;

    public int Commit()
    {
        int count = _pendingUsers.Count + _pendingIdentities.Count + _pendingRefreshTokens.Count;
        _users.AddRange(_pendingUsers);
        _identities.AddRange(_pendingIdentities);
        _refreshTokens.AddRange(_pendingRefreshTokens);
        _pendingUsers.Clear();
        _pendingIdentities.Clear();
        _pendingRefreshTokens.Clear();
        return count;
    }

    public void DiscardPending()
    {
        _pendingUsers.Clear();
        _pendingIdentities.Clear();
        _pendingRefreshTokens.Clear();
    }
}

/// <summary>A configurable <see cref="IExternalProviderVerifier"/>: returns the result it is given.</summary>
internal sealed class GoogleSignInVerifierFake : IExternalProviderVerifier
{
    private readonly Result<ExternalIdentity> _result;

    public int CallCount { get; private set; }
    public string? LastAssertion { get; private set; }

    private GoogleSignInVerifierFake(Result<ExternalIdentity> result) => _result = result;

    /// <summary>A verifier that validates and returns the supplied external identity.</summary>
    public static GoogleSignInVerifierFake Returning(ExternalIdentity identity) =>
        new(Result<ExternalIdentity>.Ok(identity));

    /// <summary>A verifier that rejects every assertion (bad signature/issuer/audience/expiry).</summary>
    public static GoogleSignInVerifierFake Rejecting() =>
        new(Result<ExternalIdentity>.Fail(new AuthError(AuthErrorCode.AuthenticationFailed, "rejected")));

    public Task<Result<ExternalIdentity>> ValidateAsync(
        AuthProvider provider, string assertion, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        CallCount++;
        LastAssertion = assertion;
        return Task.FromResult(_result);
    }
}

/// <summary>In-memory <see cref="IUserRepository"/> over a <see cref="GoogleSignInStore"/>.</summary>
internal sealed class GoogleSignInUserRepositoryFake(GoogleSignInStore store) : IUserRepository
{
    public Task<User?> GetByIdAsync(Guid id, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(store.FindUser(id));
    }

    public Task AddAsync(User user, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(user);
        store.StageUser(user);
        return Task.CompletedTask;
    }
}

/// <summary>In-memory <see cref="IAuthIdentityRepository"/> over a <see cref="GoogleSignInStore"/>.</summary>
internal sealed class GoogleSignInAuthIdentityRepositoryFake(GoogleSignInStore store) : IAuthIdentityRepository
{
    public Task<AuthIdentity?> FindByProviderKeyAsync(
        AuthProvider provider, string providerUserId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(store.FindIdentity(provider, providerUserId));
    }

    public Task<IReadOnlyList<AuthIdentity>> ListForUserAsync(Guid userId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        IReadOnlyList<AuthIdentity> list = store.Identities.Where(i => i.UserId == userId).ToList();
        return Task.FromResult(list);
    }

    public Task AddAsync(AuthIdentity identity, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(identity);
        store.StageIdentity(identity);
        return Task.CompletedTask;
    }

    public void Remove(AuthIdentity identity) =>
        throw new NotSupportedException("Unlinking is not exercised by Google sign-in.");
}

/// <summary>In-memory <see cref="IRefreshTokenStore"/> over a <see cref="GoogleSignInStore"/>.</summary>
internal sealed class GoogleSignInRefreshTokenStoreFake(GoogleSignInStore store) : IRefreshTokenStore
{
    public Task AddAsync(RefreshToken token, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(token);
        store.StageRefreshToken(token);
        return Task.CompletedTask;
    }

    public Task<RefreshToken?> FindByHashAsync(string tokenHash, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        RefreshToken? match = store.RefreshTokens.FirstOrDefault(t => t.TokenHash == tokenHash);
        return Task.FromResult(match);
    }

    public Task<IReadOnlyList<RefreshToken>> ListFamilyAsync(Guid tokenFamilyId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        IReadOnlyList<RefreshToken> family =
            store.RefreshTokens.Where(t => t.TokenFamilyId == tokenFamilyId).ToList();
        return Task.FromResult(family);
    }

    public Task<IReadOnlyList<RefreshToken>> ListActiveForUserAsync(Guid userId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        IReadOnlyList<RefreshToken> active =
            store.RefreshTokens.Where(t => t.UserId == userId).ToList();
        return Task.FromResult(active);
    }
}

/// <summary>An <see cref="IUnitOfWork"/> over a <see cref="GoogleSignInStore"/>; can induce a save failure.</summary>
internal sealed class GoogleSignInUnitOfWorkFake(GoogleSignInStore store, bool throwOnSave = false) : IUnitOfWork
{
    public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        store.RecordSaveCall();

        if (throwOnSave)
        {
            store.DiscardPending();
            throw new DuplicateKeyException("Induced duplicate (Provider, ProviderUserId) for race testing.");
        }

        return Task.FromResult(store.Commit());
    }
}

/// <summary>
/// A deterministic <see cref="ITokenService"/> fake: access tokens and refresh secrets are unique
/// stable strings; the refresh hash is a transform of the plaintext so "persist only the hash" can be
/// asserted. No real cryptography is involved.
/// </summary>
internal sealed class GoogleSignInTokenServiceFake : ITokenService
{
    public const string RefreshHashPrefix = "hash::";

    private static readonly DateTimeOffset Now = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    public List<Guid> IssuedFor { get; } = [];

    public AccessTokenResult IssueAccessToken(User user)
    {
        ArgumentNullException.ThrowIfNull(user);
        IssuedFor.Add(user.Id);
        return new AccessTokenResult($"access-{user.Id:N}", Now + TimeSpan.FromMinutes(15));
    }

    public AccessTokenValidation ValidateAccessToken(string? token) =>
        throw new NotSupportedException("Validation is not exercised by Google sign-in.");

    public RefreshTokenSecret GenerateRefreshToken()
    {
        string plaintext = "refresh-" + Guid.NewGuid().ToString("N");
        return new RefreshTokenSecret(plaintext, RefreshHashPrefix + plaintext, Now + TimeSpan.FromDays(30));
    }
}
