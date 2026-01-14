using FluentAssertions;
using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Services;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Domain.Tests.Properties;

/// <summary>
/// Property-based tests for ELO calculation service.
/// Validates universal properties that should hold for all valid inputs.
/// </summary>
public class EloCalculationProperties
{
    private readonly EloCalculationService _service;

    public EloCalculationProperties()
    {
        _service = new EloCalculationService();
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 22: ELO formula correctness
    /// For any match result, the rating changes should be calculated using the team-based 
    /// ELO formula: ΔR = K × (S - E), where E = 1 / (1 + 10^((R_opponent - R_team) / 400)).
    /// Validates: Requirements 5.2
    /// </summary>
    [Property(MaxTest = 100)]
    public void EloFormulaCorrectness_ShouldCalculateChangesUsingStandardFormula(
        PositiveInt teamSizeSeed,
        PositiveInt kFactorSeed)
    {
        // Arrange
        var teamSize = (teamSizeSeed.Get % 5) + 1; // 1-5 players per team
        var kFactor = (kFactorSeed.Get % 50) + 10; // K-factor between 10-59
        
        var teamA = CreateTeam(teamSize, seed: 1);
        var teamB = CreateTeam(teamSize, seed: 2);
        
        // Calculate expected values manually
        double avgRatingA = teamA.AverageRating;
        double avgRatingB = teamB.AverageRating;
        double expectedScoreA = 1.0 / (1.0 + Math.Pow(10, (avgRatingB - avgRatingA) / 400.0));
        
        // Test for TeamA win
        double actualScoreA = 1.0;
        double expectedChangeA = kFactor * (actualScoreA - expectedScoreA);
        int expectedRatingChangeA = (int)Math.Round(expectedChangeA);

        // Act
        var changes = _service.CalculateRatingChanges(teamA, teamB, TeamDesignation.TeamA, kFactor);

        // Assert - All TeamA players should have the calculated change (within rounding tolerance)
        foreach (var player in teamA.Players)
        {
            var actualChange = changes[player.UserId];
            // Allow for small differences due to zero-sum adjustment
            Math.Abs(actualChange - expectedRatingChangeA).Should().BeLessThanOrEqualTo(1);
        }
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 23: Uniform team rating changes
    /// For any match result, all players on the same team should receive the same rating change.
    /// Validates: Requirements 5.3, 5.4
    /// </summary>
    [Property(MaxTest = 100)]
    public void UniformTeamRatingChanges_AllPlayersOnSameTeamShouldHaveSameChange(
        PositiveInt teamSizeSeed,
        PositiveInt kFactorSeed,
        bool teamAWins)
    {
        // Arrange
        var teamSize = (teamSizeSeed.Get % 5) + 1; // 1-5 players per team
        var kFactor = (kFactorSeed.Get % 50) + 10; // K-factor between 10-59
        
        var teamA = CreateTeam(teamSize, seed: 1);
        var teamB = CreateTeam(teamSize, seed: 2);
        
        var outcome = teamAWins ? TeamDesignation.TeamA : TeamDesignation.TeamB;

        // Act
        var changes = _service.CalculateRatingChanges(teamA, teamB, outcome, kFactor);

        // Assert - All players on TeamA should have the same change
        var teamAChanges = teamA.Players.Select(p => changes[p.UserId]).Distinct().ToList();
        teamAChanges.Should().HaveCount(1, "all TeamA players should have the same rating change");
        
        // All players on TeamB should have the same change
        var teamBChanges = teamB.Players.Select(p => changes[p.UserId]).Distinct().ToList();
        teamBChanges.Should().HaveCount(1, "all TeamB players should have the same rating change");
        
        // Winners should gain rating, losers should lose rating
        var teamAChange = teamAChanges.First();
        var teamBChange = teamBChanges.First();
        
        if (teamAWins)
        {
            teamAChange.Should().BeGreaterThan(0, "winning team should gain rating");
            teamBChange.Should().BeLessThan(0, "losing team should lose rating");
        }
        else
        {
            teamAChange.Should().BeLessThan(0, "losing team should lose rating");
            teamBChange.Should().BeGreaterThan(0, "winning team should gain rating");
        }
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 25: Zero-sum rating system
    /// For any match result, the sum of all rating changes across all players should equal zero.
    /// Validates: Requirements 5.6
    /// </summary>
    [Property(MaxTest = 100)]
    public void ZeroSumRatingSystem_TotalRatingChangesShouldEqualZero(
        PositiveInt teamSizeSeed,
        PositiveInt kFactorSeed,
        bool teamAWins)
    {
        // Arrange
        var teamSize = (teamSizeSeed.Get % 5) + 1; // 1-5 players per team
        var kFactor = (kFactorSeed.Get % 50) + 10; // K-factor between 10-59
        
        var teamA = CreateTeam(teamSize, seed: 1);
        var teamB = CreateTeam(teamSize, seed: 2);
        
        var outcome = teamAWins ? TeamDesignation.TeamA : TeamDesignation.TeamB;

        // Act
        var changes = _service.CalculateRatingChanges(teamA, teamB, outcome, kFactor);

        // Assert - Sum of all rating changes should be zero
        var totalChange = changes.Values.Sum();
        totalChange.Should().Be(0, "the rating system must be zero-sum");
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 24: Draw rating adjustments
    /// For any match ending in a draw, the higher-rated team should lose rating points 
    /// and the lower-rated team should gain rating points according to the ELO formula.
    /// Validates: Requirements 5.5
    /// </summary>
    [Property(MaxTest = 100)]
    public void DrawRatingAdjustments_HigherRatedTeamShouldLoseRating(
        PositiveInt teamSizeSeed,
        PositiveInt kFactorSeed)
    {
        // Arrange
        var teamSize = (teamSizeSeed.Get % 5) + 1; // 1-5 players per team
        var kFactor = (kFactorSeed.Get % 50) + 10; // K-factor between 10-59
        
        // Create teams with different average ratings
        var teamA = CreateTeamWithRating(teamSize, baseRating: 1500, seed: 1);
        var teamB = CreateTeamWithRating(teamSize, baseRating: 1200, seed: 2);
        
        // Ensure TeamA has higher rating
        if (teamA.AverageRating < teamB.AverageRating)
        {
            (teamA, teamB) = (teamB, teamA);
        }

        // Act
        var changes = _service.CalculateRatingChanges(teamA, teamB, TeamDesignation.Draw, kFactor);

        // Assert
        var teamAChange = changes[teamA.Players.First().UserId];
        var teamBChange = changes[teamB.Players.First().UserId];
        
        // Higher-rated team (TeamA) should lose rating in a draw
        teamAChange.Should().BeLessThan(0, "higher-rated team should lose rating in a draw");
        
        // Lower-rated team (TeamB) should gain rating in a draw
        teamBChange.Should().BeGreaterThan(0, "lower-rated team should gain rating in a draw");
        
        // Zero-sum property should still hold
        changes.Values.Sum().Should().Be(0);
    }

    private static Team CreateTeam(int playerCount, int seed)
    {
        var players = new List<MatchPlayer>();
        var random = new Random(seed);
        
        for (int i = 0; i < playerCount; i++)
        {
            var rating = random.Next(800, 1800); // Ratings between 800-1800
            players.Add(MatchPlayer.Create(UserId.NewId(), EloRating.Create(rating)));
        }
        
        return Team.Create(players);
    }

    private static Team CreateTeamWithRating(int playerCount, int baseRating, int seed)
    {
        var players = new List<MatchPlayer>();
        var random = new Random(seed);
        
        for (int i = 0; i < playerCount; i++)
        {
            // Create ratings close to the base rating (±100)
            var rating = baseRating + random.Next(-100, 101);
            rating = Math.Clamp(rating, EloRating.MinRating, EloRating.MaxRating);
            players.Add(MatchPlayer.Create(UserId.NewId(), EloRating.Create(rating)));
        }
        
        return Team.Create(players);
    }
}
