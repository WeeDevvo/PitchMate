namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// The rating engine's prediction for a split of the working teams (match-read-models Requirements
/// 4.9, 6.3): one win probability per team, in team order, plus the draw probability, as shares of
/// the whole outcome: the wins and the draw together sum to 1 (see <see cref="OutcomeShares"/>).
/// <para>
/// It <b>mirrors</b> <c>Domain.Rating.MatchPrediction</c> rather than reusing it, so the wire is not
/// coupled to the engine's signature and no rating-namespace type appears on a match contract. The
/// quantities are exactly those the team proposal discloses to organisers.
/// </para>
/// </summary>
/// <param name="WinProbabilities">One win probability per team, in team order, each in [0, 1].</param>
/// <param name="DrawProbability">The probability of a draw, in [0, 1].</param>
public sealed record SplitPrediction(
    IReadOnlyList<double> WinProbabilities,
    double DrawProbability)
{
    /// <summary>The prediction as outcome shares, from the engine's win probabilities and its draw.</summary>
    internal static SplitPrediction FromEngine(IReadOnlyList<double> winProbabilities, double drawProbability) =>
        new([.. winProbabilities.Select(win => OutcomeShares.Win(win, drawProbability))], drawProbability);
}
