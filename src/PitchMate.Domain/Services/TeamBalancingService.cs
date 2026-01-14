using PitchMate.Domain.ValueObjects;

namespace PitchMate.Domain.Services;

/// <summary>
/// Implementation of team balancing using a greedy algorithm.
/// Sorts players by rating and assigns each to the team with lower total rating.
/// This approach is deterministic and runs in O(n log n) time.
/// </summary>
public class TeamBalancingService : ITeamBalancingService
{
    /// <summary>
    /// Generates two balanced teams from a list of players using a greedy algorithm.
    /// Algorithm:
    /// 1. Sort players by rating (descending)
    /// 2. Initialize two empty teams
    /// 3. Iteratively assign each player to the team with lower total rating
    /// 4. Return the two balanced teams
    /// </summary>
    public (Team teamA, Team teamB) GenerateBalancedTeams(
        IReadOnlyList<MatchPlayer> players,
        int teamSize)
    {
        if (players == null)
            throw new ArgumentNullException(nameof(players));

        if (players.Count < 2)
            throw new ArgumentException("Must have at least 2 players to generate teams.", nameof(players));

        if (players.Count % 2 != 0)
            throw new ArgumentException("Must have an even number of players to generate teams.", nameof(players));

        if (teamSize <= 0)
            throw new ArgumentException("Team size must be greater than zero.", nameof(teamSize));

        // Sort players by rating in descending order (highest to lowest)
        // Use stable sort with secondary sort by UserId for determinism
        var sortedPlayers = players
            .OrderByDescending(p => p.RatingAtMatchTime.Value)
            .ThenBy(p => p.UserId.Value)
            .ToList();

        var teamAPlayers = new List<MatchPlayer>();
        var teamBPlayers = new List<MatchPlayer>();
        int teamARating = 0;
        int teamBRating = 0;

        // Greedy assignment: assign each player to the team with lower total rating
        foreach (var player in sortedPlayers)
        {
            if (teamARating <= teamBRating)
            {
                teamAPlayers.Add(player);
                teamARating += player.RatingAtMatchTime.Value;
            }
            else
            {
                teamBPlayers.Add(player);
                teamBRating += player.RatingAtMatchTime.Value;
            }
        }

        var teamA = Team.Create(teamAPlayers);
        var teamB = Team.Create(teamBPlayers);

        return (teamA, teamB);
    }
}
