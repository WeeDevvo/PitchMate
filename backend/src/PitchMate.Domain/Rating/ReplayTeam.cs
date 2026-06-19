namespace PitchMate.Domain.Rating;

/// <summary>
/// One team in a replayed match: its participants plus the team's outcome rank
/// (lower = better; equal ranks denote a draw between those teams).
/// </summary>
/// <param name="Participants">The team's participants, referenced by opaque player index.</param>
/// <param name="Rank">The team's finishing rank; lower is better, equal ranks are tied.</param>
public sealed record ReplayTeam(IReadOnlyList<ReplayParticipant> Participants, int Rank);
