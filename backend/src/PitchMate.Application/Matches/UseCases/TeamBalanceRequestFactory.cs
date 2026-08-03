using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;

// PitchMate.Domain.Matches, PitchMate.Domain.Rating, and PitchMate.Domain.Squads each define a
// Result<T>; import only the specific types this factory needs (rather than those namespaces) so the
// unqualified Result<T> binds to the Matches triad. The rating value type is aliased because the
// unqualified name `Rating` would otherwise collide with the PitchMate.Domain.Rating namespace.
using IRatingEngine = PitchMate.Domain.Rating.IRatingEngine;
using SkillTier = PitchMate.Domain.Rating.SkillTier;
using PlayerRating = PitchMate.Domain.Rating.Rating;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;
// IRatingEngine.CreateRating returns the rating-namespace Result<Rating>; alias it so the seed call's
// result type is explicit and distinct from the Matches Result<T> used for the factory's own return.
using RatingSeedResult = PitchMate.Domain.Rating.Result<PitchMate.Domain.Rating.Rating>;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Builds the <see cref="TeamBalanceRequest"/> handed to the <see cref="ITeamBalancer"/> from a
/// match's current participants and their squad-scoped ratings. Shared by the team-proposal and the
/// re-roll adjustment paths so both offer the balancer exactly the same participant/rating view
/// (Requirement 8.1, 8.8).
/// <para>
/// Each participant's current rating is read via <see cref="IMembershipRatingRepository.GetAsync"/>;
/// a membership with no rating yet — one that has never completed a match — is seeded in memory from
/// its <see cref="SquadMembership.SkillTier"/> via <see cref="IRatingEngine.CreateRating"/> so it can
/// still be balanced (<c>structure.md</c> "membership-centric ratings"). Seeding here is read-only:
/// the seed rating is used for the proposal only and is never persisted; the durable seed happens in
/// the atomic completion transaction (Requirement 12.1). The balancer itself consumes only the
/// ratings — never any identity-derived signal — and performs no rating arithmetic (Requirement 8.8).
/// </para>
/// </summary>
internal static class TeamBalanceRequestFactory
{
    /// <summary>
    /// Assembles the balancer request for <paramref name="match"/>, offering every participant (in
    /// stable roster order) paired with its current or seeded rating, split into
    /// <paramref name="teamCount"/> teams. Returns a validation failure only when a rating seed cannot
    /// be produced (an invalid rating-engine configuration); the participant-count and state
    /// preconditions are the caller's concern (Requirement 8.9).
    /// </summary>
    /// <param name="match">The match whose participants are offered to the balancer.</param>
    /// <param name="teamCount">The desired number of teams to form (2 for the MVP).</param>
    /// <param name="ratings">The membership-rating repository read for current ratings.</param>
    /// <param name="memberships">The membership repository read for skill tiers used to seed absent ratings.</param>
    /// <param name="ratingEngine">The rating engine used to seed a cold-start rating from a skill tier.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>A success carrying the assembled <see cref="TeamBalanceRequest"/>, or a validation failure.</returns>
    public static async Task<Result<TeamBalanceRequest>> BuildAsync(
        Match match,
        int teamCount,
        IMembershipRatingRepository ratings,
        ISquadMembershipRepository memberships,
        IRatingEngine ratingEngine,
        CancellationToken cancellationToken)
    {
        // Read the squad's memberships once so an unrated participant can be seeded from its skill tier.
        IReadOnlyList<SquadMembership> squadMembers =
            await memberships.ListForSquadAsync(match.SquadId, activeOnly: false, cancellationToken);
        Dictionary<Guid, SkillTier?> tierByMembership =
            squadMembers.ToDictionary(m => m.Id, m => m.SkillTier);

        var participants = new List<BalancerParticipant>(match.Participants.Count);
        foreach (MatchParticipant participant in match.Participants.OrderBy(p => p.RosterPosition))
        {
            PlayerRating rating;

            MembershipRating? current = await ratings.GetAsync(participant.SquadMembershipId, cancellationToken);
            if (current is not null)
            {
                rating = current.Rating;
            }
            else
            {
                SkillTier? tier = tierByMembership.TryGetValue(participant.SquadMembershipId, out SkillTier? t) ? t : null;
                RatingSeedResult seeded = ratingEngine.CreateRating(tier);
                if (!seeded.IsSuccess)
                {
                    return Result<TeamBalanceRequest>.Fail(new MatchError(
                        MatchErrorCode.ValidationFailed,
                        $"Could not seed a rating for participant {participant.SquadMembershipId}: {seeded.Error?.Message}"));
                }

                rating = seeded.Value;
            }

            participants.Add(new BalancerParticipant(participant.SquadMembershipId, rating));
        }

        return Result<TeamBalanceRequest>.Ok(new TeamBalanceRequest(participants, teamCount));
    }
}
