using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Property test for cold-start seeding on <see cref="PlackettLuceRatingEngine"/>. A newly created
/// rating must take its σ from the configured initial uncertainty for every tier, take its μ from the
/// tier's configured mean (or the default mean when no tier is supplied), and the seeded tier means
/// must be strictly ordered Strong &gt; Average &gt; Beginner.
/// </summary>
public class ColdStartSeedingTests
{
    // Feature: rating-engine, Property 1: Cold-start seeding is correct and ordered
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(RatingArbitraries) })]
    public Property ColdStartSeedingIsCorrectAndOrdered(RatingEngineConfig config)
    {
        var engine = new PlackettLuceRatingEngine(config);

        var beginner = engine.CreateRating(SkillTier.Beginner);
        var average = engine.CreateRating(SkillTier.Average);
        var strong = engine.CreateRating(SkillTier.Strong);
        var unseeded = engine.CreateRating();

        // A valid config seeds every cold-start rating successfully.
        var allSucceeded =
            beginner.IsSuccess && average.IsSuccess && strong.IsSuccess && unseeded.IsSuccess;

        // σ equals the configured initial uncertainty for every tier and for the unseeded default
        // (Requirement 8.2): seeding the tier never changes σ.
        var sigmaSeededFromInitialUncertainty =
            beginner.Value.Sigma == config.InitialUncertainty &&
            average.Value.Sigma == config.InitialUncertainty &&
            strong.Value.Sigma == config.InitialUncertainty &&
            unseeded.Value.Sigma == config.InitialUncertainty;

        // μ equals the configured mean for the supplied tier (Requirements 1.2, 8.1), and the default
        // mean when no tier is given (Requirement 8.5).
        var muSeededFromTierMean =
            beginner.Value.Mu == config.BeginnerMean &&
            average.Value.Mu == config.AverageMean &&
            strong.Value.Mu == config.StrongMean &&
            unseeded.Value.Mu == config.DefaultMean;

        // The seeded tier means are strictly ordered Strong > Average > Beginner (Requirements 8.3, 8.4).
        var tierMeansStrictlyOrdered =
            strong.Value.Mu > average.Value.Mu &&
            average.Value.Mu > beginner.Value.Mu;

        return (allSucceeded &&
                sigmaSeededFromInitialUncertainty &&
                muSeededFromTierMean &&
                tierMeansStrictlyOrdered)
            .ToProperty();
    }
}
