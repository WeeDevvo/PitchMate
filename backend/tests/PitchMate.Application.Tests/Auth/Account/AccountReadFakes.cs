using PitchMate.Application.Auth.Abstractions;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.Account;

// Hand-written, in-memory test doubles for the account read use case (task 4.1). These are real
// fakes — backed by plain lists — never a database and never a mocking-framework stub, so the
// read-only handler's orchestration can be exercised as an Application unit test. Every write path
// throws, which is how "the use case mutates no state" is asserted rather than assumed. Every type
// is prefixed "AccountRead" and lives in its own folder so it never collides with sibling fakes.

/// <summary>
/// A shared in-memory directory of users and their owned <see cref="AuthIdentity"/> rows. The
/// account read handler only reads from it, via <see cref="IUserRepository"/> and
/// <see cref="IAuthIdentityRepository"/>.
/// </summary>
internal sealed class AccountReadStore
{
    private readonly List<User> _users = [];
    private readonly List<AuthIdentity> _identities = [];

    /// <summary>The number of times a user was loaded by id.</summary>
    public int UserReadCount { get; private set; }

    /// <summary>The user ids the identity listing was asked for, in call order.</summary>
    public List<Guid> IdentityListCalls { get; } = [];

    public void SeedUser(User user) => _users.Add(user);

    public void SeedIdentity(AuthIdentity identity) => _identities.Add(identity);

    public User? FindUser(Guid id)
    {
        UserReadCount++;
        return _users.FirstOrDefault(user => user.Id == id);
    }

    /// <summary>
    /// Owned identities for a user, returned in seed order — deliberately <em>not</em> in the
    /// order the view is expected to present them, so the handler's ordering is what is measured.
    /// </summary>
    public IReadOnlyList<AuthIdentity> IdentitiesForUser(Guid userId)
    {
        IdentityListCalls.Add(userId);
        return _identities.Where(identity => identity.UserId == userId).ToList();
    }
}

/// <summary>In-memory <see cref="IUserRepository"/> over an <see cref="AccountReadStore"/>.</summary>
internal sealed class AccountReadUserRepositoryFake(AccountReadStore store) : IUserRepository
{
    public Task<User?> GetByIdAsync(Guid id, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(store.FindUser(id));
    }

    public Task AddAsync(User user, CancellationToken ct) =>
        throw new NotSupportedException("The account read use case mutates no state.");
}

/// <summary>In-memory <see cref="IAuthIdentityRepository"/> over an <see cref="AccountReadStore"/>.</summary>
internal sealed class AccountReadAuthIdentityRepositoryFake(AccountReadStore store) : IAuthIdentityRepository
{
    public Task<IReadOnlyList<AuthIdentity>> ListForUserAsync(Guid userId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(store.IdentitiesForUser(userId));
    }

    public Task<AuthIdentity?> FindByProviderKeyAsync(
        AuthProvider provider, string providerUserId, CancellationToken ct) =>
        throw new NotSupportedException("Provider-key resolution is not exercised by the account read use case.");

    public Task AddAsync(AuthIdentity identity, CancellationToken ct) =>
        throw new NotSupportedException("The account read use case mutates no state.");

    public void Remove(AuthIdentity identity) =>
        throw new NotSupportedException("The account read use case mutates no state.");
}
