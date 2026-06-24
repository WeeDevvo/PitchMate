using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Property test for provisional classification on <see cref="PlackettLuceRatingEngine"/>. For any
/// valid configuration and any rating with finite μ and σ ≥ 0, <c>GetState</c> must return exactly
/// one state: Provisional when σ is strictly greater than the configured provisional threshold, and
/// Established when σ is less than or equal to the threshold (including the σ = 0 boundary).
/// </summary>
public class ProvisionalClassificationTests
{
    // Feature: rating-engine, Property 2: Provisional classification follows the σ threshold
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(RatingArbitraries) })]
    public Property ProvisionalClassificationFollowsTheSigmaThreshold(
        RatingEngineConfig config,
        Rating rating)
    {
        var engine = new PlackettLuceRatingEngine(config);
        var threshold = config.ProvisionalThreshold;

        // Candidate ratings with finite μ and σ ≥ 0. Alongside the randomly generated rating (σ > 0),
        // we pin the cases the design calls out explicitly — σ = 0 and σ exactly equal to the
        // threshold (both Established) plus a value just above the threshold (Provisional) — so the
        // boundary is exercised on every iteration regardless of where the random σ lands.
        var candidates = new[]
        {
            rating,                                          // random finite μ, σ > 0
            new Rating(rating.Mu, 0.0),                      // σ = 0 boundary => Established (1.5)
            new Rating(rating.Mu, threshold),                // σ = threshold => Established (1.4)
            new Rating(rating.Mu, threshold / 2.0),          // σ below threshold => Established (1.4)
            new Rating(rating.Mu, threshold + 1.0),          // σ above threshold => Provisional (1.3)
        };

        var allClassifiedCorrectly = candidates.All(candidate =>
        {
            var result = engine.GetState(candidate);

            // σ > threshold => Provisional; σ ≤ threshold (incl. 0) => Established (Requirements 1.3–1.5).
            var expected = candidate.Sigma > threshold
                ? RatingState.Provisional
                : RatingState.Established;

            // GetState succeeds and returns exactly the one expected state. The result is a single
            // RatingState value, so exactly one of Provisional/Established is reported (Requirement 1.6).
            return result.IsSuccess && result.Value == expected;
        });

        return allClassifiedCorrectly.ToProperty();
    }
}
