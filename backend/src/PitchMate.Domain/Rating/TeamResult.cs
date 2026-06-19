namespace PitchMate.Domain.Rating;

/// <summary>
/// One team in a match: an ordered roster plus the team's outcome rank
/// (lower = better; equal ranks denote a draw between those teams).
/// </summary>
/// <param name="Players">The team's players, in a stable order that is preserved by the update.</param>
/// <param name="Rank">The team's finishing rank; lower is better, equal ranks are tied.</param>
public sealed record TeamResult(IReadOnlyList<PlayerInput> Players, int Rank);
