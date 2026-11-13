namespace PitchMate.Domain.Stats;

/// <summary>
/// The pure <c>Display_Rating</c> definition: μ on a friendlier scale. Every rating has a number from
/// its first match, whatever its <see cref="Rating.RatingState"/>; σ never changes the number, it only
/// decides whether the rating is still settling (which callers report beside the number, from
/// <see cref="Rating.IRatingEngine.GetState"/>). The display rating is presentational only and is
/// never an input to team balancing or a rating update.
/// </summary>
public static class DisplayRatingCalculator
{
    /// <summary>
    /// The μ that maps to <see cref="DisplayRatingParameters.C"/>: the starting mean of an Average
    /// player. With the default scale a new Beginner (μ 20), Average (μ 25) or Strong (μ 30) player
    /// starts on 800, 1000 or 1200.
    /// </summary>
    public const double ReferenceMean = 25.0;

    /// <summary>
    /// Computes the display rating <c>max(Floor, round((μ − 25) × K + C))</c>: a whole number never
    /// below <see cref="DisplayRatingParameters.Floor"/>, rounding half away from zero.
    /// </summary>
    /// <param name="mu">The mean skill estimate (μ).</param>
    /// <param name="parameters">The display-rating scale, offset, and floor.</param>
    /// <returns>The floored, rounded display rating.</returns>
    public static int Compute(double mu, DisplayRatingParameters parameters)
    {
        var mapped = ((mu - ReferenceMean) * parameters.K) + parameters.C;
        var rounded = Math.Round(mapped, MidpointRounding.AwayFromZero);
        return (int)Math.Max(parameters.Floor, rounded);
    }
}
