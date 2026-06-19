namespace PitchMate.Domain.Rating;

/// <summary>
/// A roster for prediction (ratings only; no ranks).
/// </summary>
/// <param name="Players">The roster's player ratings.</param>
public sealed record TeamRoster(IReadOnlyList<Rating> Players);
