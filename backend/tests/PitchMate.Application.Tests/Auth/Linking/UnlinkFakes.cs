using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.Linking;

// Hand-written, in-memory test doubles for the account-unlinking use case
// (task 13.1, UnlinkAuthIdentityHandler). These are real fakes — a backing list and a commit
// counter, never a database and never a mocking framework — so the handler runs as a pure
// Application unit test. Types are prefixed "Unlink" and live in the Auth/Linking folder so
// they never collide with fakes authored by sibling test tasks.

/// <summary>
/// In-memory <see cref="IAuthIdentityRepository"/> backing the unlink property. It models the
/// whole identity directory across users: <see cref="ListForUserAsync"/> returns only the
/// identities owned by the requested user (so the handler's last-identity guard is evaluated
/// against that user's own set), and <see cref="Remove"/> stages a deletion that the unit of
/// work makes effective. Resolution-by-provider-key and add are unsupported here because the
/// unlink use case never exercises them.
/// </summary>
internal sealed class UnlinkFakeIdentityRepository : IAuthIdentityRepository
{
    private readonly List<AuthIdentity> _identities = [];

    /// <summary>Seeds an identity into the shared directory.</summary>
    public void Seed(AuthIdentity identity) => _identities.Add(identity);

    /// <summary>Identities currently owned by <paramref name="userId"/>, in insertion order.</summary>
    public IReadOnlyList<AuthIdentity> ForUser(Guid userId) =>
        _identities.Where(i => i.UserId == userId).ToList();

    /// <summary>True when an identity with <paramref name="identityId"/> is still present.</summary>
    public bool Contains(Guid identityId) => _identities.Any(i => i.Id == identityId);

    public Task<AuthIdentity?> FindByProviderKeyAsync(
        AuthProvider provider, string providerUserId, CancellationToken ct) =>
        throw new NotSupportedException("Provider-key resolution is not exercised by unlinking.");

    public Task<IReadOnlyList<AuthIdentity>> ListForUserAsync(Guid userId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        IReadOnlyList<AuthIdentity> list = _identities.Where(i => i.UserId == userId).ToList();
        return Task.FromResult(list);
    }

    public Task AddAsync(AuthIdentity identity, CancellationToken ct) =>
        throw new NotSupportedException("Adding identities is not exercised by unlinking.");

    public void Remove(AuthIdentity identity)
    {
        ArgumentNullException.ThrowIfNull(identity);
        _identities.Remove(identity);
    }
}

/// <summary>
/// An <see cref="IUnitOfWork"/> fake that counts commits, so a test can confirm a removal was
/// actually persisted (success) or that nothing was committed (rejection).
/// </summary>
internal sealed class UnlinkFakeUnitOfWork : IUnitOfWork
{
    /// <summary>The number of times <see cref="SaveChangesAsync"/> has been called.</summary>
    public int SaveCount { get; private set; }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        SaveCount++;
        return Task.FromResult(0);
    }
}
