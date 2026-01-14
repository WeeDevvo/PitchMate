using FluentAssertions;
using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Entities;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Domain.Tests.Properties;

public class MatchProperties
{
    /// <summary>
    /// Feature: pitchmate-core, Property 14: Even player count validation
    /// For any match creation with an odd number of players, the system should reject the creation.
    /// Validates: Requirements 3.4
    /// </summary>
    [Property(MaxTest = 100)]
    public void EvenPlayerCountValidation_ShouldRejectOddPlayerCount(PositiveInt oddNumber)
    {
        // Arrange - Generate odd player count >= 3
        var oddPlayerCount = ((oddNumber.Get % 25) * 2) + 3; // Generates odd numbers: 3, 5, 7, ..., 51
        var squadId = SquadId.NewId();
        var scheduledAt = DateTime.UtcNow.AddDays(1);
        var players = CreatePlayers(oddPlayerCount);

        // Act
        Action act = () => Match.Create(squadId, scheduledAt, players);

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("*even number of players*");
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 32: Duplicate result prevention
    /// For any already-completed match, attempting to submit another result should be rejected.
    /// Validates: Requirements 6.6
    /// </summary>
    [Property(MaxTest = 100)]
    public void DuplicateResultPrevention_ShouldRejectSecondResult(PositiveInt playerCountSeed)
    {
        // Arrange - Generate even player count >= 2
        var playerCount = ((playerCountSeed.Get % 10) + 1) * 2; // Generates: 2, 4, 6, ..., 20
        var squadId = SquadId.NewId();
        var scheduledAt = DateTime.UtcNow.AddDays(1);
        var players = CreatePlayers(playerCount);
        var match = Match.Create(squadId, scheduledAt, players);

        // Record first result
        match.RecordResult(TeamDesignation.TeamA);

        // Act - Try to record second result
        Action act = () => match.RecordResult(TeamDesignation.TeamB);

        // Assert
        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*already completed*");
    }

    private static List<MatchPlayer> CreatePlayers(int count)
    {
        var players = new List<MatchPlayer>();
        for (int i = 0; i < count; i++)
        {
            // Keep ratings within valid range (400-2400)
            var rating = 1000 + (i * 50) % 1400; // Generates ratings from 1000 to 2400
            players.Add(MatchPlayer.Create(UserId.NewId(), EloRating.Create(rating)));
        }
        return players;
    }
}
