using PitchMate.Domain.Rating;

namespace PitchMate.Domain.Stats;

/// <summary>
/// The pure <c>Display_Rating</c> definition. Maps a rating's conservative estimate (μ − 3σ) to a
/// friendly, presentational whole number using the squad's <see cref="DisplayRatingParameters"/>,
/// producing <em>no number</em> while the rating is <see cref="RatingState.Provisional"/>
/// (Requirement 7.3, 7.4). The display rating is presentational only and is never an input to team
/// balancing or a rating update (Requirement 7.6).
/// </summary>
public static class DisplayRatingCalculator
{
    /// <summary>
    /// Computes the display rating for a rating whose <paramref name="state"/> has already been
    /// classified via <see cref="IRatingEngine.GetState"/>. Returns <see langword="null"/> when
    /// <paramref name="state"/> is <see cref="RatingState.Provisional"/> (no number is shown for a
    /// still-settling rating, Requirement 7.4); otherwise returns
    /// <c>max(Floor, round((μ − 3σ) × K + C))</c> as a whole number never below
    /// <see cref="DisplayRatingParameters.Floor"/>, rounding half away from zero (Requirement 7.3).
    /// </summary>
    /// <param name="state">The rating's provisional/established classification.</param>
    /// <param name="mu">The mean skill estimate (μ).</param>
    /// <param name="sigma">The uncertainty of the estimate (σ).</param>
    /// <param name="parameters">The squad's display-rating scale, offset, and floor.</param>
    /// <returns>The floored, rounded display rating, or <see langword="null"/> when provisional.</returns>
    public static int? Compute(RatingState state, double mu, double sigma, DisplayRatingParameters parameters)
    {
        if (state == RatingState.Provisional)
        {
            return null;
        }

        var mapped = ((mu - (3.0 * sigma)) * parameters.K) + parameters.C;
        var rounded = Math.Round(mapped, MidpointRounding.AwayFromZero);
        return (int)Math.Max(parameters.Floor, rounded);
    }
}
