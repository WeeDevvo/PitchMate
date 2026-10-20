namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// The rating engine's prediction for a split of the working teams (match-read-models Requirements
/// 4.9, 6.3): one win probability per team, in team order, plus an independently computed draw
/// probability. The win probabilities sum to 1 within the engine's tolerance; the draw probability is
/// not part of that sum.
/// <para>
/// It <b>mirrors</b> <c>Domain.Rating.MatchPrediction</c> rather than reusing it, so the wire is not
/// coupled to the engine's signature and no rating-namespace type appears on a match contract. The
/// quantities are exactly those <c>TeamProposal</c> already discloses to organisers.
/// </para>
/// </summary>
/// <param name="WinProbabilities">One win probability per team, in team order, each in [0, 1].</param>
/// <param name="DrawProbability">The probability of a draw, in [0, 1].</param>
public sealed record SplitPrediction(
    IReadOnlyList<double> WinProbabilities,
    double DrawProbability);
