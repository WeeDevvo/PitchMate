namespace PitchMate.Domain.Rating;

/// <summary>
/// A single player's skill estimate. Both values are finite; σ is strictly positive in valid ratings.
/// </summary>
/// <param name="Mu">The mean skill estimate (μ).</param>
/// <param name="Sigma">The uncertainty of the estimate (σ); strictly positive in valid ratings.</param>
public readonly record struct Rating(double Mu, double Sigma);
