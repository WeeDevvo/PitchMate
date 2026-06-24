using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Property test for the validity of <see cref="PlackettLuceRatingEngine.UpdateRatings"/> outputs.
/// For any valid <see cref="MatchOutcome"/>, every updated rating must have finite μ and finite σ,
/// with σ strictly greater than zero.
/// </summary>
public class UpdateValidOutputsPropertyTests
{
    // Feature: rating-engine, Property 4: Update outputs are valid ratings
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(RatingArbitraries) })]
    public Property UpdateOutputsAreValidRatings(
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

        // Every updated rating across every team must be a valid rating: finite μ, finite σ,
        // and σ strictly greater than zero (Requirements 1.1, 2.6).
        var allRatingsValid = result.Value!.Teams
            .SelectMany(team => team)
            .All(rating =>
                double.IsFinite(rating.Mu) &&
                double.IsFinite(rating.Sigma) &&
                rating.Sigma > 0.0);

        return allRatingsValid.ToProperty();
    }
}
