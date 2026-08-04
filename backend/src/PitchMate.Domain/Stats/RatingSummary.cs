using PitchMate.Domain.Rating;

// Alias the rating value type: within PitchMate.Domain.Stats the unqualified name `Rating`
// otherwise binds to the sibling namespace PitchMate.Domain.Rating rather than the Rating record.
using PlayerRating = PitchMate.Domain.Rating.Rating;

namespace PitchMate.Domain.Stats;

/// <summary>
/// The read-shaping summary of a <c>Squad_Membership</c>'s current rating. It distinguishes three
/// cases so a caller can tell them apart (Requirement 7.1, 7.2, 7.7):
/// <list type="bullet">
///   <item><description>
///     <b>Not-yet-established</b> — the membership has no <c>Membership_Rating</c>: all four values
///     are <see langword="null"/>.
///   </description></item>
///   <item><description>
///     <b>Provisional</b> — <see cref="Mu"/>/<see cref="Sigma"/> are set and <see cref="State"/> is
///     <see cref="RatingState.Provisional"/>, but <see cref="DisplayRating"/> is <see langword="null"/>.
///   </description></item>
///   <item><description>
///     <b>Established</b> — all four values are set.
///   </description></item>
/// </list>
/// The classification is obtained from <see cref="IRatingEngine.GetState"/>; this type never
/// re-implements the provisional rule (Requirement 7.2).
/// </summary>
/// <param name="Mu">The current mean skill estimate (μ), or <see langword="null"/> when not yet established.</param>
/// <param name="Sigma">The current uncertainty (σ), or <see langword="null"/> when not yet established.</param>
/// <param name="State">The provisional/established classification, or <see langword="null"/> when not yet established.</param>
/// <param name="DisplayRating">The friendly display number when established, otherwise <see langword="null"/>.</param>
public sealed record RatingSummary(double? Mu, double? Sigma, RatingState? State, int? DisplayRating)
{
    /// <summary>
    /// The summary for a membership with no <c>Membership_Rating</c>: no μ/σ pair, no
    /// <c>Rating_State</c>, and no <c>Display_Rating</c>, distinguishable from a provisional report
    /// (Requirement 7.7).
    /// </summary>
    public static RatingSummary NotYetEstablished { get; } = new(null, null, null, null);

    /// <summary>
    /// Builds the summary for a membership that has a <c>Membership_Rating</c>. Classifies the rating
    /// through <paramref name="engine"/>'s <see cref="IRatingEngine.GetState"/> (never re-implementing
    /// the rule, Requirement 7.2); a provisional rating carries μ/σ and a <see cref="RatingState.Provisional"/>
    /// state with no display number, while an established rating additionally carries the display number
    /// computed by <see cref="DisplayRatingCalculator"/> from <paramref name="parameters"/>.
    /// </summary>
    /// <param name="engine">The rating engine used solely to classify the rating's state.</param>
    /// <param name="mu">The membership's current mean skill estimate (μ).</param>
    /// <param name="sigma">The membership's current uncertainty (σ).</param>
    /// <param name="parameters">The squad's display-rating parameters.</param>
    /// <returns>A provisional or established summary for the supplied rating.</returns>
    /// <exception cref="InvalidOperationException">The engine could not classify the rating (invalid configuration).</exception>
    public static RatingSummary FromRating(
        IRatingEngine engine,
        double mu,
        double sigma,
        DisplayRatingParameters parameters)
    {
        ArgumentNullException.ThrowIfNull(engine);

        var stateResult = engine.GetState(new PlayerRating(mu, sigma));
        if (!stateResult.IsSuccess)
        {
            throw new InvalidOperationException(
                $"Unable to classify rating state for the summary: {stateResult.Error?.Message}");
        }

        var state = stateResult.Value;
        var displayRating = DisplayRatingCalculator.Compute(state, mu, sigma, parameters);
        return new RatingSummary(mu, sigma, state, displayRating);
    }
}
