using PitchMate.Domain.Rating;

namespace PitchMate.Application.Stats;

/// <summary>
/// A single point in a membership's rating progression — one per completed match in which the
/// membership has a <c>Rating_Snapshot</c>, ordered by completion instant then match identity
/// (Requirement 8.1, 8.2, 8.3, 8.6). Each point carries that snapshot's μ/σ, the
/// <see cref="RatingState"/> obtained from <c>IRatingEngine.GetState</c> on that σ, and a
/// <see cref="DisplayRating"/> present only when the point is <see cref="RatingState.Established"/>.
/// </summary>
/// <param name="CompletedAt">The completion instant of the match that produced the snapshot.</param>
/// <param name="Mu">The snapshot's mean skill estimate (μ).</param>
/// <param name="Sigma">The snapshot's uncertainty (σ).</param>
/// <param name="State">The provisional/established classification of the snapshot's σ.</param>
/// <param name="DisplayRating">The friendly display number when established, otherwise <see langword="null"/>.</param>
public sealed record RatingProgressionPoint(
    DateTimeOffset CompletedAt,
    double Mu,
    double Sigma,
    RatingState State,
    int? DisplayRating);
