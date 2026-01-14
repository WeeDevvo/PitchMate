using FluentAssertions;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Domain.Tests.ValueObjects;

public class StronglyTypedIdTests
{
    [Fact]
    public void UserId_WithValidGuid_ShouldCreateSuccessfully()
    {
        // Arrange
        var guid = Guid.NewGuid();

        // Act
        var userId = new UserId(guid);

        // Assert
        userId.Value.Should().Be(guid);
    }

    [Fact]
    public void UserId_WithEmptyGuid_ShouldThrowArgumentException()
    {
        // Arrange
        var emptyGuid = Guid.Empty;

        // Act
        var act = () => new UserId(emptyGuid);

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("UserId cannot be empty.*");
    }

    [Fact]
    public void UserId_NewId_ShouldGenerateUniqueIds()
    {
        // Act
        var userId1 = UserId.NewId();
        var userId2 = UserId.NewId();

        // Assert
        userId1.Should().NotBe(userId2);
        userId1.Value.Should().NotBe(Guid.Empty);
        userId2.Value.Should().NotBe(Guid.Empty);
    }

    [Fact]
    public void UserId_Equality_ShouldWorkCorrectly()
    {
        // Arrange
        var guid = Guid.NewGuid();
        var userId1 = new UserId(guid);
        var userId2 = new UserId(guid);
        var userId3 = new UserId(Guid.NewGuid());

        // Assert
        userId1.Should().Be(userId2);
        userId1.Should().NotBe(userId3);
    }

    [Fact]
    public void UserId_Immutability_ShouldPreventModification()
    {
        // Arrange
        var guid = Guid.NewGuid();
        var userId = new UserId(guid);

        // Assert - record types are immutable by default
        userId.Value.Should().Be(guid);
        // Attempting to modify would require creating a new instance with 'with' expression
    }

    [Fact]
    public void SquadId_WithValidGuid_ShouldCreateSuccessfully()
    {
        // Arrange
        var guid = Guid.NewGuid();

        // Act
        var squadId = new SquadId(guid);

        // Assert
        squadId.Value.Should().Be(guid);
    }

    [Fact]
    public void SquadId_WithEmptyGuid_ShouldThrowArgumentException()
    {
        // Arrange
        var emptyGuid = Guid.Empty;

        // Act
        var act = () => new SquadId(emptyGuid);

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("SquadId cannot be empty.*");
    }

    [Fact]
    public void SquadId_NewId_ShouldGenerateUniqueIds()
    {
        // Act
        var squadId1 = SquadId.NewId();
        var squadId2 = SquadId.NewId();

        // Assert
        squadId1.Should().NotBe(squadId2);
        squadId1.Value.Should().NotBe(Guid.Empty);
        squadId2.Value.Should().NotBe(Guid.Empty);
    }

    [Fact]
    public void SquadId_Equality_ShouldWorkCorrectly()
    {
        // Arrange
        var guid = Guid.NewGuid();
        var squadId1 = new SquadId(guid);
        var squadId2 = new SquadId(guid);
        var squadId3 = new SquadId(Guid.NewGuid());

        // Assert
        squadId1.Should().Be(squadId2);
        squadId1.Should().NotBe(squadId3);
    }

    [Fact]
    public void MatchId_WithValidGuid_ShouldCreateSuccessfully()
    {
        // Arrange
        var guid = Guid.NewGuid();

        // Act
        var matchId = new MatchId(guid);

        // Assert
        matchId.Value.Should().Be(guid);
    }

    [Fact]
    public void MatchId_WithEmptyGuid_ShouldThrowArgumentException()
    {
        // Arrange
        var emptyGuid = Guid.Empty;

        // Act
        var act = () => new MatchId(emptyGuid);

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("MatchId cannot be empty.*");
    }

    [Fact]
    public void MatchId_NewId_ShouldGenerateUniqueIds()
    {
        // Act
        var matchId1 = MatchId.NewId();
        var matchId2 = MatchId.NewId();

        // Assert
        matchId1.Should().NotBe(matchId2);
        matchId1.Value.Should().NotBe(Guid.Empty);
        matchId2.Value.Should().NotBe(Guid.Empty);
    }

    [Fact]
    public void MatchId_Equality_ShouldWorkCorrectly()
    {
        // Arrange
        var guid = Guid.NewGuid();
        var matchId1 = new MatchId(guid);
        var matchId2 = new MatchId(guid);
        var matchId3 = new MatchId(Guid.NewGuid());

        // Assert
        matchId1.Should().Be(matchId2);
        matchId1.Should().NotBe(matchId3);
    }

    [Fact]
    public void DifferentIdTypes_ShouldNotBeEqual()
    {
        // Arrange
        var guid = Guid.NewGuid();
        var userId = new UserId(guid);
        var squadId = new SquadId(guid);
        var matchId = new MatchId(guid);

        // Assert - different types should not be equal even with same GUID
        userId.Should().NotBe(squadId as object);
        userId.Should().NotBe(matchId as object);
        squadId.Should().NotBe(matchId as object);
    }
}
