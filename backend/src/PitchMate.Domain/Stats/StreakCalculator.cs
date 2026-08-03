namespace PitchMate.Domain.Stats;

/// <summary>
/// The pure streak definitions. Both operations fold a <em>caller-supplied chronological</em>
/// sequence of <see cref="PlayerResult"/>s — ordered by the producing match's completion instant then
/// match identity — into the longest run of qualifying results, returning <c>0</c> for an empty
/// sequence (Requirement 9.2, 9.3, 9.4, 9.5, 9.6, 9.7).
/// </summary>
public static class StreakCalculator
{
    /// <summary>
    /// Computes the <c>Win_Streak</c>: the greatest number of consecutive <see cref="PlayerResult.Win"/>
    /// results in <paramref name="chronological"/>. Returns <c>0</c> for an empty sequence and <c>0</c>
    /// when no result is a win (Requirement 9.2, 9.4, 9.6).
    /// </summary>
    /// <param name="chronological">The membership's results in chronological order.</param>
    /// <returns>The longest run of consecutive wins.</returns>
    public static int LongestWinStreak(IReadOnlyList<PlayerResult> chronological) =>
        LongestRun(chronological, static result => result == PlayerResult.Win);

    /// <summary>
    /// Computes the <c>Unbeaten_Streak</c>: the greatest number of consecutive non-<see cref="PlayerResult.Loss"/>
    /// results (a <see cref="PlayerResult.Win"/> or a <see cref="PlayerResult.Draw"/>) in
    /// <paramref name="chronological"/>. Returns <c>0</c> for an empty sequence and <c>0</c> when every
    /// result is a loss (Requirement 9.3, 9.4, 9.7).
    /// </summary>
    /// <param name="chronological">The membership's results in chronological order.</param>
    /// <returns>The longest run of consecutive non-loss results.</returns>
    public static int LongestUnbeatenStreak(IReadOnlyList<PlayerResult> chronological) =>
        LongestRun(chronological, static result => result != PlayerResult.Loss);

    /// <summary>
    /// Returns the length of the longest run of consecutive results in <paramref name="chronological"/>
    /// for which <paramref name="qualifies"/> holds; a non-qualifying result resets the running count.
    /// </summary>
    private static int LongestRun(IReadOnlyList<PlayerResult> chronological, Func<PlayerResult, bool> qualifies)
    {
        ArgumentNullException.ThrowIfNull(chronological);

        var longest = 0;
        var current = 0;
        foreach (var result in chronological)
        {
            if (qualifies(result))
            {
                current++;
                if (current > longest)
                {
                    longest = current;
                }
            }
            else
            {
                current = 0;
            }
        }

        return longest;
    }
}
