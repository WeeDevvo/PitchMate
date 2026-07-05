using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.Gdpr;

// Hand-written, in-memory test doubles shared by the GDPR erasure property tests
// (Properties 36-38). These are real fakes — dictionaries and lists, never a database and
// never a mocking-framework stub — so the erasure use case can be exercised as a pure
// Application unit test. Every type here is prefixed "Erasure" and lives in the Auth/Gdpr
// folder so it never collides with fakes authored by sibling test tasks.

/// <summary>
/// In-memory <see cref="IUserRepository"/>. Exposes the by-id lookup the erase handler needs;
/// <see cref="AddAsync"/> is present to satisfy the interface.
/// </summary>
internal sealed class ErasureUserRepositoryFake : IUserRepository
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
/// In-memory <see cref="IAuthIdentityRepository"/>. Resolution is solely on the provider key
/// pair, mirroring the production contract, so a scrubbed external identity can no longer be
/// resolved via its original (Provider, ProviderUserId). <see cref="ListForUserAsync"/>
/// returns the identities owned by a user (with their eager-loaded credentials).
/// </summary>
internal sealed class ErasureAuthIdentityRepositoryFake : IAuthIdentityRepository
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
/// In-memory <see cref="IRepository{T}"/> for <see cref="PasswordCredential"/>. The erase
/// handler stages credential removals here; the test asserts which credentials survive, so
/// "no password credential remains" is judged against the persistence truth rather than the
/// in-graph navigation.
/// </summary>
internal sealed class ErasurePasswordCredentialRepositoryFake : IRepository<PasswordCredential>
{
    private readonly Dictionary<Guid, PasswordCredential> _byId = new();

    /// <summary>The credentials still present (not yet removed).</summary>
    public IReadOnlyCollection<PasswordCredential> All => _byId.Values;

    public void Seed(PasswordCredential credential) => _byId[credential.Id] = credential;

    public Task AddAsync(PasswordCredential entity, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        _byId[entity.Id] = entity;
        return Task.CompletedTask;
    }

    public Task<PasswordCredential?> GetByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        _byId.TryGetValue(id, out PasswordCredential? credential);
        return Task.FromResult(credential);
    }

    public Task<IReadOnlyList<PasswordCredential>> ListAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        IReadOnlyList<PasswordCredential> all = _byId.Values.ToList();
        return Task.FromResult(all);
    }

    public Task<IReadOnlyList<PasswordCredential>> ListChronologicalAsync(
        bool includeDeleted, CancellationToken cancellationToken)
        => ListAsync(cancellationToken);

    public void Remove(PasswordCredential entity) => _byId.Remove(entity.Id);

    public void Restore(PasswordCredential entity)
    {
        // No soft-delete modelling needed for the erasure use case.
    }
}

/// <summary>
/// In-memory <see cref="IRefreshTokenStore"/>. <see cref="ListActiveForUserAsync"/> returns
/// the user's currently active (unexpired, <see cref="RefreshTokenStatus.Active"/>) tokens
/// judged against the injected clock — the set erasure must revoke.
/// </summary>
internal sealed class ErasureRefreshTokenStoreFake(TimeProvider clock) : IRefreshTokenStore
{
    private readonly List<RefreshToken> _tokens = [];

    public IReadOnlyList<RefreshToken> All => _tokens;

    public void Seed(RefreshToken token) => _tokens.Add(token);

    public Task AddAsync(RefreshToken token, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
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
/// An <see cref="IUnitOfWork"/> fake that counts commits, so a test can confirm that erasure
/// persisted its changes in a single atomic save.
/// </summary>
internal sealed class ErasureUnitOfWorkFake : IUnitOfWork
{
    public int SaveCount { get; private set; }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        SaveCount++;
        return Task.FromResult(0);
    }
}
