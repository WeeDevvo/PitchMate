using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using PitchMate.Domain.Entities;
using PitchMate.Domain.ValueObjects;
using PitchMate.Infrastructure.Data;
using PitchMate.Infrastructure.Repositories;

namespace PitchMate.Infrastructure.Tests.Repositories;

/// <summary>
/// Integration tests for MatchRepository using in-memory database.
/// Tests CRUD operations, team assignments, and referential integrity.
/// </summary>
public class MatchRepositoryTests : IDisposable
{
    private readonly PitchMateDbContext _context;
    private readonly MatchRepository _repository;

    public MatchRepositoryTests()
    {
        var options = new DbContextOptionsBuilder<PitchMateDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        _context = new PitchMateDbContext(options);
        _repository = new MatchRepository(_context);
    }

    public void Dispose()
    {
        _context.Database.EnsureDeleted();
        _context.Dispose();
    }

    [Fact]
    public async Task AddAsync_ShouldPersistMatch()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var players = new List<MatchPlayer>
        {
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1000)),
            MatchPlayer.Create(UserId.NewId(), EloRating.Create(1100))
        };
        var match = Match.Create(squadId, DateTime.UtcNow.AddDays(1), players);

        // Act
        await _repository.AddAsync(match);

        // Assert
        var retrieved = await _repository.GetByIdAsync(match.Id);
        retrieved.Should().NotBeNull();
        retrieved!.SquadId.Should().Be(squadId);
        retrieved.Players.Should().HaveCount(2);
    }

    [Fact]
    public async Task GetByIdAsync_ShouldIncludePlayers()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var player1Id = UserId.NewId();
        var player2Id = UserId.NewId();
        var players = new List<MatchPlayer>
        {
            MatchPlayer.Create(player1Id, EloRating.Create(1000)),
            MatchPlayer.Create(player2Id, EloRating.Create(1100))
        };
        var match = Match.Create(squadId, DateTime.UtcNow.AddDays(1), players);
        await _repository.AddAsync(match);

        // Act
        var retrieved = await _repository.GetByIdAsync(match.Id);

        // Assert
        retrieved.Should().NotBeNull();
        retrieved!.Players.Should().HaveCount(2);
        retrieved.Players.Should().Contain(p => p.UserId == player1Id);
        retrieved.Players.Should().Contain(p => p.UserId == player2Id);
    }

    [Fact]
    public async Task UpdateAsync_ShouldPersistTeamAssignments()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var player1 = MatchPlayer.Create(UserId.NewId(), EloRating.Create(1000));
        var player2 = MatchPlayer.Create(UserId.NewId(), EloRating.Create(1100));
        var players = new List<MatchPlayer> { player1, player2 };
        var match = Match.Create(squadId, DateTime.UtcNow.AddDays(1), players);
        await _repository.AddAsync(match);

        // Act - Assign teams
        var teamA = Team.Create(new[] { player1 });
        var teamB = Team.Create(new[] { player2 });
        match.AssignTeams(teamA, teamB);
        await _repository.UpdateAsync(match);

        // Assert
        var retrieved = await _repository.GetByIdAsync(match.Id);
        retrieved.Should().NotBeNull();
        retrieved!.TeamA.Should().NotBeNull();
        retrieved.TeamB.Should().NotBeNull();
        retrieved.TeamA!.Players.Should().HaveCount(1);
        retrieved.TeamB!.Players.Should().HaveCount(1);
    }

    [Fact]
    public async Task UpdateAsync_ShouldPersistMatchResult()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var player1 = MatchPlayer.Create(UserId.NewId(), EloRating.Create(1000));
        var player2 = MatchPlayer.Create(UserId.NewId(), EloRating.Create(1100));
        var players = new List<MatchPlayer> { player1, player2 };
        var match = Match.Create(squadId, DateTime.UtcNow.AddDays(1), players);
        
        var teamA = Team.Create(new[] { player1 });
        var teamB = Team.Create(new[] { player2 });
        match.AssignTeams(teamA, teamB);
        await _repository.AddAsync(match);

        // Act - Record result
        match.RecordResult(TeamDesignation.TeamA, "Great match!");
        await _repository.UpdateAsync(match);

        // Assert
        var retrieved = await _repository.GetByIdAsync(match.Id);
        retrieved.Should().NotBeNull();
        retrieved!.Result.Should().NotBeNull();
        retrieved.Result!.Winner.Should().Be(TeamDesignation.TeamA);
        retrieved.Result.BalanceFeedback.Should().Be("Great match!");
        retrieved.Status.Should().Be(MatchStatus.Completed);
    }

    [Fact]
    public async Task GetMatchesForSquadAsync_ShouldReturnSquadMatches()
    {
        // Arrange
        var squadId1 = SquadId.NewId();
        var squadId2 = SquadId.NewId();
        
        var match1 = Match.Create(squadId1, DateTime.UtcNow.AddDays(1), new[]
        {
            MatchPlayer.Create(UserId.NewId(), EloRating.Default),
            MatchPlayer.Create(UserId.NewId(), EloRating.Default)
        });
        
        var match2 = Match.Create(squadId1, DateTime.UtcNow.AddDays(2), new[]
        {
            MatchPlayer.Create(UserId.NewId(), EloRating.Default),
            MatchPlayer.Create(UserId.NewId(), EloRating.Default)
        });
        
        var match3 = Match.Create(squadId2, DateTime.UtcNow.AddDays(3), new[]
        {
            MatchPlayer.Create(UserId.NewId(), EloRating.Default),
            MatchPlayer.Create(UserId.NewId(), EloRating.Default)
        });
        
        await _repository.AddAsync(match1);
        await _repository.AddAsync(match2);
        await _repository.AddAsync(match3);

        // Act
        var squadMatches = await _repository.GetMatchesForSquadAsync(squadId1);

        // Assert
        squadMatches.Should().HaveCount(2);
        squadMatches.Should().Contain(m => m.Id == match1.Id);
        squadMatches.Should().Contain(m => m.Id == match2.Id);
        squadMatches.Should().NotContain(m => m.Id == match3.Id);
    }

    [Fact]
    public async Task GetMatchesForSquadAsync_ShouldReturnEmpty_WhenSquadHasNoMatches()
    {
        // Arrange
        var squadId = SquadId.NewId();

        // Act
        var squadMatches = await _repository.GetMatchesForSquadAsync(squadId);

        // Assert
        squadMatches.Should().BeEmpty();
    }

    [Fact]
    public async Task GetMatchesForSquadAsync_ShouldOrderByScheduledAtDescending()
    {
        // Arrange
        var squadId = SquadId.NewId();
        var date1 = DateTime.UtcNow.AddDays(1);
        var date2 = DateTime.UtcNow.AddDays(3);
        var date3 = DateTime.UtcNow.AddDays(2);
        
        var match1 = Match.Create(squadId, date1, new[]
        {
            MatchPlayer.Create(UserId.NewId(), EloRating.Default),
            MatchPlayer.Create(UserId.NewId(), EloRating.Default)
        });
        
        var match2 = Match.Create(squadId, date2, new[]
        {
            MatchPlayer.Create(UserId.NewId(), EloRating.Default),
            MatchPlayer.Create(UserId.NewId(), EloRating.Default)
        });
        
        var match3 = Match.Create(squadId, date3, new[]
        {
            MatchPlayer.Create(UserId.NewId(), EloRating.Default),
            MatchPlayer.Create(UserId.NewId(), EloRating.Default)
        });
        
        await _repository.AddAsync(match1);
        await _repository.AddAsync(match2);
        await _repository.AddAsync(match3);

        // Act
        var squadMatches = await _repository.GetMatchesForSquadAsync(squadId);

        // Assert
        squadMatches.Should().HaveCount(3);
        squadMatches[0].ScheduledAt.Should().Be(date2); // Most recent first
        squadMatches[1].ScheduledAt.Should().Be(date3);
        squadMatches[2].ScheduledAt.Should().Be(date1);
    }
}
