using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using PitchMate.Domain.Entities;
using PitchMate.Domain.ValueObjects;
using PitchMate.Infrastructure.Data;
using PitchMate.Infrastructure.Repositories;

namespace PitchMate.Infrastructure.Tests.Repositories;

/// <summary>
/// Integration tests for SquadRepository using in-memory database.
/// Tests CRUD operations, admin management, and referential integrity.
/// </summary>
public class SquadRepositoryTests : IDisposable
{
    private readonly PitchMateDbContext _context;
    private readonly SquadRepository _repository;

    public SquadRepositoryTests()
    {
        var options = new DbContextOptionsBuilder<PitchMateDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        _context = new PitchMateDbContext(options);
        _repository = new SquadRepository(_context);
    }

    public void Dispose()
    {
        _context.Database.EnsureDeleted();
        _context.Dispose();
    }

    [Fact]
    public async Task AddAsync_ShouldPersistSquad()
    {
        // Arrange
        var creatorId = UserId.NewId();
        var squad = Squad.Create("Test Squad", creatorId);

        // Act
        await _repository.AddAsync(squad);

        // Assert
        var retrieved = await _repository.GetByIdAsync(squad.Id);
        retrieved.Should().NotBeNull();
        retrieved!.Name.Should().Be("Test Squad");
        retrieved.AdminIds.Should().Contain(creatorId);
    }

    [Fact]
    public async Task GetByIdAsync_ShouldIncludeAdmins()
    {
        // Arrange
        var creatorId = UserId.NewId();
        var squad = Squad.Create("Test Squad", creatorId);
        var secondAdminId = UserId.NewId();
        squad.AddAdmin(secondAdminId);
        await _repository.AddAsync(squad);

        // Act
        var retrieved = await _repository.GetByIdAsync(squad.Id);

        // Assert
        retrieved.Should().NotBeNull();
        retrieved!.AdminIds.Should().HaveCount(2);
        retrieved.AdminIds.Should().Contain(creatorId);
        retrieved.AdminIds.Should().Contain(secondAdminId);
    }

    [Fact]
    public async Task GetByIdAsync_ShouldIncludeMembers()
    {
        // Arrange
        var creatorId = UserId.NewId();
        var squad = Squad.Create("Test Squad", creatorId);
        await _repository.AddAsync(squad);
        
        // Create a user and add them to the squad
        var memberEmail = Email.Create("member@example.com");
        var member = User.CreateWithPassword(memberEmail, "password");
        member.JoinSquad(squad.Id, EloRating.Create(1200));
        await _context.Users.AddAsync(member);
        await _context.SaveChangesAsync();

        // Act
        var retrieved = await _repository.GetByIdAsync(squad.Id);

        // Assert
        retrieved.Should().NotBeNull();
        retrieved!.Members.Should().HaveCount(1);
        retrieved.Members.First().UserId.Should().Be(member.Id);
        retrieved.Members.First().CurrentRating.Value.Should().Be(1200);
    }

    [Fact]
    public async Task UpdateAsync_ShouldPersistAdminChanges()
    {
        // Arrange
        var creatorId = UserId.NewId();
        var squad = Squad.Create("Test Squad", creatorId);
        await _repository.AddAsync(squad);

        // Act - Add a new admin
        var newAdminId = UserId.NewId();
        squad.AddAdmin(newAdminId);
        await _repository.UpdateAsync(squad);

        // Assert
        var retrieved = await _repository.GetByIdAsync(squad.Id);
        retrieved.Should().NotBeNull();
        retrieved!.AdminIds.Should().HaveCount(2);
        retrieved.AdminIds.Should().Contain(newAdminId);
    }

    [Fact]
    public async Task UpdateAsync_ShouldPersistMemberChanges()
    {
        // Arrange
        var creatorId = UserId.NewId();
        var squad = Squad.Create("Test Squad", creatorId);
        await _repository.AddAsync(squad);

        // Act - Create a user and add them to the squad
        var memberEmail = Email.Create("member@example.com");
        var member = User.CreateWithPassword(memberEmail, "password");
        member.JoinSquad(squad.Id, EloRating.Default);
        await _context.Users.AddAsync(member);
        await _context.SaveChangesAsync();

        // Assert
        var retrieved = await _repository.GetByIdAsync(squad.Id);
        retrieved.Should().NotBeNull();
        retrieved!.Members.Should().HaveCount(1);
        retrieved.Members.First().UserId.Should().Be(member.Id);
    }

    [Fact]
    public async Task GetSquadsForUserAsync_ShouldReturnUserSquads()
    {
        // Arrange
        var squad1 = Squad.Create("Squad 1", UserId.NewId());
        var squad2 = Squad.Create("Squad 2", UserId.NewId());
        var squad3 = Squad.Create("Squad 3", UserId.NewId());
        
        await _repository.AddAsync(squad1);
        await _repository.AddAsync(squad2);
        await _repository.AddAsync(squad3);
        
        // Create a user and add them to squad1 and squad2
        var userEmail = Email.Create("user@example.com");
        var user = User.CreateWithPassword(userEmail, "password");
        user.JoinSquad(squad1.Id, EloRating.Default);
        user.JoinSquad(squad2.Id, EloRating.Default);
        await _context.Users.AddAsync(user);
        await _context.SaveChangesAsync();

        // Act
        var userSquads = await _repository.GetSquadsForUserAsync(user.Id);

        // Assert
        userSquads.Should().HaveCount(2);
        userSquads.Should().Contain(s => s.Id == squad1.Id);
        userSquads.Should().Contain(s => s.Id == squad2.Id);
        userSquads.Should().NotContain(s => s.Id == squad3.Id);
    }

    [Fact]
    public async Task GetSquadsForUserAsync_ShouldReturnEmpty_WhenUserHasNoSquads()
    {
        // Arrange
        var userId = UserId.NewId();

        // Act
        var userSquads = await _repository.GetSquadsForUserAsync(userId);

        // Assert
        userSquads.Should().BeEmpty();
    }
}
