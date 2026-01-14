using FluentAssertions;
using PitchMate.Domain.Services;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Domain.Tests.Services;

/// <summary>
/// Unit tests for ELO calculation service.
/// Tests specific scenarios and edge cases.
/// </summary>
public class EloCalculationServiceTests
{
    private readonly EloCalculationService _service;

    public EloCalculationServiceTests()
    {
        _service = new EloCalculationService();
    }

    [Fact]
    public void CalculateRatingChanges_WhenTeamAWins_ShouldIncreaseTeamARatingsAndDecreaseTeamBRatings()
    {
        // Arrange
        var teamA = CreateTeamWithRatings(1000, 1000);
        var teamB = CreateTeamWithRatings(1000, 1000);
        var kFactor = 32;

        // Act
        var changes = _service.CalculateRatingChanges(teamA, teamB, TeamDesignation.TeamA, kFactor);

        // Assert
        foreach (var player in teamA.Players)
        {
            changes[player.UserId].Should().BeGreaterThan(0, "TeamA players should gain rating");
        }

        foreach (var player in teamB.Players)
        {
            changes[player.UserId].Should().BeLessThan(0, "TeamB players should lose rating");
        }

        // Zero-sum property
        changes.Values.Sum().Should().Be(0);
    }

    [Fact]
    public void CalculateRatingChanges_WhenTeamBWins_ShouldIncreaseTeamBRatingsAndDecreaseTeamARatings()
    {
        // Arrange
        var teamA = CreateTeamWithRatings(1000, 1000);
        var teamB = CreateTeamWithRatings(1000, 1000);
        var kFactor = 32;

        // Act
        var changes = _service.CalculateRatingChanges(teamA, teamB, TeamDesignation.TeamB, kFactor);

        // Assert
        foreach (var player in teamA.Players)
        {
            changes[player.UserId].Should().BeLessThan(0, "TeamA players should lose rating");
        }

        foreach (var player in teamB.Players)
        {
            changes[player.UserId].Should().BeGreaterThan(0, "TeamB players should gain rating");
        }

        // Zero-sum property
        changes.Values.Sum().Should().Be(0);
    }

    [Fact]
    public void CalculateRatingChanges_WhenDraw_ShouldAdjustRatingsBasedOnExpectedOutcome()
    {
        // Arrange - Equal teams
        var teamA = CreateTeamWithRatings(1000, 1000);
        var teamB = CreateTeamWithRatings(1000, 1000);
        var kFactor = 32;

        // Act
        var changes = _service.CalculateRatingChanges(teamA, teamB, TeamDesignation.Draw, kFactor);

        // Assert - With equal ratings, a draw should result in no change (or minimal change due to rounding)
        foreach (var player in teamA.Players)
        {
            Math.Abs(changes[player.UserId]).Should().BeLessThanOrEqualTo(1);
        }

        foreach (var player in teamB.Players)
        {
            Math.Abs(changes[player.UserId]).Should().BeLessThanOrEqualTo(1);
        }

        // Zero-sum property
        changes.Values.Sum().Should().Be(0);
    }

    [Fact]
    public void CalculateRatingChanges_WhenHigherRatedTeamWins_ShouldHaveSmallerRatingChange()
    {
        // Arrange - TeamA is much higher rated
        var teamA = CreateTeamWithRatings(1600, 1600);
        var teamB = CreateTeamWithRatings(1000, 1000);
        var kFactor = 32;

        // Act
        var changesAWins = _service.CalculateRatingChanges(teamA, teamB, TeamDesignation.TeamA, kFactor);

        // Assert - Higher rated team winning should gain less rating
        var teamAChange = changesAWins[teamA.Players.First().UserId];
        teamAChange.Should().BeGreaterThan(0, "winning team should gain rating");
        teamAChange.Should().BeLessThan(16, "higher rated team should gain less than half of K-factor");
    }

    [Fact]
    public void CalculateRatingChanges_WhenLowerRatedTeamWins_ShouldHaveLargerRatingChange()
    {
        // Arrange - TeamB is much lower rated
        var teamA = CreateTeamWithRatings(1600, 1600);
        var teamB = CreateTeamWithRatings(1000, 1000);
        var kFactor = 32;

        // Act
        var changesBWins = _service.CalculateRatingChanges(teamA, teamB, TeamDesignation.TeamB, kFactor);

        // Assert - Lower rated team winning should gain more rating
        var teamBChange = changesBWins[teamB.Players.First().UserId];
        teamBChange.Should().BeGreaterThan(16, "lower rated team should gain more than half of K-factor");
    }

