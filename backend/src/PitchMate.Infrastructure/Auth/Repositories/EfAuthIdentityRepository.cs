using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Domain.Auth;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Auth.Repositories;

/// <summary>
/// EF Core implementation of <see cref="IAuthIdentityRepository"/> over the shared
/// <see cref="PitchMateDbContext"/>.
/// <para>
/// Identity resolution matches <strong>solely</strong> on the pair
/// (<see cref="AuthIdentity.Provider"/>, <see cref="AuthIdentity.ProviderUserId"/>) via
/// <see cref="FindByProviderKeyAsync"/>; email address is <strong>never</strong> used as
/// a matching key (Requirements 1.4, 1.11).
/// </para>
/// <para>Validates: Requirements 1.4, 1.11, 12.3.</para>
/// </summary>
internal sealed class EfAuthIdentityRepository(PitchMateDbContext db) : IAuthIdentityRepository
{
    /// <inheritdoc />
    public Task<AuthIdentity?> FindByProviderKeyAsync(
        AuthProvider provider, string providerUserId, CancellationToken ct)
        // Sole resolution path: match only on (Provider, ProviderUserId) — never on email
        // (Requirements 1.4, 1.11). The Password credential is loaded so password sign-in can
        // verify against it.
        => db.Set<AuthIdentity>()
            .Include(i => i.Credential)
            .FirstOrDefaultAsync(
                i => i.Provider == provider && i.ProviderUserId == providerUserId,
                ct);

    /// <inheritdoc />
    public async Task<IReadOnlyList<AuthIdentity>> ListForUserAsync(Guid userId, CancellationToken ct)
        => await db.Set<AuthIdentity>()
            .Include(i => i.Credential)
            .Where(i => i.UserId == userId)
            .ToListAsync(ct);

    /// <inheritdoc />
    public async Task AddAsync(AuthIdentity identity, CancellationToken ct)
        => await db.Set<AuthIdentity>().AddAsync(identity, ct);

    /// <inheritdoc />
    public void Remove(AuthIdentity identity)
        // Sets EF state to Deleted; the save pipeline reinterprets this as a soft-delete for
        // BaseEntity-derived (ISoftDeletable) types.
        => db.Set<AuthIdentity>().Remove(identity);
}
