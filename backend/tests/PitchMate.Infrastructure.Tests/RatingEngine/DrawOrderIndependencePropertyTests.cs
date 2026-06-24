using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Property test for draw order-independence on <see cref="PlackettLuceRatingEngine.UpdateRatings"/>.
/// Teams that share the same rank are a draw, so no winner/loser ordering may be imposed between them:
/// permuting the positions of tied teams must yield the same multiset of updated ratings (within the
/// configured numeric tolerance) over all players in the match.
/// </summary>
public class DrawOrderIndependencePropertyTests
{
    // Feature: rating-engine, Property 6: Draws are order-independent among tied teams
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(RatingArbitraries) })]
    public Property DrawsAreOrderIndependentAmongTiedTeams(
        RatingEngineConfig config,
        MatchOutcome outcome)
    {
        var engine = new PlackettLuceRatingEngine(config);

        // Force a genuine draw: make the first two teams share a rank, so a tied pair always
        // exists to permute (the generator only sometimes produces ties on its own). All other
        // teams keep their generated ranks (Requirement 3.2).
        var teams = outcome.Teams;
        var tiedRank = teams[0].Rank;
        var originalTeams = teams
            .Select((team, index) => index == 1 ? new TeamResult(team.Players, tiedRank) : team)
            .ToList();

        // Permute the positions of the two tied teams (swap index 0 and index 1). Because they
        // share a rank, this is purely a reordering of tied teams and must not change outcomes.
        var permutedTeams = new List<TeamResult>(originalTeams)
        {
            [0] = originalTeams[1],
            [1] = originalTeams[0],
        };

        var originalResult = engine.UpdateRatings(new MatchOutcome(originalTeams));
        var permutedResult = engine.UpdateRatings(new MatchOutcome(permutedTeams));

        // Both forced-draw outcomes are structurally valid and must update successfully.
        if (!originalResult.IsSuccess || !permutedResult.IsSuccess)
        {
            return false.ToProperty();
        }

        // Compare as a multiset: flatten every updated rating across all teams, sort both result
        // sets by (Mu, Sigma), then compare element-wise within the configured numeric tolerance.
        // Multiset equality captures "same ratings produced" independent of team position.
        var originalSorted = Flatten(originalResult.Value!);
        var permutedSorted = Flatten(permutedResult.Value!);

        if (originalSorted.Count != permutedSorted.Count)
        {
            return false.ToProperty();
        }

        var tolerance = config.NumericTolerance;
        var multisetsEqual = originalSorted
            .Zip(permutedSorted, (a, b) =>
                Math.Abs(a.Mu - b.Mu) <= tolerance &&
                Math.Abs(a.Sigma - b.Sigma) <= tolerance)
            .All(equal => equal);

        return multisetsEqual.ToProperty();
    }

    /// <summary>Flattens every updated rating in the match and sorts by (Mu, Sigma) for multiset comparison.</summary>
    private static List<Rating> Flatten(MatchUpdate update) =>
        update.Teams
            .SelectMany(team => team)
            .OrderBy(rating => rating.Mu)
            .ThenBy(rating => rating.Sigma)
            .ToList();
}
