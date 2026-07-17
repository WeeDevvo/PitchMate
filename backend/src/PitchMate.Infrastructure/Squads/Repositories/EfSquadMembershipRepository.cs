using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Squads.Repositories;

/// <summary>
/// EF Core implementation of <see cref="ISquadMembershipRepository"/> over the shared
/// <see cref="PitchMateDbContext"/>. Provides the membership lookups generic CRUD cannot express:
/// acting-membership resolution, single-owner resolution, case-insensitive display-name uniqueness
/// scans, and the per-user membership scan for user erasure. Memberships are never soft-deleted —
/// leaving/removal sets <see cref="MembershipState.Inactive"/> (history retained) and erasure either
/// anonymises the row or removes it permanently — so reads see active and inactive rows alike.
/// <para>Validates: Requirements 2.4, 3.1, 6.1, 16.4, 17.3, 18.2, 18.3, 18.4, 19.3.</para>
/// </summary>
internal sealed class EfSquadMembershipRepository(PitchMateDbContext db) : ISquadMembershipRepository
{
    /// <inheritdoc />
    public async Task AddAsync(SquadMembership membership, CancellationToken cancellationToken)
        => await db.Set<SquadMembership>().AddAsync(membership, cancellationToken);

    /// <inheritdoc />
    public Task<SquadMembership?> GetByIdAsync(Guid membershipId, CancellationToken cancellationToken)
        => db.Set<SquadMembership>()
            .FirstOrDefaultAsync(membership => membership.Id == membershipId, cancellationToken);

    /// <inheritdoc />
    public Task<SquadMembership?> GetByUserAndSquadAsync(Guid userId, Guid squadId, CancellationToken cancellationToken)
        // The filtered unique index on (squad_id, user_id) guarantees at most one match.
        => db.Set<SquadMembership>()
            .FirstOrDefaultAsync(
                membership => membership.UserId == userId && membership.SquadId == squadId,
                cancellationToken);

    /// <inheritdoc />
    public async Task<IReadOnlyList<SquadMembership>> ListForSquadAsync(Guid squadId, bool activeOnly, CancellationToken cancellationToken)
    {
        IQueryable<SquadMembership> query = db.Set<SquadMembership>()
            .Where(membership => membership.SquadId == squadId);

        if (activeOnly)
        {
            query = query.Where(membership => membership.State == MembershipState.Active);
        }

        return await query.ToListAsync(cancellationToken);
    }

    /// <inheritdoc />
    public Task<SquadMembership?> GetOwnerAsync(Guid squadId, CancellationToken cancellationToken)
        // The filtered unique index on (squad_id) WHERE role = Owner guarantees at most one owner.
        => db.Set<SquadMembership>()
            .FirstOrDefaultAsync(
                membership => membership.SquadId == squadId && membership.Role == SquadRole.Owner,
                cancellationToken);

    /// <inheritdoc />
    public Task<bool> IsSquadPendingDeletionAsync(Guid squadId, CancellationToken cancellationToken)
        // Probe the squad past the soft-delete filter so a pending-deletion squad is observable here
        // without loading it through the squad repository (Requirement 17.3).
        => db.Set<Squad>()
            .IgnoreQueryFilters()
            .AnyAsync(squad => squad.Id == squadId && squad.IsDeleted, cancellationToken);

    /// <inheritdoc />
    public Task<bool> DisplayNameTakenAsync(Guid squadId, string normalisedName, Guid? excludingMembershipId, CancellationToken cancellationToken)
    {
        // Anonymised rows carry a null DisplayNameNormalized and so never match a non-null name,
        // which frees a former name for reuse (Requirement 3.4, 18.1).
        IQueryable<SquadMembership> query = db.Set<SquadMembership>()
            .Where(membership => membership.SquadId == squadId
                && membership.DisplayNameNormalized == normalisedName);

        if (excludingMembershipId is { } excludedId)
        {
            // Exclude the membership itself so a rename or reactivation does not collide with its
            // own current name (Requirement 3.2, 3.3).
            query = query.Where(membership => membership.Id != excludedId);
        }

        return query.AnyAsync(cancellationToken);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<SquadMembership>> ListForUserAsync(Guid userId, CancellationToken cancellationToken)
        // Every membership backed by the user across all squads; guest rows (null user) never match
        // (Requirement 18.3, 18.4).
        => await db.Set<SquadMembership>()
            .Where(membership => membership.UserId == userId)
            .ToListAsync(cancellationToken);

    /// <inheritdoc />
    public void RemovePermanently(SquadMembership membership)
    {
        ArgumentNullException.ThrowIfNull(membership);

        // A membership with no match history is genuinely deleted rather than soft-deleted
        // (Requirement 18.2, 18.4); a history-bearing membership is anonymised and retained instead.
        db.Set<SquadMembership>().Remove(membership);
        db.MarkForHardDelete(membership);
    }
}
