using FluentAssertions;
using PitchMate.Application.Queries;
using PitchMate.Domain.Entities;
using PitchMate.Domain.Repositories;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Application.Tests.Queries;

/// <summary>
/// Unit tests for GetUserSquadsQueryHandler.
/// Tests retrieval of all squads for a user with ratings and admin status.
/// Requirements: 2.5
/// </summary>
public class GetUserSquadsQueryHandlerTests
{
    [Fact]
    public async Task HandleAsync_WithValidUserId_ShouldReturnUserSquads()
    {
        // Arrange
        var userRepository = new InMemoryUserRepository();
        var squadRepository = new InMemorySquadRepository();
        var handler = new GetUserSquadsQueryHandler(squadRepository, userRepository);

        var user = User.CreateWithPassword(Email.Create("test@example.com"), "hash123");
        var squad1 = Squad.Create("Squad 1", user.Id);
        var squad2 = Squad.Create("Squad 2", user.Id);
        
        // Add user as member to both squads
        squad1.AddMember(user.Id, EloRating.Create(1000));
        squad2.AddMember(user.Id, EloRating.Create(1200));
        
        user.JoinSquad(squad1.Id, EloRating.Create(1000));
        user.JoinSquad(squad2.Id, EloRating.Create(1200));

        await userRepository.AddAsync(user);
        await squadRepository.AddAsync(squad1);
        await squadRepository.AddAsync(squad2);

        var query = new GetUserSquadsQuery(user.Id);

        // Act
        var result = await handler.HandleAsync(query);

        // Assert
        result.Success.Should().BeTrue();
        result.Squads.Should().HaveCount(2);
        
        var squad1Dto = result.Squads.First(s => s.SquadId.Equals(squad1.Id));
        squad1Dto.Name.Should().Be("Squad 1");
        squad1Dto.CurrentRating.Value.Should().Be(1000);
        squad1Dto.IsAdmin.Should().BeTrue();

        var squad2Dto = result.Squads.First(s => s.SquadId.Equals(squad2.Id));
        squad2Dto.Name.Should().Be("Squad 2");
        squad2Dto.CurrentRating.Value.Should().Be(1200);
        squad2Dto.IsAdmin.Should().BeTrue();
    }

    [Fact]
    public async Task HandleAsync_WithNonExistentUser_ShouldReturnError()
    {
        // Arrange
        var userRepository = new InMemoryUserRepository();
        var squadRepository = new InMemorySquadRepository();
        var handler = new GetUserSquadsQueryHandler(squadRepository, userRepository);

        var nonExistentUserId = UserId.NewId();
        var query = new GetUserSquadsQuery(nonExistentUserId);

        // Act
        var result = await handler.HandleAsync(query);

        // Assert
        result.Success.Should().BeFalse();
        result.ErrorCode.Should().Be("BUS_001");
        result.ErrorMessage.Should().Contain("User not found");
        result.Squads.Should().BeEmpty();
    }

    [Fact]
    public async Task HandleAsync_WithNullUserId_ShouldReturnValidationError()
    {
        // Arrange
        var userRepository = new InMemoryUserRepository();
        var squadRepository = new InMemorySquadRepository();
        var handler = new GetUserSquadsQueryHandler(squadRepository, userRepository);

        var query = new GetUserSquadsQuery(null!);

        // Act
        var result = await handler.HandleAsync(query);

        // Assert
        result.Success.Should().BeFalse();
        result.ErrorCode.Should().Be("VAL_001");
        result.ErrorMessage.Should().Contain("User ID cannot be null");
    }

    [Fact]
    public async Task HandleAsync_WithUserInNoSquads_ShouldReturnEmptyList()
    {
        // Arrange
        var userRepository = new InMemoryUserRepository();
        var squadRepository = new InMemorySquadRepository();
        var handler = new GetUserSquadsQueryHandler(squadRepository, userRepository);

        var user = User.CreateWithPassword(Email.Create("test@example.com"), "hash123");
        await userRepository.AddAsync(user);

        var query = new GetUserSquadsQuery(user.Id);

        // Act
        var result = await handler.HandleAsync(query);

        // Assert
        result.Success.Should().BeTrue();
        result.Squads.Should().BeEmpty();
    }

