using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Property test for rank-driven μ monotonicity in the identical-ratings case of
/// <see cref="PlackettLuceRatingEngine.UpdateRatings"/>. When every participating player starts
/// from an identical rating and one team is ranked strictly better than another, the
/// PlackettLuce mean shift must move the better-ranked team's μ up (≥ input μ) and the
/// worse-ranked team's μ down (≤ input μ). This is asserted ONLY for the symmetric
/// identical-ratings case (Requirement 3.4 and its scope note); μ monotonicity is not a general
/// guarantee when input ratings differ across teams. Comparisons allow the configured numeric
/// tolerance so boundary equality never produces a spurious failure.
/// </summary>
public class RankDrivenMuMonotonicityPropertyTests
{
    // Feature: rating-engine, Property 8: Rank ordering moves μ monotonically in the identical-ratings case
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(RatingArbitraries) })]
    public Property RankOrderingMovesMuMonotonicallyForIdenticalRatings(
        RatingEngineConfig config,
        Rating sharedRating,
        int betterTeamSizeSeed,
        int worseTeamSizeSeed)
    {
        var engine = new PlackettLuceRatingEngine(config);

        // Clamp the generated seeds into small positive player counts (1..4). Sizes may differ so
        // the scenario also exercises uneven teams.
        var betterTeamSize = 1 + Math.Abs(betterTeamSizeSeed % 4);
        var worseTeamSize = 1 + Math.Abs(worseTeamSizeSeed % 4);

        // Build a two-team match where EVERY player uses the SAME identical rating, and team A is
        // ranked strictly better (rank 0) than team B (rank 1). Identical ratings make the
        // direction of each team's μ shift depend solely on the rank ordering.
        var betterTeam = new TeamResult(
            Enumerable.Range(0, betterTeamSize).Select(_ => new PlayerInput(sharedRating)).ToList(),
            Rank: 0);
        var worseTeam = new TeamResult(
            Enumerable.Range(0, worseTeamSize).Select(_ => new PlayerInput(sharedRating)).ToList(),
            Rank: 1);

        var result = engine.UpdateRatings(new MatchOutcome(new List<TeamResult> { betterTeam, worseTeam }));

        // A two-team match of identical, valid ratings with distinct ranks is structurally valid
        // and must succeed.
        if (!result.IsSuccess)
        {
            return false.ToProperty();
        }

        var tolerance = config.NumericTolerance;
        var updatedTeams = result.Value!.Teams;

        // The strictly-better-ranked team's players must not have their μ pushed below the input μ.
        var betterTeamNotLowered = updatedTeams[0]
            .All(updated => updated.Mu >= sharedRating.Mu - tolerance);

        // The strictly-worse-ranked team's players must not have their μ pushed above the input μ.
        var worseTeamNotRaised = updatedTeams[1]
            .All(updated => updated.Mu <= sharedRating.Mu + tolerance);

        return (betterTeamNotLowered && worseTeamNotRaised).ToProperty();
    }
}
