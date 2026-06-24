using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Property test for μ preservation in the all-tied, identical-ratings case of
/// <see cref="PlackettLuceRatingEngine.UpdateRatings"/>. When every team in a match shares the
/// same rank (a full draw) and every participating player starts from an identical rating, the
/// PlackettLuce mean-shift terms cancel, so each player's updated μ must equal the input μ within
/// the configured numeric tolerance. σ may still drop (evidence reduces uncertainty); only μ
/// preservation is asserted here.
/// </summary>
public class AllTiedIdenticalRatingsMuPreservationPropertyTests
{
    // Feature: rating-engine, Property 7: An all-tied match of identical ratings preserves μ
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(RatingArbitraries) })]
    public Property AllTiedIdenticalRatingsPreservesMu(
        RatingEngineConfig config,
        Rating sharedRating,
        int teamCountSeed,
        int playersPerTeamSeed)
    {
        var engine = new PlackettLuceRatingEngine(config);

        // Clamp the generated seeds into small valid ranges: at least two teams (a match needs
        // 2+ teams) and at least one player per team. Modulo keeps the test fast.
        var teamCount = 2 + Math.Abs(teamCountSeed % 4);          // 2..5 teams
        var playersPerTeam = 1 + Math.Abs(playersPerTeamSeed % 4); // 1..4 players per team

        // Build a fully-tied match (every team rank 0) where EVERY player uses the SAME rating.
        var teams = Enumerable
            .Range(0, teamCount)
            .Select(_ => new TeamResult(
                Enumerable
                    .Range(0, playersPerTeam)
                    .Select(_ => new PlayerInput(sharedRating))
                    .ToList(),
                Rank: 0))
            .ToList();

        var result = engine.UpdateRatings(new MatchOutcome(teams));

        // An all-tied match of identical, valid ratings is structurally valid and must succeed.
        if (!result.IsSuccess)
        {
            return false.ToProperty();
        }

        // Every updated player's μ must equal the input μ within the configured tolerance
        // (Requirement 3.3). σ is intentionally not asserted — it may legitimately decrease.
        var tolerance = config.NumericTolerance;
        var allMuPreserved = result.Value!.Teams
            .SelectMany(team => team)
            .All(updated => Math.Abs(updated.Mu - sharedRating.Mu) <= tolerance);

        return allMuPreserved.ToProperty();
    }
}
