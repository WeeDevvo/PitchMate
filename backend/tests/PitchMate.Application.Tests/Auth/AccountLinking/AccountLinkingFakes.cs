using PitchMate.Application.Auth;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.AccountLinking;

// Hand-written, in-memory test doubles for the account-linking use cases (task 13). These are real
// fakes — lists and a settable verifier result — never a database and never a mocking-framework
// stub, so the handler's pure orchestration can be exercised as an Application unit test. Every type
// is prefixed "AccountLinking" and lives in its own folder so it never collides with sibling test
// tasks' fakes.

/// <summary>
/// A shared in-memory backing store modelling the Unit-of-Work boundary: repository <c>AddAsync</c>
/// calls only <em>stage</em> entities, which become visible only when <see cref="Commit"/> runs as
/// part of a successful save; a failing save <see cref="DiscardPending">discards</see> them.
/// </summary>
internal sealed class AccountLinkingStore
{
    private readonly List<User> _users = [];
    private readonly List<AuthIdentity> _identities = [];
    private readonly List<AuthIdentity> _pendingIdentities = [];

    public IReadOnlyList<User> Users => _users;
    public IReadOnlyList<AuthIdentity> Identities => _identities;
    public int SaveCallCount { get; private set; }

    /// <summary>Commits a pre-existing user directly (test setup, bypassing staging).</summary>
    public void SeedUser(User user) => _users.Add(user);

    /// <summary>Commits a pre-existing identity directly (test setup, bypassing staging).</summary>
    public void SeedIdentity(AuthIdentity identity) => _identities.Add(identity);

    public void StageIdentity(AuthIdentity identity) => _pendingIdentities.Add(identity);

    public User? FindUser(Guid id) => _users.FirstOrDefault(u => u.Id == id);

    /// <summary>Resolves an identity solely on the pair (provider, providerUserId) — the only path.</summary>
    public AuthIdentity? FindIdentity(AuthProvider provider, string providerUserId) =>
        _identities.FirstOrDefault(i => i.Provider == provider && i.ProviderUserId == providerUserId);

    public void RecordSaveCall() => SaveCallCount++;

    public int Commit()
    {
        int count = _pendingIdentities.Count;
        _identities.AddRange(_pendingIdentities);
        _pendingIdentities.Clear();
        return count;
    }

    public void DiscardPending() => _pendingIdentities.Clear();
}

/// <summary>A configurable <see cref="IExternalProviderVerifier"/>: returns the result it is given.</summary>
internal sealed class AccountLinkingVerifierFake : IExternalProviderVerifier
{
    private readonly Result<ExternalIdentity> _result;

    public int CallCount { get; private set; }

    private AccountLinkingVerifierFake(Result<ExternalIdentity> result) => _result = result;

    /// <summary>A verifier that validates and returns the supplied external identity.</summary>
    public static AccountLinkingVerifierFake Returning(ExternalIdentity identity) =>
        new(Result<ExternalIdentity>.Ok(identity));

    /// <summary>A verifier that rejects every assertion (bad signature/issuer/audience/expiry).</summary>
    public static AccountLinkingVerifierFake Rejecting() =>
        new(Result<ExternalIdentity>.Fail(new AuthError(AuthErrorCode.AuthenticationFailed, "rejected")));

    public Task<Result<ExternalIdentity>> ValidateAsync(
        AuthProvider provider, string assertion, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        CallCount++;
        return Task.FromResult(_result);
    }
}

/// <summary>In-memory <see cref="IUserRepository"/> over an <see cref="AccountLinkingStore"/>.</summary>
internal sealed class AccountLinkingUserRepositoryFake(AccountLinkingStore store) : IUserRepository
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
        throw new NotSupportedException("Account linking never creates a user.");
    }
}

/// <summary>In-memory <see cref="IAuthIdentityRepository"/> over an <see cref="AccountLinkingStore"/>.</summary>
internal sealed class AccountLinkingAuthIdentityRepositoryFake(AccountLinkingStore store) : IAuthIdentityRepository
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
        throw new NotSupportedException("Unlinking is not exercised by external-provider linking.");
}

/// <summary>An <see cref="IUnitOfWork"/> over an <see cref="AccountLinkingStore"/>; can induce a save failure.</summary>
internal sealed class AccountLinkingUnitOfWorkFake(AccountLinkingStore store, bool throwOnSave = false) : IUnitOfWork
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