    [Fact]
    public async Task HandleAsync_WithUserAsNonAdmin_ShouldReturnCorrectAdminStatus()
    {
        // Arrange
        var userRepository = new InMemoryUserRepository();
        var squadRepository = new InMemorySquadRepository();
        var handler = new GetUserSquadsQueryHandler(squadRepository, userRepository);

        var admin = User.CreateWithPassword(Email.Create("admin@example.com"), "hash123");
        var member = User.CreateWithPassword(Email.Create("member@example.com"), "hash456");
        
        var squad = Squad.Create("Test Squad", admin.Id);
        squad.AddMember(admin.Id, EloRating.Default);
        squad.AddMember(member.Id, EloRating.Default);
        
        admin.JoinSquad(squad.Id, EloRating.Default);
        member.JoinSquad(squad.Id, EloRating.Default);

        await userRepository.AddAsync(admin);
        await userRepository.AddAsync(member);
        await squadRepository.AddAsync(squad);

        var query = new GetUserSquadsQuery(member.Id);

        // Act
        var result = await handler.HandleAsync(query);

        // Assert
        result.Success.Should().BeTrue();
        result.Squads.Should().HaveCount(1);
        result.Squads.First().IsAdmin.Should().BeFalse();
    }
}

/// <summary>
/// In-memory implementation of IUserRepository for testing.
/// </summary>
internal class InMemoryUserRepository : IUserRepository
{
    private readonly List<User> _users = new();

    public Task<User?> GetByIdAsync(UserId id, CancellationToken ct = default)
    {
        var user = _users.FirstOrDefault(u => u.Id.Equals(id));
        return Task.FromResult(user);
    }

    public Task<User?> GetByEmailAsync(Email email, CancellationToken ct = default)
    {
        var user = _users.FirstOrDefault(u => u.Email.Equals(email));
        return Task.FromResult(user);
    }

    public Task<User?> GetByGoogleIdAsync(string googleId, CancellationToken ct = default)
    {
        var user = _users.FirstOrDefault(u => u.GoogleId == googleId);
        return Task.FromResult(user);
    }

    public Task AddAsync(User user, CancellationToken ct = default)
    {
        _users.Add(user);
        return Task.CompletedTask;
    }

    public Task UpdateAsync(User user, CancellationToken ct = default)
    {
        var index = _users.FindIndex(u => u.Id.Equals(user.Id));
        if (index >= 0)
        {
            _users[index] = user;
        }
        return Task.CompletedTask;
    }
}

/// <summary>
/// In-memory implementation of ISquadRepository for testing.
/// </summary>
internal class InMemorySquadRepository : ISquadRepository
{
    private readonly List<Squad> _squads = new();

    public Task<Squad?> GetByIdAsync(SquadId id, CancellationToken ct = default)
    {
        var squad = _squads.FirstOrDefault(s => s.Id.Equals(id));
        return Task.FromResult(squad);
    }

    public Task<IReadOnlyList<Squad>> GetSquadsForUserAsync(UserId userId, CancellationToken ct = default)
    {
        var squads = _squads.Where(s => s.IsMember(userId)).ToList();
        return Task.FromResult<IReadOnlyList<Squad>>(squads);
    }

    public Task AddAsync(Squad squad, CancellationToken ct = default)
    {
        _squads.Add(squad);
        return Task.CompletedTask;
    }

    public Task UpdateAsync(Squad squad, CancellationToken ct = default)
    {
        var index = _squads.FindIndex(s => s.Id.Equals(squad.Id));
        if (index >= 0)
        {
            _squads[index] = squad;
        }
        return Task.CompletedTask;
    }
}
