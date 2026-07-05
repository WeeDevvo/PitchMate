using PitchMate.Application.Auth;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.Registration;

/// <summary>
/// A hand-written, in-memory backing store shared by the registration test doubles. It
/// models the Unit-of-Work boundary faithfully: repository <c>AddAsync</c> calls only
/// <em>stage</em> entities, and they become visible (committed) only when
/// <see cref="Commit"/> runs as part of a successful
/// <see cref="RegistrationFakeUnitOfWork.SaveChangesAsync"/>. A failing save instead
/// <see cref="DiscardPending">discards</see> the staged entities, so nothing is
/// persisted — exactly the atomicity guarantee Requirement 2.1 demands.
/// <para>
/// This is a real fake (a dictionary/list-backed implementation of the Application-layer
/// contracts), not a mocking-framework stub and not a database, so the registration
/// handler's pure orchestration can be exercised without Infrastructure.
/// </para>
/// </summary>
internal sealed class RegistrationStore
{
    private readonly List<User> _users = [];
    private readonly List<AuthIdentity> _identities = [];
    private readonly List<User> _pendingUsers = [];
    private readonly List<AuthIdentity> _pendingIdentities = [];

    /// <summary>The users durably committed so far.</summary>
    public IReadOnlyList<User> Users => _users;

    /// <summary>The auth identities durably committed so far.</summary>
    public IReadOnlyList<AuthIdentity> Identities => _identities;

    /// <summary>The number of times a save was attempted against this store.</summary>
    public int SaveCallCount { get; private set; }

    /// <summary>Stages a user for insertion on the next successful save.</summary>
    public void StageUser(User user) => _pendingUsers.Add(user);

    /// <summary>Stages an identity for insertion on the next successful save.</summary>
    public void StageIdentity(AuthIdentity identity) => _pendingIdentities.Add(identity);

    /// <summary>Finds a committed user by id, or <see langword="null"/>.</summary>
    public User? FindUser(Guid id) => _users.FirstOrDefault(u => u.Id == id);

    /// <summary>
    /// Resolves a committed identity solely on the pair (provider, providerUserId) — the
    /// only resolution path the duplicate-email check uses (Requirements 1.4, 2.3).
    /// </summary>
    public AuthIdentity? FindIdentity(AuthProvider provider, string providerUserId) =>
        _identities.FirstOrDefault(i => i.Provider == provider && i.ProviderUserId == providerUserId);

    /// <summary>Removes a committed identity (account unlinking path).</summary>
    public void RemoveIdentity(AuthIdentity identity) => _identities.Remove(identity);

    /// <summary>Records that a save was attempted.</summary>
    public void RecordSaveCall() => SaveCallCount++;

    /// <summary>
    /// Atomically commits every staged user and identity together, returning the count of
    /// rows persisted. Models a single transactional flush wrapping all staged adds.
    /// </summary>
    public int Commit()
    {
        int count = _pendingUsers.Count + _pendingIdentities.Count;
        _users.AddRange(_pendingUsers);
        _identities.AddRange(_pendingIdentities);
        _pendingUsers.Clear();
        _pendingIdentities.Clear();
        return count;
    }

    /// <summary>Discards staged entities without committing, modelling a rolled-back save.</summary>
    public void DiscardPending()
    {
        _pendingUsers.Clear();
        _pendingIdentities.Clear();
    }
}

/// <summary>In-memory <see cref="IUserRepository"/> staging adds into a <see cref="RegistrationStore"/>.</summary>
internal sealed class RegistrationFakeUserRepository : IUserRepository
{
    private readonly RegistrationStore _store;

    public RegistrationFakeUserRepository(RegistrationStore store) => _store = store;

    public Task<User?> GetByIdAsync(Guid id, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(_store.FindUser(id));
    }

    public Task AddAsync(User user, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(user);
        _store.StageUser(user);
        return Task.CompletedTask;
    }
}

/// <summary>In-memory <see cref="IAuthIdentityRepository"/> staging adds into a <see cref="RegistrationStore"/>.</summary>
internal sealed class RegistrationFakeAuthIdentityRepository : IAuthIdentityRepository
{
    private readonly RegistrationStore _store;

    public RegistrationFakeAuthIdentityRepository(RegistrationStore store) => _store = store;

    public Task<AuthIdentity?> FindByProviderKeyAsync(
        AuthProvider provider, string providerUserId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(_store.FindIdentity(provider, providerUserId));
    }

    public Task<IReadOnlyList<AuthIdentity>> ListForUserAsync(Guid userId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        IReadOnlyList<AuthIdentity> list = _store.Identities.Where(i => i.UserId == userId).ToList();
        return Task.FromResult(list);
    }

    public Task AddAsync(AuthIdentity identity, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(identity);
        _store.StageIdentity(identity);
        return Task.CompletedTask;
    }

    public void Remove(AuthIdentity identity)
    {
        ArgumentNullException.ThrowIfNull(identity);
        _store.RemoveIdentity(identity);
    }
}

/// <summary>
/// A deterministic fake <see cref="IPasswordHasher"/>: it records every plaintext it is
/// asked to hash and returns a non-empty, reversible-for-test marker (never used as a real
/// hash). Verification matches that marker. No real cryptography is involved — these are
/// pure Application-layer tests.
/// </summary>
internal sealed class RegistrationFakePasswordHasher : IPasswordHasher
{
    private const string Prefix = "hashed:";

    /// <summary>Every plaintext passed to <see cref="Hash"/>, in call order.</summary>
    public List<string> HashedInputs { get; } = [];

    public string Hash(string plaintext)
    {
        ArgumentNullException.ThrowIfNull(plaintext);
        HashedInputs.Add(plaintext);
        return Prefix + plaintext;
    }

    public PasswordVerification Verify(string? storedHash, string plaintext) =>
        storedHash == Prefix + plaintext ? PasswordVerification.Success : PasswordVerification.Failure;
}

/// <summary>
/// A fake <see cref="IUnitOfWork"/> over a <see cref="RegistrationStore"/>. A normal save
/// atomically commits the staged entities; a save constructed with
/// <c>throwOnSave: true</c> discards the staged entities and throws, modelling a
/// mid-operation persistence failure so atomicity can be asserted (Requirement 2.1).
/// </summary>
internal sealed class RegistrationFakeUnitOfWork : IUnitOfWork
{
    private readonly RegistrationStore _store;
    private readonly bool _throwOnSave;

    public RegistrationFakeUnitOfWork(RegistrationStore store, bool throwOnSave = false)
    {
        _store = store;
        _throwOnSave = throwOnSave;
    }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        _store.RecordSaveCall();

        if (_throwOnSave)
        {
            _store.DiscardPending();
            throw new InvalidOperationException("Induced save failure for atomicity testing.");
        }

        return Task.FromResult(_store.Commit());
    }
}

/// <summary>
/// A fake <see cref="IEmailVerificationInitiator"/> that records how many times, and for
/// which users, verification was initiated — used to assert Requirement 2.6 (a successful
/// registration initiates verification) and that a failed registration does not.
/// </summary>
internal sealed class RegistrationFakeEmailVerificationInitiator : IEmailVerificationInitiator
{
    /// <summary>The number of times <see cref="InitiateAsync"/> was invoked.</summary>
    public int InitiateCallCount { get; private set; }

    /// <summary>The users for which verification was initiated, in call order.</summary>
    public List<User> InitiatedFor { get; } = [];

    public Task<Result> InitiateAsync(User user, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(user);
        InitiateCallCount++;
        InitiatedFor.Add(user);
        return Task.FromResult(Result.Ok());
    }
}
