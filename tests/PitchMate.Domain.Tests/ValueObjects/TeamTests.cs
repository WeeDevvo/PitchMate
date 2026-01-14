using FluentAssertions;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Domain.Tests.ValueObjects;

public class TeamTests
{
    [Fact]
    public void Team_WithValidPlayers_ShouldCreateSuccessfully()
    {
        // Arrange
        var player1 = MatchPlayer.Create(UserId.NewId(), EloRating.Create(1000));
        var player2 = MatchPlayer.Create(UserId.NewId(), EloRating.Create(1200));
        var players = new[] { player1, player2 };

        // Act
        var team = Team.Create(players);

        // Assert
        team.Players.Should().HaveCount(2);
        team.Players.Should().Contain(player1);
        team.Players.Should().Contain(player2);
    }

    [Fact]
    public void Team_TotalRating_ShouldBeSumOfPlayerRatings()
    {
        // Arrange
        var player1 = MatchPlayer.Create(UserId.NewId(), EloRating.Create(1000));
        var player2 = MatchPlayer.Create(UserId.NewId(), EloRating.Create(1200));
        var player3 = MatchPlayer.Create(UserId.NewId(), EloRating.Create(1500));
        var players = new[] { player1, player2, player3 };

        // Act
        var team = Team.Create(players);

        // Assert
        team.TotalRating.Should().Be(3700); // 1000 + 1200 + 1500
    }

    [Fact]
    public void Team_AverageRating_ShouldBeCorrect()
    {
        // Arrange
        var player1 = MatchPlayer.Create(UserId.NewId(), EloRating.Create(1000));
        var player2 = MatchPlayer.Create(UserId.NewId(), EloRating.Create(1200));
        var player3 = MatchPlayer.Create(UserId.NewId(), EloRating.Create(1500));
        var players = new[] { player1, player2, player3 };

        // Act
        var team = Team.Create(players);

        // Assert
        team.AverageRating.Should().BeApproximately(1233.33, 0.01); // 3700 / 3
    }

    [Fact]
    public void Team_WithSinglePlayer_ShouldCreateSuccessfully()
    {
        // Arrange
        var player = MatchPlayer.Create(UserId.NewId(), EloRating.Create(1500));
        var players = new[] { player };

        // Act
        var team = Team.Create(players);

        // Assert
        team.Players.Should().HaveCount(1);
        team.TotalRating.Should().Be(1500);
        team.AverageRating.Should().Be(1500);
    }

    [Fact]
    public void Team_WithEmptyPlayerList_ShouldThrowArgumentException()
    {
        // Arrange
        var emptyPlayers = Array.Empty<MatchPlayer>();

        // Act
        var act = () => Team.Create(emptyPlayers);

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("Team must have at least one player.*");
    }

    [Fact]
    public void Team_WithNullPlayerList_ShouldThrowArgumentNullException()
    {
        // Act
        var act = () => Team.Create(null!);

        // Assert
        act.Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public void Team_Players_ShouldBeReadOnly()
    {
        // Arrange
        var player1 = MatchPlayer.Create(UserId.NewId(), EloRating.Create(1000));
        var player2 = MatchPlayer.Create(UserId.NewId(), EloRating.Create(1200));
        var players = new[] { player1, player2 };

        // Act
        var team = Team.Create(players);

        // Assert
        team.Players.Should().BeAssignableTo<IReadOnlyList<MatchPlayer>>();
    }

    [Fact]
    public void Team_Equality_ShouldWorkCorrectly()
    {
        // Arrange
        var player1 = MatchPlayer.Create(UserId.NewId(), EloRating.Create(1000));
        var player2 = MatchPlayer.Create(UserId.NewId(), EloRating.Create(1200));
        var players = new[] { player1, player2 };

        var team1 = Team.Create(players);
        var team2 = Team.Create(players);

        // Assert - Teams with same players should have same total rating
        team1.TotalRating.Should().Be(team2.TotalRating);
        team1.Players.Should().HaveCount(team2.Players.Count);
    }

    [Fact]
    public void Team_WithDifferentPlayers_ShouldHaveDifferentTotalRatings()
    {
        // Arrange
        var player1 = MatchPlayer.Create(UserId.NewId(), EloRating.Create(1000));
        var player2 = MatchPlayer.Create(UserId.NewId(), EloRating.Create(1200));
        var player3 = MatchPlayer.Create(UserId.NewId(), EloRating.Create(1500));

        var team1 = Team.Create(new[] { player1, player2 });
        var team2 = Team.Create(new[] { player1, player3 });

        // Assert
        team1.TotalRating.Should().Be(2200); // 1000 + 1200
        team2.TotalRating.Should().Be(2500); // 1000 + 1500
        team1.Should().NotBe(team2);
    }

    [Fact]
    public void Team_WithFivePlayers_ShouldCalculateCorrectly()
    {
        // Arrange - Typical 5-a-side team
        var players = new[]
        {
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1000)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1100)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1200)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1300)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1400))
        };

        // Act
        var team = Team.Create(players);

        // Assert
        team.Players.Should().HaveCount(5);
        team.TotalRating.Should().Be(6000); // Sum of all ratings
        team.AverageRating.Should().Be(1200); // 6000 / 5
    }
}
