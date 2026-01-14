using FluentAssertions;
using PitchMate.Domain.Services;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Domain.Tests.Services;

/// <summary>
/// Unit tests for TeamBalancingService.
/// Tests specific scenarios and edge cases for team balancing.
/// </summary>
public class TeamBalancingServiceTests
{
    private readonly TeamBalancingService _service;

    public TeamBalancingServiceTests()
    {
        _service = new TeamBalancingService();
    }

    [Fact]
    public void GenerateBalancedTeams_WithTwoPlayers_ShouldCreateTwoTeamsOfOne()
    {
        // Arrange
        var players = new List<MatchPlayer>
        {
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1200)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1000))
        };

        // Act
        var (teamA, teamB) = _service.GenerateBalancedTeams(players, 1);

        // Assert
        teamA.Players.Should().HaveCount(1);
        teamB.Players.Should().HaveCount(1);
        teamA.TotalRating.Should().Be(1200);
        teamB.TotalRating.Should().Be(1000);
    }

    [Fact]
    public void GenerateBalancedTeams_WithFourPlayers_ShouldCreateTwoTeamsOfTwo()
    {
        // Arrange
        var players = new List<MatchPlayer>
        {
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1400)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1200)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1100)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(900))
        };

        // Act
        var (teamA, teamB) = _service.GenerateBalancedTeams(players, 2);

        // Assert
        teamA.Players.Should().HaveCount(2);
        teamB.Players.Should().HaveCount(2);
        
        // With greedy algorithm: 1400 goes to A, 1200 to B, 1100 to B, 900 to A
        // TeamA: 1400 + 900 = 2300
        // TeamB: 1200 + 1100 = 2300
        var ratingDifference = Math.Abs(teamA.TotalRating - teamB.TotalRating);
        ratingDifference.Should().Be(0);
    }

    [Fact]
    public void GenerateBalancedTeams_WithTenPlayers_ShouldCreateTwoTeamsOfFive()
    {
        // Arrange
        var players = new List<MatchPlayer>
        {
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1500)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1400)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1300)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1200)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1100)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1000)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(900)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(800)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(700)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(600))
        };

        // Act
        var (teamA, teamB) = _service.GenerateBalancedTeams(players, 5);

        // Assert
        teamA.Players.Should().HaveCount(5);
        teamB.Players.Should().HaveCount(5);
        
        // Greedy should produce reasonably balanced teams
        var ratingDifference = Math.Abs(teamA.TotalRating - teamB.TotalRating);
        ratingDifference.Should().BeLessThanOrEqualTo(200); // Reasonable threshold
    }

    [Fact]
    public void GenerateBalancedTeams_WithEqualRatings_ShouldCreateEqualTeams()
    {
        // Arrange
        var players = new List<MatchPlayer>
        {
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1000)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1000)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1000)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1000))
        };

        // Act
        var (teamA, teamB) = _service.GenerateBalancedTeams(players, 2);

        // Assert
        teamA.Players.Should().HaveCount(2);
        teamB.Players.Should().HaveCount(2);
        teamA.TotalRating.Should().Be(2000);
        teamB.TotalRating.Should().Be(2000);
    }

    [Fact]
    public void GenerateBalancedTeams_WithVastlyDifferentRatings_ShouldBalanceAsWellAsPossible()
    {
        // Arrange
        var players = new List<MatchPlayer>
        {
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(2000)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1500)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(800)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(600))
        };

        // Act
        var (teamA, teamB) = _service.GenerateBalancedTeams(players, 2);

        // Assert
        teamA.Players.Should().HaveCount(2);
        teamB.Players.Should().HaveCount(2);
        
        // Greedy: 2000 to A, 1500 to B, 800 to B, 600 to A
        // TeamA: 2000 + 600 = 2600
        // TeamB: 1500 + 800 = 2300
        var ratingDifference = Math.Abs(teamA.TotalRating - teamB.TotalRating);
        ratingDifference.Should().Be(300);
    }

    [Fact]
    public void GenerateBalancedTeams_WithOddNumberOfPlayers_ShouldThrowArgumentException()
    {
        // Arrange
        var players = new List<MatchPlayer>
        {
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1000)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1000)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1000))
        };

        // Act & Assert
        var act = () => _service.GenerateBalancedTeams(players, 2);
        act.Should().Throw<ArgumentException>()
            .WithMessage("*even number*");
    }

    [Fact]
    public void GenerateBalancedTeams_WithLessThanTwoPlayers_ShouldThrowArgumentException()
    {
        // Arrange
        var players = new List<MatchPlayer>
        {
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1000))
        };

        // Act & Assert
        var act = () => _service.GenerateBalancedTeams(players, 1);
        act.Should().Throw<ArgumentException>()
            .WithMessage("*at least 2 players*");
    }

    [Fact]
    public void GenerateBalancedTeams_WithNullPlayers_ShouldThrowArgumentNullException()
    {
        // Act & Assert
        var act = () => _service.GenerateBalancedTeams(null!, 5);
        act.Should().Throw<ArgumentNullException>();
    }
}
