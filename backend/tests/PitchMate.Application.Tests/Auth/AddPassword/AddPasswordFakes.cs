using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.AddPassword;

/// <summary>
/// A hand-written, in-memory backing store shared by the add-password test doubles. It
/// models the Unit-of-Work boundary faithfully: <c>AddAsync</c> only <em>stages</em> an
/// identity, which becomes visible (committed) only when <see cref="Commit"/> runs as part
/// of a successful <see cref="AddPasswordFakeUnitOfWork.SaveChangesAsync"/>. Pre-existing
/// users and identities are seeded directly as committed rows.
/// <para>
/// This is a real fake (list-backed implementations of the Application-layer contracts),
/// not a mocking-framework stub and not a database, so the
/// <see cref="PitchMate.Application.Auth.UseCases.AddPasswordCredentialHandler"/>'s pure
/// orchestration can be exercised without Infrastructure.
/// </para>
/// </summary>
internal sealed class AddPasswordStore
{
    private readonly List<User> _users = [];
    private readonly List<AuthIdentity> _identities = [];
    private readonly List<AuthIdentity> _pendingIdentities = [];

    /// <summary>The users committed to the store.</summary>
    public IReadOnlyList<User> Users => _users;

    /// <summary>The auth identities durably committed so far.</summary>
    public IReadOnlyList<AuthIdentity> Identities => _identities;

    /// <summary>The number of times a save was attempted against this store.</summary>
    public int SaveCallCount { get; private set; }

    /// <summary>Seeds a committed user (the authenticated principal under test).</summary>
    public void SeedUser(User user) => _users.Add(user);

    /// <summary>Seeds a committed identity (a pre-existing sign-in method).</summary>
    public void SeedIdentity(AuthIdentity identity) => _identities.Add(identity);

    /// <summary>Finds a committed user by id, or <see langword="null"/>.</summary>
    public User? FindUser(Guid id) => _users.FirstOrDefault(u => u.Id == id);

    /// <summary>Lists committed identities owned by the given user.</summary>
    public IReadOnlyList<AuthIdentity> ListForUser(Guid userId) =>
        _identities.Where(i => i.UserId == userId).ToList();

    /// <summary>Stages an identity for insertion on the next successful save.</summary>
    public void StageIdentity(AuthIdentity identity) => _pendingIdentities.Add(identity);

    /// <summary>Records that a save was attempted.</summary>
    public void RecordSaveCall() => SaveCallCount++;

    /// <summary>
    /// Commits every staged identity, enforcing the unique (Provider, ProviderUserId)
    /// index: an attempt to commit a pair that already exists throws
    /// <see cref="DuplicateKeyException"/> and persists nothing from the batch.
    /// </summary>
    public int Commit()
    {
        foreach (AuthIdentity pending in _pendingIdentities)
        {
            bool clashes = _identities.Any(existing =>
                existing.Provider == pending.Provider
                && existing.ProviderUserId == pending.ProviderUserId);

            if (clashes)
            {
                _pendingIdentities.Clear();
                throw new DuplicateKeyException();
            }
        }

        int count = _pendingIdentities.Count;
        _identities.AddRange(_pendingIdentities);
        _pendingIdentities.Clear();
        return count;
    }
}

/// <summary>In-memory <see cref="IUserRepository"/> over an <see cref="AddPasswordStore"/>.</summary>
internal sealed class AddPasswordFakeUserRepository : IUserRepository
{
    private readonly AddPasswordStore _store;

    public AddPasswordFakeUserRepository(AddPasswordStore store) => _store = store;

    public Task<User?> GetByIdAsync(Guid id, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(_store.FindUser(id));
    }

    public Task AddAsync(User user, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(user);
        _store.SeedUser(user);
        return Task.CompletedTask;
    }
}

/// <summary>In-memory <see cref="IAuthIdentityRepository"/> over an <see cref="AddPasswordStore"/>.</summary>
internal sealed class AddPasswordFakeAuthIdentityRepository : IAuthIdentityRepository
{
    private readonly AddPasswordStore _store;

    public AddPasswordFakeAuthIdentityRepository(AddPasswordStore store) => _store = store;

    public Task<AuthIdentity?> FindByProviderKeyAsync(
        AuthProvider provider, string providerUserId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        AuthIdentity? match = _store.Identities
            .FirstOrDefault(i => i.Provider == provider && i.ProviderUserId == providerUserId);
        return Task.FromResult(match);
    }

    public Task<IReadOnlyList<AuthIdentity>> ListForUserAsync(Guid userId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(_store.ListForUser(userId));
    }

    public Task AddAsync(AuthIdentity identity, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(identity);
        _store.StageIdentity(identity);
        return Task.CompletedTask;
    }

    public void Remove(AuthIdentity identity) => throw new NotSupportedException(
        "The add-password flow never removes an identity.");
}

/// <summary>
/// A deterministic fake <see cref="IPasswordHasher"/>: it returns a non-empty, reversible-
/// for-test marker (never used as a real hash). No real cryptography is involved — these
/// are pure Application-layer tests.
/// </summary>
internal sealed class AddPasswordFakePasswordHasher : IPasswordHasher
{
    private const string Prefix = "hashed:";

    public string Hash(string plaintext)
    {
        ArgumentNullException.ThrowIfNull(plaintext);
        return Prefix + plaintext;
    }

    public PasswordVerification Verify(string? storedHash, string plaintext) =>
        storedHash == Prefix + plaintext ? PasswordVerification.Success : PasswordVerification.Failure;
}

/// <summary>
/// A fake <see cref="IUnitOfWork"/> over an <see cref="AddPasswordStore"/>: a save
/// atomically commits the staged identity, surfacing <see cref="DuplicateKeyException"/>
/// if it would violate the unique (Provider, ProviderUserId) index.
/// </summary>
internal sealed class AddPasswordFakeUnitOfWork : IUnitOfWork
{
    private readonly AddPasswordStore _store;

    public AddPasswordFakeUnitOfWork(AddPasswordStore store) => _store = store;

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        _store.RecordSaveCall();
        return Task.FromResult(_store.Commit());
    }
}
