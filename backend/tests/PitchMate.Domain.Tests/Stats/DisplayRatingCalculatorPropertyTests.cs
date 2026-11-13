using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Domain.Stats;
using PlayerRating = PitchMate.Domain.Rating.Rating;

namespace PitchMate.Domain.Tests.Stats;

/// <summary>
/// Property-based tests for the pure display-rating computation (stats-and-summaries design
/// Property 7).
/// <para>
/// For any rating (μ, σ) and <see cref="DisplayRatingParameters"/>, the display rating equals
/// <c>max(Floor, roundHalfUp((μ − 25) × K + C))</c> as a whole number never below the floor, in
/// either <see cref="RatingState"/>: σ decides whether the rating is settling and never the number.
/// Each of K, C, and Floor is taken from the parameters or defaults to 40, 1000, and 0 respectively
/// for any unconfigured value (Requirement 7.5). The expected rounding is computed by an independent
/// half-away-from-zero implementation. Each property runs at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "stats-and-summaries")]
public class DisplayRatingCalculatorPropertyTests
{
    // Feature: stats-and-summaries, Property 7: Display-rating computation - for any rating and
    // DisplayRatingParameters, the Display_Rating equals max(Floor, roundHalfUp((μ − 25) × K + C)),
    // never below the Floor; and each of K, C, Floor comes from the parameters or defaults to
    // 40, 1000, 0.
    // Validates: Requirements 7.3, 7.5
    [Property(MaxTest = 100)]
    [Trait("Property", "7")]
    public Property DisplayRatingMapsMuAndHonoursFloorAndDefaults() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var parameters = DisplayRatingParameters.Create(scenario.K, scenario.C, scenario.Floor);

            // Requirement 7.5: unconfigured (null) values default to 40, 1000, 0.
            var defaultsSubstituted =
                parameters.K == (scenario.K ?? DisplayRatingParameters.DefaultK)
                && parameters.C == (scenario.C ?? DisplayRatingParameters.DefaultC)
                && parameters.Floor == (scenario.Floor ?? DisplayRatingParameters.DefaultFloor);
            if (!defaultsSubstituted)
            {
                return false;
            }

            int value = DisplayRatingCalculator.Compute(scenario.Mu, parameters);

            // Independent half-away-from-zero oracle for μ mapped onto the friendly scale.
            var mapped = ((scenario.Mu - 25.0) * parameters.K) + parameters.C;
            var sign = mapped < 0 ? -1.0 : 1.0;
            var roundedOracle = sign * Math.Floor(Math.Abs(mapped) + 0.5);
            var expected = (int)Math.Max(parameters.Floor, roundedOracle);

            var neverBelowFloor = value >= parameters.Floor;
            return value == expected && neverBelowFloor;
        });

    // σ never changes the number: a summary built for the same μ at two different σ carries the same
    // display rating, present in both states, while the state itself is whatever the engine says for
    // that σ. So the number does not jump on the day a rating settles.
    [Property(MaxTest = 100)]
    public Property SigmaChangesTheStateAndNeverTheNumber() =>
        Prop.ForAll(Arb.From(ScenarioGen()), Arb.From(SigmaGen()), (scenario, otherSigma) =>
        {
            var parameters = DisplayRatingParameters.Create(scenario.K, scenario.C, scenario.Floor);
            var engine = new ThresholdRatingEngine(scenario.ProvisionalThreshold);

            var first = RatingSummary.FromRating(engine, scenario.Mu, scenario.Sigma, parameters);
            var second = RatingSummary.FromRating(engine, scenario.Mu, otherSigma, parameters);

            var sameNumber = first.DisplayRating is int number && second.DisplayRating == number
                && number == DisplayRatingCalculator.Compute(scenario.Mu, parameters);
            var statesFromEngine =
                first.State == engine.GetState(new PlayerRating(scenario.Mu, scenario.Sigma)).Value
                && second.State == engine.GetState(new PlayerRating(scenario.Mu, otherSigma)).Value;

            return sameNumber && statesFromEngine;
        });

    // The three skill tiers start on 800, 1000 and 1200 with the fixed scale, whatever σ they carry.
    [Theory]
    [InlineData(20.0, 800)]
    [InlineData(25.0, 1000)]
    [InlineData(30.0, 1200)]
    public void ANewPlayerStartsOnTheirTiersNumber(double tierMean, int expected) =>
        Assert.Equal(expected, DisplayRatingCalculator.Compute(tierMean, DisplayRatingParameters.Default));

    // A very low μ never shows a number below the floor.
    [Fact]
    public void TheNumberNeverFallsBelowTheFloor() =>
        Assert.Equal(0, DisplayRatingCalculator.Compute(-10.0, DisplayRatingParameters.Default));

    // ---- Generators -----------------------------------------------------------------------------

    /// <summary>A generated display-rating scenario: a rating, a classification threshold, and (optional) parameters.</summary>
    private sealed record Scenario(double Mu, double Sigma, double ProvisionalThreshold, double? K, double? C, double? Floor);

    /// <summary>
    /// Generates bounded, well-behaved doubles so both the provisional and established states arise
    /// (σ spans the threshold) and the mapped number stays within a sane whole-number range; each of
    /// K, C, and Floor is independently either unconfigured (null, exercising defaulting) or a value.
    /// </summary>
    private static Gen<Scenario> ScenarioGen() =>
        from mu in Gen.Choose(0, 5000).Select(i => i / 100.0)          // 0.00 .. 50.00
        from sigma in Gen.Choose(0, 1500).Select(i => i / 100.0)        // 0.00 .. 15.00
        from threshold in Gen.Choose(100, 900).Select(i => i / 100.0)   // 1.00 .. 9.00
        from k in OptionalDouble(Gen.Choose(1, 10000).Select(i => i / 100.0))     // 0.01 .. 100.00
        from c in OptionalDouble(Gen.Choose(0, 300000).Select(i => i / 100.0))    // 0.00 .. 3000.00
        from floor in OptionalDouble(Gen.Choose(0, 1000).Select(i => (double)i))  // whole-number floor 0 .. 1000
        select new Scenario(mu, sigma, threshold, k, c, floor);

    /// <summary>A σ spanning both sides of every generated threshold.</summary>
    private static Gen<double> SigmaGen() => Gen.Choose(0, 1500).Select(i => i / 100.0);

    /// <summary>Wraps <paramref name="value"/> so it is generated as <see langword="null"/> about a third of the time.</summary>
    private static Gen<double?> OptionalDouble(Gen<double> value) =>
        Gen.Frequency(
            (1, Gen.Constant((double?)null)),
            (2, value.Select(v => (double?)v)));
}
