using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Stats;

namespace PitchMate.Domain.Tests.Stats;

/// <summary>
/// Property-based tests for the pure win-percentage definition (stats-and-summaries design
/// Property 5, the pure win-percentage portion).
/// <para>
/// For any wins and appearances with <c>0 ≤ wins ≤ appearances</c>, <see cref="WinPercentage.Compute"/>
/// reports <em>no value</em> exactly when there is no appearance and otherwise a value equal to
/// <c>wins / appearances × 100</c> rounded to the nearest 0.1 with exact halves rounded up, lying in
/// the closed range 0.0..100.0 (Requirement 6.3, 6.4). The expected value is computed independently
/// with <see cref="decimal"/> arithmetic so the test does not merely re-run the implementation's
/// <see cref="double"/> path. The property runs at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "stats-and-summaries")]
public class WinPercentagePropertyTests
{
    // Feature: stats-and-summaries, Property 5: Record and win percentage - for any membership the
    // Win_Percentage is wins / appearances * 100 rounded to the nearest 0.1 with exact halves rounded
    // up and lies in [0.0, 100.0] when there is at least one appearance, and is reported as having no
    // value (not zero) when there is no appearance.
    // Validates: Requirements 6.3, 6.4
    [Property(MaxTest = 100)]
    [Trait("Property", "5")]
    public Property WinPercentageRoundsToNearestTenthAndReportsNoValueForNoAppearance() =>
        Prop.ForAll(Arb.From(RecordGen()), record =>
        {
            var (wins, appearances) = record;
            var result = WinPercentage.Compute(wins, appearances);

            if (appearances == 0)
            {
                // No appearance: no value, never zero (Requirement 6.4).
                return result is null;
            }

            if (result is not double value)
            {
                return false; // an appearance must yield a value (Requirement 6.3)
            }

            // Independent oracle via decimal: round-half-away-from-zero to one decimal place, clamped.
            var raw = (decimal)wins / appearances * 100m;
            var expected = Math.Round(raw, 1, MidpointRounding.AwayFromZero);
            var clamped = Math.Clamp(expected, 0m, 100m);

            var matchesOracle = Math.Abs(value - (double)clamped) < 1e-9;
            var inRange = value is >= 0.0 and <= 100.0;
            var roundedToTenth = Math.Abs(value - Math.Round(value, 1, MidpointRounding.AwayFromZero)) < 1e-9;

            return matchesOracle && inRange && roundedToTenth;
        });

    // ---- Generators -----------------------------------------------------------------------------

    /// <summary>
    /// Generates a valid record: an appearance count in 0..60 and a win count in 0..appearances, so the
    /// zero-appearance branch and a broad spread of exact and rounded percentages all arise.
    /// </summary>
    private static Gen<(int Wins, int Appearances)> RecordGen() =>
        from appearances in Gen.Choose(0, 60)
        from wins in Gen.Choose(0, Math.Max(appearances, 0))
        select (wins, appearances);
}
