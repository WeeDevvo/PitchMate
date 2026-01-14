using FluentAssertions;
using PitchMate.Application.Queries;
using PitchMate.Domain.Entities;
using PitchMate.Domain.Repositories;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Application.Tests.Queries;

/// <summary>
/// Unit tests for GetSquadMatchesQueryHandler.
/// Tests retrieval of all matches for a squad.
/// Requirements: 3.6
/// </summary>
public class GetSquadMatchesQueryHandlerTests
{
    [Fact]
    public async Task HandleAsync_WithValidSquadId_ShouldReturnSquadMatches()
    {
        // Arrange
        var matchRepository = new InMemoryMatchRepository();
        var handler = new GetSquadMatchesQueryHandler(matchRepository);

        var squadId = SquadId.NewId();
        var userId1 = UserId.NewId();
        var userId2 = UserId.NewId();

        var players = new List<MatchPlayer>
        {
            MatchPlayer.Create(userId1, EloRating.Create(1000)),
            MatchPlayer.Create(userId2, EloRating.Create(1100))
        };

        var match1 = Match.Create(squadId, DateTime.UtcNow.AddDays(1), players, teamSize: 1);
        var match2 = Match.Create(squadId, DateTime.UtcNow.AddDays(2), players, teamSize: 1);

        await matchRepository.AddAsync(match1);
        await matchRepository.AddAsync(match2);

        var query = new GetSquadMatchesQuery(squadId);

        // Act
        var result = await handler.HandleAsync(query);

        // Assert
        result.Success.Should().BeTrue();
        result.Matches.Should().HaveCount(2);
        
        var match1Dto = result.Matches.First(m => m.MatchId.Equals(match1.Id));
        match1Dto.TeamSize.Should().Be(1);
        match1Dto.Status.Should().Be(MatchStatus.Pending);
        match1Dto.PlayerCount.Should().Be(2);
        match1Dto.Winner.Should().BeNull();
        match1Dto.CompletedAt.Should().BeNull();

        var match2Dto = result.Matches.First(m => m.MatchId.Equals(match2.Id));
        match2Dto.TeamSize.Should().Be(1);
        match2Dto.Status.Should().Be(MatchStatus.Pending);
    }

    [Fact]
    public async Task HandleAsync_WithCompletedMatch_ShouldIncludeResultDetails()
    {
        // Arrange
        var matchRepository = new InMemoryMatchRepository();
        var handler = new GetSquadMatchesQueryHandler(matchRepository);

        var squadId = SquadId.NewId();
        var userId1 = UserId.NewId();
        var userId2 = UserId.NewId();

        var players = new List<MatchPlayer>
        {
            MatchPlayer.Create(userId1, EloRating.Create(1000)),
            MatchPlayer.Create(userId2, EloRating.Create(1100))
        };

        var match = Match.Create(squadId, DateTime.UtcNow.AddDays(-1), players, teamSize: 1);
        
        var teamA = Team.Create(new[] { players[0] });
        var teamB = Team.Create(new[] { players[1] });
        match.AssignTeams(teamA, teamB);
        match.RecordResult(TeamDesignation.TeamA, "Great match!");

        await matchRepository.AddAsync(match);

        var query = new GetSquadMatchesQuery(squadId);

        // Act
        var result = await handler.HandleAsync(query);

        // Assert
        result.Success.Should().BeTrue();
        result.Matches.Should().HaveCount(1);
        
        var matchDto = result.Matches.First();
        matchDto.Status.Should().Be(MatchStatus.Completed);
        matchDto.Winner.Should().Be(TeamDesignation.TeamA);
        matchDto.CompletedAt.Should().NotBeNull();
        matchDto.CompletedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(2));
    }

    [Fact]
    public async Task HandleAsync_WithNullSquadId_ShouldReturnValidationError()
    {
        // Arrange
        var matchRepository = new InMemoryMatchRepository();
        var handler = new GetSquadMatchesQueryHandler(matchRepository);

        var query = new GetSquadMatchesQuery(null!);

        // Act
        var result = await handler.HandleAsync(query);

        // Assert
        result.Success.Should().BeFalse();
        result.ErrorCode.Should().Be("VAL_001");
        result.ErrorMessage.Should().Contain("Squad ID cannot be null");
    }

    [Fact]
    public async Task HandleAsync_WithSquadWithNoMatches_ShouldReturnEmptyList()
    {
        // Arrange
        var matchRepository = new InMemoryMatchRepository();
        var handler = new GetSquadMatchesQueryHandler(matchRepository);

        var squadId = SquadId.NewId();
        var query = new GetSquadMatchesQuery(squadId);

        // Act
        var result = await handler.HandleAsync(query);

        // Assert
        result.Success.Should().BeTrue();
        result.Matches.Should().BeEmpty();
    }

    [Fact]
    public async Task HandleAsync_WithMultipleSquads_ShouldReturnOnlyMatchesForSpecifiedSquad()
    {
        // Arrange
        var matchRepository = new InMemoryMatchRepository();
        var handler = new GetSquadMatchesQueryHandler(matchRepository);

        var squad1Id = SquadId.NewId();
        var squad2Id = SquadId.NewId();
        var userId1 = UserId.NewId();
        var userId2 = UserId.NewId();

        var players = new List<MatchPlayer>
        {
            MatchPlayer.Create(userId1, EloRating.Create(1000)),
            MatchPlayer.Create(userId2, EloRating.Create(1100))
        };

        var match1 = Match.Create(squad1Id, DateTime.UtcNow.AddDays(1), players, teamSize: 1);
        var match2 = Match.Create(squad2Id, DateTime.UtcNow.AddDays(2), players, teamSize: 1);
        var match3 = Match.Create(squad1Id, DateTime.UtcNow.AddDays(3), players, teamSize: 1);

        await matchRepository.AddAsync(match1);
        await matchRepository.AddAsync(match2);
        await matchRepository.AddAsync(match3);

        var query = new GetSquadMatchesQuery(squad1Id);

        // Act
        var result = await handler.HandleAsync(query);

        // Assert
        result.Success.Should().BeTrue();
        result.Matches.Should().HaveCount(2);
        result.Matches.Should().AllSatisfy(m => m.MatchId.Should().Match(id => 
            id.Equals(match1.Id) || id.Equals(match3.Id)));
    }
}

/// <summary>
/// In-memory implementation of IMatchRepository for testing.
/// </summary>
internal class InMemoryMatchRepository : IMatchRepository
{
    private readonly List<Match> _matches = new();

    public Task<Match?> GetByIdAsync(MatchId id, CancellationToken ct = default)
    {
        var match = _matches.FirstOrDefault(m => m.Id.Equals(id));
        return Task.FromResult(match);
    }

    public Task<IReadOnlyList<Match>> GetMatchesForSquadAsync(SquadId squadId, CancellationToken ct = default)
    {
        var matches = _matches.Where(m => m.SquadId.Equals(squadId)).ToList();
        return Task.FromResult<IReadOnlyList<Match>>(matches);
    }

    public Task AddAsync(Match match, CancellationToken ct = default)
    {
        _matches.Add(match);
        return Task.CompletedTask;
    }

    public Task UpdateAsync(Match match, CancellationToken ct = default)
    {
        var index = _matches.FindIndex(m => m.Id.Equals(match.Id));
        if (index >= 0)
        {
            _matches[index] = match;
        }
        return Task.CompletedTask;
    }
}
