using FluentAssertions;
using PitchMate.Domain.Entities;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Domain.Tests.Entities;

public class MatchTests
{
    private static List<MatchPlayer> CreatePlayers(int count)
    {
        var players = new List<MatchPlayer>();
        for (int i = 0; i < count; i++)
        {
            players.Add(MatchPlayer.Create(UserId.NewId(), EloRating.Create(1000 + i * 100)));
        }
        return players;
    }

    #region Create Tests

    [Fact]
    public void Create_WithValidParameters_ShouldCreateMatch()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var scheduledAt = DateTime.UtcNow.AddDays(1);
        var players = CreatePlayers(4);
        var teamSize = 2;

        // Act
        var match = Match.Create(squadId, scheduledAt, players, teamSize);

        // Assert
        match.Should().NotBeNull();
        match.Id.Should().NotBeNull();
        match.SquadId.Should().Be(squadId);
        match.ScheduledAt.Should().Be(scheduledAt);
        match.TeamSize.Should().Be(teamSize);
        match.Status.Should().Be(MatchStatus.Pending);
        match.CreatedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(1));
        match.Players.Should().HaveCount(4);
        match.TeamA.Should().BeNull();
        match.TeamB.Should().BeNull();
        match.Result.Should().BeNull();
    }

    [Fact]
    public void Create_WithDefaultTeamSize_ShouldUse5()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var scheduledAt = DateTime.UtcNow.AddDays(1);
        var players = CreatePlayers(10);

        // Act
        var match = Match.Create(squadId, scheduledAt, players);

        // Assert
        match.TeamSize.Should().Be(5);
    }

    [Fact]
    public void Create_WithMinimumPlayers_ShouldSucceed()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var scheduledAt = DateTime.UtcNow.AddDays(1);
        var players = CreatePlayers(2);

        // Act
        var match = Match.Create(squadId, scheduledAt, players);

        // Assert
        match.Players.Should().HaveCount(2);
    }

    [Fact]
    public void Create_WithLessThanTwoPlayers_ShouldThrowArgumentException()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var scheduledAt = DateTime.UtcNow.AddDays(1);
        var players = CreatePlayers(1);

        // Act
        var act = () => Match.Create(squadId, scheduledAt, players);

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("Match must have at least 2 players.*");
    }

    [Fact]
    public void Create_WithOddNumberOfPlayers_ShouldThrowArgumentException()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var scheduledAt = DateTime.UtcNow.AddDays(1);
        var players = CreatePlayers(3);

        // Act
        var act = () => Match.Create(squadId, scheduledAt, players);

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("Match must have an even number of players.*");
    }

    [Fact]
    public void Create_WithZeroTeamSize_ShouldThrowArgumentException()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var scheduledAt = DateTime.UtcNow.AddDays(1);
        var players = CreatePlayers(4);

        // Act
        var act = () => Match.Create(squadId, scheduledAt, players, teamSize: 0);

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("Team size must be greater than zero.*");
    }

    [Fact]
    public void Create_WithNegativeTeamSize_ShouldThrowArgumentException()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var scheduledAt = DateTime.UtcNow.AddDays(1);
        var players = CreatePlayers(4);

        // Act
        var act = () => Match.Create(squadId, scheduledAt, players, teamSize: -1);

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("Team size must be greater than zero.*");
    }

    [Fact]
    public void Create_WithNullSquadId_ShouldThrowArgumentNullException()
    {
        // Arrange
        var scheduledAt = DateTime.UtcNow.AddDays(1);
        var players = CreatePlayers(4);

        // Act
        var act = () => Match.Create(null!, scheduledAt, players);

        // Assert
        act.Should().Throw<ArgumentNullException>()
            .WithParameterName("squadId");
    }

    [Fact]
    public void Create_WithNullPlayers_ShouldThrowArgumentNullException()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var scheduledAt = DateTime.UtcNow.AddDays(1);

        // Act
        var act = () => Match.Create(squadId, scheduledAt, null!);

        // Assert
        act.Should().Throw<ArgumentNullException>()
            .WithParameterName("players");
    }

    #endregion

    #region AssignTeams Tests

    [Fact]
    public void AssignTeams_WithValidTeams_ShouldAssignTeams()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var scheduledAt = DateTime.UtcNow.AddDays(1);
        var players = CreatePlayers(4);
        var match = Match.Create(squadId, scheduledAt, players);

        var teamA = Team.Create(players.Take(2));
        var teamB = Team.Create(players.Skip(2).Take(2));

        // Act
        match.AssignTeams(teamA, teamB);

        // Assert
        match.TeamA.Should().Be(teamA);
        match.TeamB.Should().Be(teamB);
    }

    [Fact]
    public void AssignTeams_WithNullTeamA_ShouldThrowArgumentNullException()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var scheduledAt = DateTime.UtcNow.AddDays(1);
        var players = CreatePlayers(4);
        var match = Match.Create(squadId, scheduledAt, players);

        var teamB = Team.Create(players.Skip(2).Take(2));

        // Act
        var act = () => match.AssignTeams(null!, teamB);

        // Assert
        act.Should().Throw<ArgumentNullException>()
            .WithParameterName("teamA");
    }

    [Fact]
    public void AssignTeams_WithNullTeamB_ShouldThrowArgumentNullException()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var scheduledAt = DateTime.UtcNow.AddDays(1);
        var players = CreatePlayers(4);
        var match = Match.Create(squadId, scheduledAt, players);

        var teamA = Team.Create(players.Take(2));

        // Act
        var act = () => match.AssignTeams(teamA, null!);

        // Assert
        act.Should().Throw<ArgumentNullException>()
            .WithParameterName("teamB");
    }

    [Fact]
    public void AssignTeams_WithMissingPlayers_ShouldThrowInvalidOperationException()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var scheduledAt = DateTime.UtcNow.AddDays(1);
        var players = CreatePlayers(4);
        var match = Match.Create(squadId, scheduledAt, players);

        var teamA = Team.Create(players.Take(1));
        var teamB = Team.Create(players.Skip(1).Take(1));

        // Act
        var act = () => match.AssignTeams(teamA, teamB);

        // Assert
        act.Should().Throw<InvalidOperationException>()
            .WithMessage("Team assignments must include all match players.");
    }

    [Fact]
    public void AssignTeams_WithDifferentPlayers_ShouldThrowInvalidOperationException()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var scheduledAt = DateTime.UtcNow.AddDays(1);
        var players = CreatePlayers(4);
        var match = Match.Create(squadId, scheduledAt, players);

        var differentPlayers = CreatePlayers(4);
        var teamA = Team.Create(differentPlayers.Take(2));
        var teamB = Team.Create(differentPlayers.Skip(2).Take(2));

        // Act
        var act = () => match.AssignTeams(teamA, teamB);

        // Assert
        act.Should().Throw<InvalidOperationException>()
            .WithMessage("Team assignments must include exactly the match players.");
    }

    #endregion

    #region RecordResult Tests

    [Fact]
    public void RecordResult_WithTeamAWin_ShouldRecordResult()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var scheduledAt = DateTime.UtcNow.AddDays(1);
        var players = CreatePlayers(4);
        var match = Match.Create(squadId, scheduledAt, players);

        // Act
        match.RecordResult(TeamDesignation.TeamA);

        // Assert
        match.Result.Should().NotBeNull();
        match.Result!.Winner.Should().Be(TeamDesignation.TeamA);
        match.Result.BalanceFeedback.Should().BeNull();
        match.Result.RecordedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(1));
        match.Status.Should().Be(MatchStatus.Completed);
    }

    [Fact]
    public void RecordResult_WithTeamBWin_ShouldRecordResult()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var scheduledAt = DateTime.UtcNow.AddDays(1);
        var players = CreatePlayers(4);
        var match = Match.Create(squadId, scheduledAt, players);

        // Act
        match.RecordResult(TeamDesignation.TeamB);

        // Assert
        match.Result.Should().NotBeNull();
        match.Result!.Winner.Should().Be(TeamDesignation.TeamB);
        match.Status.Should().Be(MatchStatus.Completed);
    }

    [Fact]
    public void RecordResult_WithDraw_ShouldRecordResult()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var scheduledAt = DateTime.UtcNow.AddDays(1);
        var players = CreatePlayers(4);
        var match = Match.Create(squadId, scheduledAt, players);

        // Act
        match.RecordResult(TeamDesignation.Draw);

        // Assert
        match.Result.Should().NotBeNull();
        match.Result!.Winner.Should().Be(TeamDesignation.Draw);
        match.Status.Should().Be(MatchStatus.Completed);
    }

    [Fact]
    public void RecordResult_WithBalanceFeedback_ShouldStoreFeedback()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var scheduledAt = DateTime.UtcNow.AddDays(1);
        var players = CreatePlayers(4);
        var match = Match.Create(squadId, scheduledAt, players);
        var feedback = "Teams were well balanced";

        // Act
        match.RecordResult(TeamDesignation.TeamA, feedback);

        // Assert
        match.Result.Should().NotBeNull();
        match.Result!.BalanceFeedback.Should().Be(feedback);
    }

    [Fact]
    public void RecordResult_ForCompletedMatch_ShouldThrowInvalidOperationException()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var scheduledAt = DateTime.UtcNow.AddDays(1);
        var players = CreatePlayers(4);
        var match = Match.Create(squadId, scheduledAt, players);
        match.RecordResult(TeamDesignation.TeamA);

        // Act
        var act = () => match.RecordResult(TeamDesignation.TeamB);

        // Assert
        act.Should().Throw<InvalidOperationException>()
            .WithMessage("Cannot record result for a match that is already completed.");
    }

    #endregion

    #region CanRecordResult Tests

    [Fact]
    public void CanRecordResult_ForPendingMatch_ShouldReturnTrue()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var scheduledAt = DateTime.UtcNow.AddDays(1);
        var players = CreatePlayers(4);
        var match = Match.Create(squadId, scheduledAt, players);

        // Act
        var canRecord = match.CanRecordResult();

        // Assert
        canRecord.Should().BeTrue();
    }

    [Fact]
    public void CanRecordResult_ForCompletedMatch_ShouldReturnFalse()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var scheduledAt = DateTime.UtcNow.AddDays(1);
        var players = CreatePlayers(4);
        var match = Match.Create(squadId, scheduledAt, players);
        match.RecordResult(TeamDesignation.TeamA);

        // Act
        var canRecord = match.CanRecordResult();

        // Assert
        canRecord.Should().BeFalse();
    }

    #endregion
}
