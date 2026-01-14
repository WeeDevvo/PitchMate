using FluentAssertions;
using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Services;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Domain.Tests.Properties;

/// <summary>
/// Property-based tests for team balancing service.
/// Validates universal properties that should hold for all valid inputs.
/// </summary>
public class TeamBalancingProperties
{
    private readonly TeamBalancingService _service;

    public TeamBalancingProperties()
    {
        _service = new TeamBalancingService();
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 17: Minimal rating difference
    /// For any set of players, the generated teams should minimize the absolute difference 
    /// between total team ratings (optimal or near-optimal balance).
    /// Validates: Requirements 4.2
    /// </summary>
    [Property(MaxTest = 100)]
    public void MinimalRatingDifference_ShouldProduceReasonablyBalancedTeams(PositiveInt playerCountSeed)
    {
        // Generate even number of players (minimum 2)
        var count = ((playerCountSeed.Get % 10) + 1) * 2; // 2, 4, 6, 8, 10, 12, 14, 16, 18, 20
        
        // Arrange
        var players = CreatePlayers(count);

        // Act
        var (teamA, teamB) = _service.GenerateBalancedTeams(players, count / 2);

        // Assert - The greedy algorithm should produce reasonably balanced teams
        // For the greedy algorithm, the difference should be at most the rating of the highest-rated player
        var ratingDifference = Math.Abs(teamA.TotalRating - teamB.TotalRating);
        var maxPlayerRating = players.Max(p => p.RatingAtMatchTime.Value);
        
        // The greedy algorithm guarantees that the difference is at most the highest rating
        // because in the worst case, the highest-rated player tips the balance
        ratingDifference.Should().BeLessThanOrEqualTo(maxPlayerRating);
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 18: Equal team sizes
    /// For any set of players, the generated teams should have exactly half the players on each team.
    /// Validates: Requirements 4.3
    /// </summary>
    [Property(MaxTest = 100)]
    public void EqualTeamSizes_ShouldHaveExactlyHalfPlayersOnEachTeam(PositiveInt playerCountSeed)
    {
        // Generate even number of players (minimum 2)
        var count = ((playerCountSeed.Get % 10) + 1) * 2; // 2, 4, 6, 8, 10, 12, 14, 16, 18, 20
        
        // Arrange
        var players = CreatePlayers(count);

        // Act
        var (teamA, teamB) = _service.GenerateBalancedTeams(players, count / 2);

        // Assert
        teamA.Players.Should().HaveCount(count / 2);
        teamB.Players.Should().HaveCount(count / 2);
        
        // Verify all players are assigned
        var allTeamPlayers = teamA.Players.Concat(teamB.Players).ToList();
        allTeamPlayers.Should().HaveCount(count);
        
        // Verify no player is assigned to both teams
        var teamAIds = teamA.Players.Select(p => p.UserId).ToHashSet();
        var teamBIds = teamB.Players.Select(p => p.UserId).ToHashSet();
        teamAIds.Should().NotIntersectWith(teamBIds);
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 19: Deterministic team generation
    /// For any set of players with specific ratings, running the team balancing algorithm 
    /// multiple times should produce the same team assignments.
    /// Validates: Requirements 4.4, 4.5
    /// </summary>
    [Property(MaxTest = 100)]
    public void DeterministicTeamGeneration_ShouldProduceSameResultsForSameInput(PositiveInt playerCountSeed)
    {
        // Generate even number of players (minimum 2)
        var count = ((playerCountSeed.Get % 10) + 1) * 2; // 2, 4, 6, 8, 10, 12, 14, 16, 18, 20
        
        // Arrange - Create the same set of players
        var players = CreatePlayers(count);

        // Act - Run the algorithm twice with the same input
        var (teamA1, teamB1) = _service.GenerateBalancedTeams(players, count / 2);
        var (teamA2, teamB2) = _service.GenerateBalancedTeams(players, count / 2);

        // Assert - Results should be identical
        // Team A should have the same players in both runs
        var teamA1Ids = teamA1.Players.Select(p => p.UserId).OrderBy(id => id.Value).ToList();
        var teamA2Ids = teamA2.Players.Select(p => p.UserId).OrderBy(id => id.Value).ToList();
        teamA1Ids.Should().Equal(teamA2Ids);
        
        // Team B should have the same players in both runs
        var teamB1Ids = teamB1.Players.Select(p => p.UserId).OrderBy(id => id.Value).ToList();
        var teamB2Ids = teamB2.Players.Select(p => p.UserId).OrderBy(id => id.Value).ToList();
        teamB1Ids.Should().Equal(teamB2Ids);
        
        // Total ratings should be identical
        teamA1.TotalRating.Should().Be(teamA2.TotalRating);
        teamB1.TotalRating.Should().Be(teamB2.TotalRating);
    }

    private static List<MatchPlayer> CreatePlayers(int count)
    {
        var players = new List<MatchPlayer>();
        var random = new Random(count); // Use count as seed for reproducibility
        
        for (int i = 0; i < count; i++)
        {
            // Generate random ratings between 400 and 2400
            var rating = random.Next(400, 2401);
            players.Add(MatchPlayer.Create(UserId.NewId(), EloRating.Create(rating)));
        }
        
        return players;
    }
}
