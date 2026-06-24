using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Property test for <see cref="PlackettLuceRatingEngine.DecayInactivity"/> when the input σ already
/// exceeds the configured initial uncertainty. Decay grows σ back toward the initial uncertainty after
/// inactivity, so a rating whose σ is already above that ceiling must never be inflated further: for
/// any non-negative inactivity duration the returned σ equals the input σ (and μ is preserved).
/// </summary>
public class DecayDoesNotInflateHighSigmaPropertyTests
{
    // Feature: rating-engine, Property 18: Decay never inflates an already-high σ
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(RatingArbitraries) })]
    public Property DecayNeverInflatesAnAlreadyHighSigma(
        RatingEngineConfig config,
        Rating rating,
        NonNegativeInt inactiveDays)
    {
        var engine = new PlackettLuceRatingEngine(config);

        // Derive a rating whose σ strictly exceeds the configured initial uncertainty by adding the
        // generated (strictly positive) σ as an offset, while keeping the generated finite μ.
        var highSigmaRating = rating with { Sigma = config.InitialUncertainty + rating.Sigma };

        var result = engine.DecayInactivity(highSigmaRating, inactiveDays.Get);

        // Decay succeeds and returns σ exactly equal to the input σ (Requirement 9.4); μ is unchanged
        // (Requirement 9.2). The input σ is unbounded above, so equality is exact, not within tolerance.
        var sigmaUnchanged = result.IsSuccess
            && result.Value!.Sigma == highSigmaRating.Sigma
            && result.Value!.Mu == highSigmaRating.Mu;

        return sigmaUnchanged.ToProperty();
    }
}
