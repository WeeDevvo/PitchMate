namespace PitchMate.Domain.Rating;

/// <summary>
/// Updated ratings for a processed match, preserving the input team and player ordering.
/// </summary>
/// <param name="Teams">Updated ratings grouped by team, mirroring the order of the input teams and players.</param>
public sealed record MatchUpdate(IReadOnlyList<IReadOnlyList<Rating>> Teams);
