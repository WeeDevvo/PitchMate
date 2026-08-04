using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Stats;

namespace PitchMate.Domain.Tests.Stats;

/// <summary>
/// Property-based tests for the pure streak definitions (stats-and-summaries design Property 6).
/// <para>
/// For any chronological sequence of <see cref="PlayerResult"/>s, <see cref="StreakCalculator.LongestWinStreak"/>
/// equals the greatest number of consecutive <see cref="PlayerResult.Win"/> results and
/// <see cref="StreakCalculator.LongestUnbeatenStreak"/> equals the greatest number of consecutive
/// non-<see cref="PlayerResult.Loss"/> results; both are <c>0</c> for an empty sequence, the win
/// streak is <c>0</c> when no result is a win, and the unbeaten streak is <c>0</c> when every result
/// is a loss (Requirement 9.1–9.7). The expected values are computed by an independent run-splitting
/// oracle rather than the implementation's fold. The property runs at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "stats-and-summaries")]
public class StreakCalculatorPropertyTests
{
    // Feature: stats-and-summaries, Property 6: Longest win and unbeaten streaks - for any membership,
    // with its Player_Results in chronological order, the Win_Streak equals the greatest count of
    // consecutive Win results and the Unbeaten_Streak the greatest count of consecutive non-Loss (Win
    // or Draw) results; both are 0 for no appearance, the Win_Streak is 0 with no Win, and the
    // Unbeaten_Streak is 0 when every result is a Loss.
    // Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7
    [Property(MaxTest = 100)]
    [Trait("Property", "6")]
    public Property StreaksEqualLongestConsecutiveQualifyingRun() =>
        Prop.ForAll(Arb.From(ResultsGen()), results =>
        {
            var winStreak = StreakCalculator.LongestWinStreak(results);
            var unbeatenStreak = StreakCalculator.LongestUnbeatenStreak(results);

            var expectedWin = LongestRunOracle(results, r => r == PlayerResult.Win);
            var expectedUnbeaten = LongestRunOracle(results, r => r != PlayerResult.Loss);

            if (winStreak != expectedWin || unbeatenStreak != expectedUnbeaten)
            {
                return false;
            }

            // Both are non-negative and bounded by the sequence length.
            if (winStreak < 0 || unbeatenStreak < 0 || winStreak > results.Count || unbeatenStreak > results.Count)
            {
                return false;
            }

            // Every Win is also a non-Loss, so a run of wins is also an unbeaten run: win ≤ unbeaten.
            if (winStreak > unbeatenStreak)
            {
                return false;
            }

            // Empty sequence => both zero (Requirement 9.4).
            if (results.Count == 0 && (winStreak != 0 || unbeatenStreak != 0))
            {
                return false;
            }

            // No Win => win streak zero (Requirement 9.6).
            if (!results.Contains(PlayerResult.Win) && winStreak != 0)
            {
                return false;
            }

            // Every result a Loss (with at least one appearance) => unbeaten streak zero (Requirement 9.7).
            if (results.Count > 0 && results.All(r => r == PlayerResult.Loss) && unbeatenStreak != 0)
            {
                return false;
            }

            return true;
        });

    /// <summary>
    /// Independent oracle: the length of the longest maximal run of consecutive elements satisfying
    /// <paramref name="qualifies"/>, computed by scanning and tracking maximal qualifying segments.
    /// </summary>
    private static int LongestRunOracle(IReadOnlyList<PlayerResult> results, Func<PlayerResult, bool> qualifies)
    {
        var runs = new List<int>();
        var current = 0;
        foreach (var result in results)
        {
            if (qualifies(result))
            {
                current++;
            }
            else if (current > 0)
            {
                runs.Add(current);
                current = 0;
            }
        }

        if (current > 0)
        {
            runs.Add(current);
        }

        return runs.Count == 0 ? 0 : runs.Max();
    }

    // ---- Generators -----------------------------------------------------------------------------

    /// <summary>
    /// Generates a chronological sequence of 0..30 results drawn uniformly from the closed
    /// <see cref="PlayerResult"/> set, exercising empty, all-win, all-loss, all-draw, and mixed runs.
    /// </summary>
    private static Gen<IReadOnlyList<PlayerResult>> ResultsGen() =>
        from count in Gen.Choose(0, 30)
        from results in Gen.ArrayOf(Gen.Elements(PlayerResult.Win, PlayerResult.Draw, PlayerResult.Loss), count)
        select (IReadOnlyList<PlayerResult>)results;
}
