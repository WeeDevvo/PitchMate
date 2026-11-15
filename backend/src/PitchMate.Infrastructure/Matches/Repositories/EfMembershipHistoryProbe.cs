using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.LiveTracking;
using PitchMate.Domain.Matches;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Matches.Repositories;

/// <summary>
/// Database-backed <see cref="IMembershipHistoryProbe"/> checking whether a squad membership has
/// any match participation, rating history, or live-tracking event history across matches. When
/// history is present, erasure must anonymise the membership row (<c>"Former player"</c>) rather
/// than hard-deleting it so immutable match history and chronological rating replay remain valid.
/// </summary>
internal sealed class EfMembershipHistoryProbe(PitchMateDbContext db) : IMembershipHistoryProbe
{
    /// <inheritdoc />
    public async Task<bool> HasMatchHistoryAsync(
        Guid squadMembershipId,
        CancellationToken cancellationToken)
    {
        if (await db.Set<MatchParticipant>()
                .AnyAsync(participant => participant.SquadMembershipId == squadMembershipId, cancellationToken))
        {
            return true;
        }

        if (await db.Set<RatingSnapshot>()
                .AnyAsync(snapshot => snapshot.SquadMembershipId == squadMembershipId, cancellationToken))
        {
            return true;
        }

        if (await db.Set<MembershipRating>()
                .AnyAsync(rating => rating.SquadMembershipId == squadMembershipId, cancellationToken))
        {
            return true;
        }

        if (await db.Set<MatchEvent>()
                .OfType<GoalScoredEvent>()
                .AnyAsync(goal => goal.ScorerMembershipId == squadMembershipId, cancellationToken))
        {
            return true;
        }

        return await db.Set<MatchEvent>()
            .OfType<KeeperStintStartedEvent>()
            .AnyAsync(stint => stint.KeeperMembershipId == squadMembershipId, cancellationToken);
    }
}
