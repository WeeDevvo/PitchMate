namespace PitchMate.Domain.Stats;

/// <summary>
/// The pure win-percentage definition. Computes a <c>Squad_Membership</c>'s <c>Win_Percentage</c>
/// from its <c>Win</c> count and <c>Appearance</c> count, reporting <em>no value</em> (rather than
/// zero) when the membership has no appearance (Requirement 6.3, 6.4).
/// </summary>
public static class WinPercentage
{
    /// <summary>
    /// Computes the win percentage as <paramref name="wins"/> divided by <paramref name="appearances"/>,
    /// multiplied by 100 and rounded to the nearest 0.1 with exact halves rounded up (away from zero),
    /// clamped to the closed range 0.0..100.0. Returns <see langword="null"/> when
    /// <paramref name="appearances"/> is zero, expressing "no value" (Requirement 6.3, 6.4).
    /// </summary>
    /// <param name="wins">The count of <c>Win</c> results; expected to be in the range 0..<paramref name="appearances"/>.</param>
    /// <param name="appearances">The count of appearances; a non-negative integer.</param>
    /// <returns>The rounded, clamped win percentage, or <see langword="null"/> when there is no appearance.</returns>
    public static double? Compute(int wins, int appearances)
    {
        if (appearances == 0)
        {
            return null;
        }

        var percentage = (double)wins / appearances * 100.0;
        var rounded = Math.Round(percentage, 1, MidpointRounding.AwayFromZero);
        return Math.Clamp(rounded, 0.0, 100.0);
    }
}
