using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Property test for the monotonic σ reduction of <see cref="PlackettLuceRatingEngine.UpdateRatings"/>.
/// For any valid <see cref="MatchOutcome"/>, every player's updated σ must be less than or equal to
/// that player's input σ — a match update observes evidence, so it can only reduce uncertainty.
/// </summary>
public class UpdateMonotonicSigmaPropertyTests
{
    // Feature: rating-engine, Property 5: Update never increases σ
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(RatingArbitraries) })]
    public Property UpdateNeverIncreasesSigma(
        RatingEngineConfig config,
        MatchOutcome outcome)
    {
        var engine = new PlackettLuceRatingEngine(config);

        var result = engine.UpdateRatings(outcome);

        // A valid outcome (2+ teams, ≥1 player each, ranks ≥ 0) always updates successfully
        // (Requirements 2.1, 2.3).
        if (!result.IsSuccess)
        {
            return false.ToProperty();
        }

        var updatedTeams = result.Value!.Teams;

        // Pair each updated rating with its input rating by preserved team and player ordering,
        // then assert every player's updated σ is ≤ its input σ (Requirement 2.5).
        var everySigmaNonIncreasing = Enumerable
            .Range(0, outcome.Teams.Count)
            .All(teamIndex => Enumerable
                .Range(0, outcome.Teams[teamIndex].Players.Count)
                .All(playerIndex =>
                    updatedTeams[teamIndex][playerIndex].Sigma
                        <= outcome.Teams[teamIndex].Players[playerIndex].Rating.Sigma));

        return everySigmaNonIncreasing.ToProperty();
    }
}
