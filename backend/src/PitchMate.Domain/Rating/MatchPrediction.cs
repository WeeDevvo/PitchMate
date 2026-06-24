namespace PitchMate.Domain.Rating;

/// <summary>
/// Per-team win probabilities (which sum to 1.0 within tolerance) plus an independent draw probability.
/// </summary>
/// <param name="WinProbabilities">One win probability per roster, in roster order; sums to 1.0 within tolerance.</param>
/// <param name="DrawProbability">A single draw probability computed independently and excluded from the win-probability sum.</param>
public sealed record MatchPrediction(IReadOnlyList<double> WinProbabilities, double DrawProbability);
