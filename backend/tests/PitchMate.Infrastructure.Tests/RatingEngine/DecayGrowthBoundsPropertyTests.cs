using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Property test for inactivity uncertainty decay on <see cref="PlackettLuceRatingEngine"/>. For any
/// valid rating and any non-negative inactivity duration in whole days, <c>DecayInactivity</c> must
/// preserve μ, never decrease σ, keep σ within the configured initial uncertainty when the input σ
/// starts at or below it, leave σ untouched within the decay-free period, and grow σ monotonically
/// with the duration (capped at the initial uncertainty).
/// </summary>
public class DecayGrowthBoundsPropertyTests
{
    // Feature: rating-engine, Property 17: Inactivity decay grows σ within bounds and preserves μ
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(RatingArbitraries) })]
    public Property InactivityDecayGrowsSigmaWithinBoundsAndPreservesMu(
        RatingEngineConfig config,
        Rating rating,
        NonNegativeInt firstDuration,
        NonNegativeInt secondDuration)
    {
        var engine = new PlackettLuceRatingEngine(config);
        var initialUncertainty = config.InitialUncertainty;
        var freePeriod = config.DecayFreePeriodDays;

        // Candidate durations in whole days, all non-negative. Alongside the two randomly generated
        // durations we pin the cases the property calls out explicitly — zero, the decay-free boundary,
        // and a long duration well past the free period — so the bounds are exercised on every iteration
        // regardless of where the random durations land. They are sorted so monotonicity can be checked
        // across the full set (Requirement 9.6).
        var durations = new[]
        {
            0,
            freePeriod,
            firstDuration.Get,
            secondDuration.Get,
            freePeriod + 1,
            freePeriod + 10_000,
        }
        .OrderBy(days => days)
        .ToArray();

        double? previousSigma = null;

        var allHold = durations.All(days =>
        {
            var result = engine.DecayInactivity(rating, days);
            if (!result.IsSuccess)
            {
                return false;
            }

            var decayed = result.Value;

            // μ is always preserved exactly (Requirement 9.2).
            if (decayed.Mu != rating.Mu)
            {
                return false;
            }

            // σ never decreases (Requirement 9.1).
            if (decayed.Sigma < rating.Sigma)
            {
                return false;
            }

            // When the input σ starts at or below the initial uncertainty, the returned σ stays within
            // that bound (Requirement 9.3). A small tolerance absorbs floating-point rounding in the cap.
            if (rating.Sigma <= initialUncertainty &&
                decayed.Sigma > initialUncertainty + config.NumericTolerance)
            {
                return false;
            }

            // Durations at or below the decay-free period leave σ unchanged (Requirement 9.5).
            if (days <= freePeriod && decayed.Sigma != rating.Sigma)
            {
                return false;
            }

            // A longer duration never yields a smaller σ than a shorter one, capped at the initial
            // uncertainty (Requirement 9.6). Durations are visited in ascending order.
            if (previousSigma is { } prior && decayed.Sigma < prior)
            {
                return false;
            }

            previousSigma = decayed.Sigma;
            return true;
        });

        return allHold.ToProperty();
    }
}
