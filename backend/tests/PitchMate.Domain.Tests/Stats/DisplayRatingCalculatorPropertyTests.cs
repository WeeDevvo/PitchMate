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
/// For any rating (μ, σ) and squad <see cref="DisplayRatingParameters"/>, the reported state equals
/// <see cref="IRatingEngine.GetState"/> for that rating (never re-implemented, Requirement 7.2); when
/// the state is <see cref="RatingState.Established"/> the display rating equals
/// <c>max(Floor, roundHalfUp((μ − 3σ) × K + C))</c> as a whole number never below the floor
/// (Requirement 7.3); when the state is <see cref="RatingState.Provisional"/> no display number is
/// produced (Requirement 7.4); and each of K, C, and Floor is taken from the parameters or defaults to
/// 40, 1000, and 0 respectively for any unconfigured value (Requirement 7.5). The expected rounding is
/// computed by an independent half-away-from-zero implementation. The property runs at least 100
/// iterations.
/// </para>
/// </summary>
[Trait("Feature", "stats-and-summaries")]
public class DisplayRatingCalculatorPropertyTests
{
    // Feature: stats-and-summaries, Property 7: Display-rating computation - for any rating and squad
    // DisplayRatingParameters, the state equals IRatingEngine.GetState; when Established the
    // Display_Rating equals max(Floor, roundHalfUp((μ − 3σ) × K + C)) never below the Floor; when
    // Provisional no number is produced; and each of K, C, Floor comes from the parameters or defaults
    // to 40, 1000, 0.
    // Validates: Requirements 7.2, 7.3, 7.4, 7.5
    [Property(MaxTest = 100)]
    [Trait("Property", "7")]
    public Property DisplayRatingMapsConservativeEstimateAndHonoursProvisionalAndDefaults() =>
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

            var engine = new ThresholdRatingEngine(scenario.ProvisionalThreshold);
            var state = engine.GetState(new PlayerRating(scenario.Mu, scenario.Sigma)).Value;

            var displayRating = DisplayRatingCalculator.Compute(state, scenario.Mu, scenario.Sigma, parameters);

            if (state == RatingState.Provisional)
            {
                // Requirement 7.4: no display number while provisional.
                return displayRating is null;
            }

            if (displayRating is not int value)
            {
                return false; // Requirement 7.3: an established rating yields a whole number
            }

            // Independent half-away-from-zero oracle for the mapped conservative estimate.
            var mapped = ((scenario.Mu - (3.0 * scenario.Sigma)) * parameters.K) + parameters.C;
            var sign = mapped < 0 ? -1.0 : 1.0;
            var roundedOracle = sign * Math.Floor(Math.Abs(mapped) + 0.5);
            var expected = (int)Math.Max(parameters.Floor, roundedOracle);

            var neverBelowFloor = value >= parameters.Floor;
            return value == expected && neverBelowFloor;
        });

    // ---- Generators -----------------------------------------------------------------------------

    /// <summary>A generated display-rating scenario: a rating, a classification threshold, and (optional) parameters.</summary>
    private sealed record Scenario(double Mu, double Sigma, double ProvisionalThreshold, double? K, double? C, double? Floor);

    /// <summary>
    /// Generates bounded, well-behaved doubles so both the provisional and established branches arise
    /// (σ spans the threshold) and the mapped estimate stays within a sane whole-number range; each of
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

    /// <summary>Wraps <paramref name="value"/> so it is generated as <see langword="null"/> about a third of the time.</summary>
    private static Gen<double?> OptionalDouble(Gen<double> value) =>
        Gen.Frequency(
            (1, Gen.Constant((double?)null)),
            (2, value.Select(v => (double?)v)));
}