    [Fact]
    public void CalculateRatingChanges_WithDifferentKFactors_ShouldScaleChangesProportionally()
    {
        // Arrange
        var teamA = CreateTeamWithRatings(1200, 1200);
        var teamB = CreateTeamWithRatings(1000, 1000);

        // Act
        var changesK16 = _service.CalculateRatingChanges(teamA, teamB, TeamDesignation.TeamA, 16);
        var changesK32 = _service.CalculateRatingChanges(teamA, teamB, TeamDesignation.TeamA, 32);
        var changesK48 = _service.CalculateRatingChanges(teamA, teamB, TeamDesignation.TeamA, 48);

        // Assert - Changes should scale with K-factor
        var changeK16 = changesK16[teamA.Players.First().UserId];
        var changeK32 = changesK32[teamA.Players.First().UserId];
        var changeK48 = changesK48[teamA.Players.First().UserId];

        changeK32.Should().BeGreaterThan(changeK16, "higher K-factor should produce larger changes");
        changeK48.Should().BeGreaterThan(changeK32, "higher K-factor should produce larger changes");

        // Approximate 2x relationship (allowing for rounding)
        Math.Abs(changeK32 - (changeK16 * 2)).Should().BeLessThanOrEqualTo(2);
    }

    [Fact]
    public void CalculateRatingChanges_WithEqualRatings_ShouldProduceSymmetricChanges()
    {
        // Arrange - Both teams have equal average ratings
        var teamA = CreateTeamWithRatings(1200, 1200);
        var teamB = CreateTeamWithRatings(1200, 1200);
        var kFactor = 32;

        // Act
        var changes = _service.CalculateRatingChanges(teamA, teamB, TeamDesignation.TeamA, kFactor);

        // Assert - With equal ratings, expected score is 0.5, so winner gets K/2 and loser loses K/2
        var teamAChange = changes[teamA.Players.First().UserId];
        var teamBChange = changes[teamB.Players.First().UserId];

        teamAChange.Should().BeCloseTo(16, 1, "with equal ratings, winner should gain approximately K/2");
        teamBChange.Should().BeCloseTo(-16, 1, "with equal ratings, loser should lose approximately K/2");
    }

    [Fact]
    public void CalculateRatingChanges_WithUnequalTeamSizes_ShouldStillMaintainZeroSum()
    {
        // Arrange - Different team sizes (3 vs 3)
        var teamA = CreateTeamWithRatings(1000, 1000, 1000);
        var teamB = CreateTeamWithRatings(1200, 1200, 1200);
        var kFactor = 32;

        // Act
        var changes = _service.CalculateRatingChanges(teamA, teamB, TeamDesignation.TeamA, kFactor);

        // Assert - Zero-sum property must hold
        changes.Values.Sum().Should().Be(0);

        // All players on same team should have same change
        var teamAChanges = teamA.Players.Select(p => changes[p.UserId]).Distinct().ToList();
        teamAChanges.Should().HaveCount(1);

        var teamBChanges = teamB.Players.Select(p => changes[p.UserId]).Distinct().ToList();
        teamBChanges.Should().HaveCount(1);
    }

    [Fact]
    public void CalculateRatingChanges_WhenTeamAIsNull_ShouldThrowArgumentNullException()
    {
        // Arrange
        var teamB = CreateTeamWithRatings(1000, 1000);

        // Act
        var act = () => _service.CalculateRatingChanges(null!, teamB, TeamDesignation.TeamA, 32);

        // Assert
        act.Should().Throw<ArgumentNullException>()
            .WithParameterName("teamA");
    }

    [Fact]
    public void CalculateRatingChanges_WhenTeamBIsNull_ShouldThrowArgumentNullException()
    {
        // Arrange
        var teamA = CreateTeamWithRatings(1000, 1000);

        // Act
        var act = () => _service.CalculateRatingChanges(teamA, null!, TeamDesignation.TeamA, 32);

        // Assert
        act.Should().Throw<ArgumentNullException>()
            .WithParameterName("teamB");
    }

    [Fact]
    public void CalculateRatingChanges_WhenKFactorIsZero_ShouldThrowArgumentException()
    {
        // Arrange
        var teamA = CreateTeamWithRatings(1000, 1000);
        var teamB = CreateTeamWithRatings(1000, 1000);

        // Act
        var act = () => _service.CalculateRatingChanges(teamA, teamB, TeamDesignation.TeamA, 0);

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("*K-factor must be positive*")
            .WithParameterName("kFactor");
    }

    [Fact]
    public void CalculateRatingChanges_WhenKFactorIsNegative_ShouldThrowArgumentException()
    {
        // Arrange
        var teamA = CreateTeamWithRatings(1000, 1000);
        var teamB = CreateTeamWithRatings(1000, 1000);

        // Act
        var act = () => _service.CalculateRatingChanges(teamA, teamB, TeamDesignation.TeamA, -10);

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("*K-factor must be positive*")
            .WithParameterName("kFactor");
    }

    private static Team CreateTeamWithRatings(params int[] ratings)
    {
        var players = ratings.Select(rating =>
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(rating))
        ).ToList();

        return Team.Create(players);
    }
}
