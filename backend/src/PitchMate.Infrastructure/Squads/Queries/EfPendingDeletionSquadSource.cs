using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Squads.Queries;

/// <summary>
/// EF Core implementation of <see cref="IPendingDeletionSquadSource"/>: one query over the squads table
/// with the soft-delete filter bypassed, restricted to squads where the user holds the active owner
/// membership (Requirement 17.4).
/// <para>
/// Bypassing the filter is the point of this read, and it bypasses it for memberships too, so the
/// membership predicate re-applies <c>!IsDeleted</c> itself.
/// </para>
/// </summary>
internal sealed class EfPendingDeletionSquadSource(PitchMateDbContext db) : IPendingDeletionSquadSource
{
    public async Task<IReadOnlyList<PendingDeletionSquad>> ListOwnedByAsync(
        Guid userId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
        => await db.Set<Squad>()
            .IgnoreQueryFilters()
            .Where(squad => squad.IsDeleted
                && squad.PurgeAt != null
                && squad.PurgeAt > now
                && db.Set<SquadMembership>().Any(membership =>
                    membership.SquadId == squad.Id
                    && membership.UserId == userId
                    && membership.Role == SquadRole.Owner
                    && membership.State == MembershipState.Active
                    && !membership.IsDeleted))
            .OrderBy(squad => squad.PurgeAt)
            .ThenBy(squad => squad.Id)
            .Select(squad => new PendingDeletionSquad(squad.Id, squad.Name, squad.PurgeAt!.Value))
            .ToListAsync(cancellationToken);
}
