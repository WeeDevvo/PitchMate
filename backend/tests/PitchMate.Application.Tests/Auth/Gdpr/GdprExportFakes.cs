using PitchMate.Application.Auth.Abstractions;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.Gdpr;

// Hand-written, in-memory test doubles for the data-subject export use case (task 13.7). These are
// real fakes — backed by plain lists — never a database and never a mocking-framework stub, so the
// read-only export handler's orchestration can be exercised as an Application unit test. Every type
// is prefixed "GdprExport" and lives in its own folder so it never collides with sibling tests'
// fakes.

/// <summary>
/// A shared in-memory directory of users and their owned <see cref="AuthIdentity"/> rows (each
/// external identity carrying a provider subject, each Password identity carrying its credential
/// hash). The export handler only reads from it via <see cref="IUserRepository"/> and
/// <see cref="IAuthIdentityRepository"/>.
/// </summary>
internal sealed class GdprExportStore
{
    private readonly List<User> _users = [];
    private readonly List<AuthIdentity> _identities = [];

    public IReadOnlyList<User> Users => _users;
    public IReadOnlyList<AuthIdentity> Identities => _identities;

    public void SeedUser(User user) => _users.Add(user);
    public void SeedIdentity(AuthIdentity identity) => _identities.Add(identity);

    public User? FindUser(Guid id) => _users.FirstOrDefault(u => u.Id == id);

    /// <summary>Owned identities for a user, returned in seed order (the export preserves order).</summary>
    public IReadOnlyList<AuthIdentity> IdentitiesForUser(Guid userId) =>
        _identities.Where(i => i.UserId == userId).ToList();
}

/// <summary>In-memory <see cref="IUserRepository"/> over a <see cref="GdprExportStore"/>.</summary>
internal sealed class GdprExportUserRepositoryFake(GdprExportStore store) : IUserRepository
{
    public Task<User?> GetByIdAsync(Guid id, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(store.FindUser(id));
    }

    public Task AddAsync(User user, CancellationToken ct) =>
        throw new NotSupportedException("Adding users is not exercised by the export use case.");
}

/// <summary>In-memory <see cref="IAuthIdentityRepository"/> over a <see cref="GdprExportStore"/>.</summary>
internal sealed class GdprExportAuthIdentityRepositoryFake(GdprExportStore store) : IAuthIdentityRepository
{
    public Task<IReadOnlyList<AuthIdentity>> ListForUserAsync(Guid userId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(store.IdentitiesForUser(userId));
    }

    public Task<AuthIdentity?> FindByProviderKeyAsync(
        AuthProvider provider, string providerUserId, CancellationToken ct) =>
        throw new NotSupportedException("Provider-key resolution is not exercised by the export use case.");

    public Task AddAsync(AuthIdentity identity, CancellationToken ct) =>
        throw new NotSupportedException("Adding identities is not exercised by the export use case.");

    public void Remove(AuthIdentity identity) =>
        throw new NotSupportedException("Removing identities is not exercised by the export use case.");
}
