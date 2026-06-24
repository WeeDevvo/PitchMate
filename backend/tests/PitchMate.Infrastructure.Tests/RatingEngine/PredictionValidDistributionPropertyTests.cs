using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Property test for the shape and validity of <see cref="PlackettLuceRatingEngine.Predict"/>'s
/// output. For any two or more non-empty rosters of valid ratings, <c>Predict</c> must return one
/// win probability per roster (each in [0, 1]) whose sum is 1.0 within tolerance, plus a single
/// draw probability in [0, 1] that is computed independently and excluded from the win-probability
/// sum.
/// </summary>
public class PredictionValidDistributionPropertyTests
{
    // Feature: rating-engine, Property 19: Prediction produces a valid probability distribution
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(RatingArbitraries) })]
    public Property PredictionProducesAValidProbabilityDistribution(
        RatingEngineConfig config,
        TeamRoster first,
        TeamRoster second,
        TeamRoster[] rest)
    {
        // Two or more non-empty rosters: the TeamRoster arbitrary always yields a roster of 1–5
        // valid ratings (finite μ, σ > 0), so prepending two guaranteed rosters keeps the input
        // non-empty and at least two strong (Requirement 10.1).
        var rosters = new List<TeamRoster> { first, second };
        rosters.AddRange(rest);

        var engine = new PlackettLuceRatingEngine(config);

        var result = engine.Predict(rosters);

        // A valid roster set (2+ non-empty rosters of valid ratings) always predicts successfully.
        if (!result.IsSuccess)
        {
            return false.ToProperty();
        }

        var prediction = result.Value!;
        var winProbabilities = prediction.WinProbabilities;

        // One win probability per roster (Requirement 10.1).
        if (winProbabilities.Count != rosters.Count)
        {
            return false.ToProperty();
        }

        // Each win probability is a valid probability in [0, 1] (Requirement 10.3).
        var allWinProbabilitiesInRange = winProbabilities.All(p => p is >= 0.0 and <= 1.0);

        // Win probabilities sum to 1.0 within the configured numeric tolerance (Requirement 10.4).
        // A small floating-point floor guards against the configured tolerance being tighter than the
        // rounding error accumulated while summing the normalised probabilities.
        var tolerance = Math.Max(config.NumericTolerance, 1e-9);
        var sum = winProbabilities.Sum();
        var winProbabilitiesSumToOne = Math.Abs(sum - 1.0) <= tolerance;

        // A single draw probability in [0, 1], computed independently and therefore excluded from the
        // win-probability sum that already totals 1.0 (Requirements 10.6). It is one value on the
        // prediction, never folded into the per-roster win probabilities above.
        var drawProbabilityInRange = prediction.DrawProbability is >= 0.0 and <= 1.0;

        return (allWinProbabilitiesInRange &&
                winProbabilitiesSumToOne &&
                drawProbabilityInRange).ToProperty();
    }
}
