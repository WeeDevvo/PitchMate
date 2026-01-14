using PitchMate.Domain.ValueObjects;

namespace PitchMate.Domain.Services;

/// <summary>
/// Domain service responsible for generating balanced teams based on player ratings.
/// Implements a greedy algorithm to minimize rating differences between teams.
/// </summary>
public interface ITeamBalancingService
{
    /// <summary>
    /// Generates two balanced teams from a list of players.
    /// Teams are balanced to minimize the absolute difference in total ratings.
    /// </summary>
    /// <param name="players">The list of players to distribute into teams</param>
    /// <param name="teamSize">The desired size for each team</param>
    /// <returns>A tuple containing the two balanced teams (TeamA, TeamB)</returns>
    /// <exception cref="ArgumentNullException">Thrown when players is null</exception>
    /// <exception cref="ArgumentException">Thrown when player count is odd or less than 2</exception>
    (Team teamA, Team teamB) GenerateBalancedTeams(
        IReadOnlyList<MatchPlayer> players,
        int teamSize);
}
