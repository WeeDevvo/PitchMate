using FluentAssertions;
using PitchMate.Application.Queries;
using PitchMate.Domain.Entities;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Application.Tests.Queries;

/// <summary>
/// Unit tests for GetUserRatingInSquadQueryHandler.
/// Tests retrieval of a user's current rating in a specific squad.
/// Requirements: 5.7, 5.8
/// </summary>
public class GetUserRatingInSquadQueryHandlerTests
{
    [Fact]
    public async Task HandleAsync_WithValidUserAndSquad_ShouldReturnRating()
    {
        // Arrange
        var userRepository = new InMemoryUserRepository();
        var handler = new GetUserRatingInSquadQueryHandler(userRepository);

        var user = User.CreateWithPassword(Email.Create("test@example.com"), "hash123");
        var squadId = SquadId.NewId();
        var rating = EloRating.Create(1250);
        
        user.JoinSquad(squadId, rating);
        await userRepository.AddAsync(user);

        var query = new GetUserRatingInSquadQuery(user.Id, squadId);

        // Act
        var result = await handler.HandleAsync(query);

        // Assert
        result.Success.Should().BeTrue();
        result.Rating.Should().NotBeNull();
        result.Rating!.UserId.Should().Be(user.Id);
        result.Rating.SquadId.Should().Be(squadId);
        result.Rating.CurrentRating.Value.Should().Be(1250);
        result.Rating.JoinedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(1));
    }

    [Fact]
    public async Task HandleAsync_WithUserNotInSquad_ShouldReturnError()
    {
        // Arrange
        var userRepository = new InMemoryUserRepository();
        var handler = new GetUserRatingInSquadQueryHandler(userRepository);

        var user = User.CreateWithPassword(Email.Create("test@example.com"), "hash123");
        await userRepository.AddAsync(user);

        var squadId = SquadId.NewId();
        var query = new GetUserRatingInSquadQuery(user.Id, squadId);

        // Act
        var result = await handler.HandleAsync(query);

        // Assert
        result.Success.Should().BeFalse();
        result.ErrorCode.Should().Be("BUS_004");
        result.ErrorMessage.Should().Contain("not a member of the specified squad");
        result.Rating.Should().BeNull();
    }

    [Fact]
    public async Task HandleAsync_WithNonExistentUser_ShouldReturnError()
    {
        // Arrange
        var userRepository = new InMemoryUserRepository();
        var handler = new GetUserRatingInSquadQueryHandler(userRepository);

        var nonExistentUserId = UserId.NewId();
        var squadId = SquadId.NewId();
        var query = new GetUserRatingInSquadQuery(nonExistentUserId, squadId);

        // Act
        var result = await handler.HandleAsync(query);

        // Assert
        result.Success.Should().BeFalse();
        result.ErrorCode.Should().Be("BUS_001");
        result.ErrorMessage.Should().Contain("User not found");
        result.Rating.Should().BeNull();
    }

    [Fact]
    public async Task HandleAsync_WithNullUserId_ShouldReturnValidationError()
    {
        // Arrange
        var userRepository = new InMemoryUserRepository();
        var handler = new GetUserRatingInSquadQueryHandler(userRepository);

        var squadId = SquadId.NewId();
        var query = new GetUserRatingInSquadQuery(null!, squadId);

        // Act
        var result = await handler.HandleAsync(query);

        // Assert
        result.Success.Should().BeFalse();
        result.ErrorCode.Should().Be("VAL_001");
        result.ErrorMessage.Should().Contain("User ID cannot be null");
    }

    [Fact]
    public async Task HandleAsync_WithNullSquadId_ShouldReturnValidationError()
    {
        // Arrange
        var userRepository = new InMemoryUserRepository();
        var handler = new GetUserRatingInSquadQueryHandler(userRepository);

        var userId = UserId.NewId();
        var query = new GetUserRatingInSquadQuery(userId, null!);

        // Act
        var result = await handler.HandleAsync(query);

        // Assert
        result.Success.Should().BeFalse();
        result.ErrorCode.Should().Be("VAL_001");
        result.ErrorMessage.Should().Contain("Squad ID cannot be null");
    }

    [Fact]
    public async Task HandleAsync_WithUserInMultipleSquads_ShouldReturnCorrectRating()
    {
        // Arrange
        var userRepository = new InMemoryUserRepository();
        var handler = new GetUserRatingInSquadQueryHandler(userRepository);

        var user = User.CreateWithPassword(Email.Create("test@example.com"), "hash123");
        var squad1Id = SquadId.NewId();
        var squad2Id = SquadId.NewId();
        var squad3Id = SquadId.NewId();
        
        user.JoinSquad(squad1Id, EloRating.Create(1000));
        user.JoinSquad(squad2Id, EloRating.Create(1500));
        user.JoinSquad(squad3Id, EloRating.Create(1200));
        
        await userRepository.AddAsync(user);

        var query = new GetUserRatingInSquadQuery(user.Id, squad2Id);

        // Act
        var result = await handler.HandleAsync(query);

        // Assert
        result.Success.Should().BeTrue();
        result.Rating.Should().NotBeNull();
        result.Rating!.SquadId.Should().Be(squad2Id);
        result.Rating.CurrentRating.Value.Should().Be(1500);
    }

    [Fact]
    public async Task HandleAsync_AfterRatingUpdate_ShouldReturnUpdatedRating()
    {
        // Arrange
        var userRepository = new InMemoryUserRepository();
        var handler = new GetUserRatingInSquadQueryHandler(userRepository);

        var user = User.CreateWithPassword(Email.Create("test@example.com"), "hash123");
        var squadId = SquadId.NewId();
        
        user.JoinSquad(squadId, EloRating.Create(1000));
        user.UpdateRatingForSquad(squadId, EloRating.Create(1350));
        
        await userRepository.AddAsync(user);

        var query = new GetUserRatingInSquadQuery(user.Id, squadId);

        // Act
        var result = await handler.HandleAsync(query);

        // Assert
        result.Success.Should().BeTrue();
        result.Rating.Should().NotBeNull();
        result.Rating!.CurrentRating.Value.Should().Be(1350);
    }

    [Fact]
    public async Task HandleAsync_IndependentSquadRatings_ShouldMaintainSeparateRatings()
    {
        // Arrange
        var userRepository = new InMemoryUserRepository();
        var handler = new GetUserRatingInSquadQueryHandler(userRepository);

        var user = User.CreateWithPassword(Email.Create("test@example.com"), "hash123");
        var squad1Id = SquadId.NewId();
        var squad2Id = SquadId.NewId();
        
        user.JoinSquad(squad1Id, EloRating.Create(1000));
        user.JoinSquad(squad2Id, EloRating.Create(1000));
        
        // Update rating in squad1 only
        user.UpdateRatingForSquad(squad1Id, EloRating.Create(1400));
        
        await userRepository.AddAsync(user);

        // Act - Query squad1
        var result1 = await handler.HandleAsync(new GetUserRatingInSquadQuery(user.Id, squad1Id));
        
        // Act - Query squad2
        var result2 = await handler.HandleAsync(new GetUserRatingInSquadQuery(user.Id, squad2Id));

        // Assert - Squad1 should have updated rating
        result1.Success.Should().BeTrue();
        result1.Rating!.CurrentRating.Value.Should().Be(1400);

        // Assert - Squad2 should have original rating (independent)
        result2.Success.Should().BeTrue();
        result2.Rating!.CurrentRating.Value.Should().Be(1000);
    }
}
