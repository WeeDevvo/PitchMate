using FluentAssertions;
using PitchMate.Domain.Entities;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Domain.Tests.Entities;

public class UserTests
{
    [Fact]
    public void CreateWithPassword_WithValidParameters_ShouldCreateUser()
    {
        // Arrange
        var email = Email.Create("test@example.com");
        var passwordHash = "hashed_password_123";

        // Act
        var user = User.CreateWithPassword(email, passwordHash);

        // Assert
        user.Should().NotBeNull();
        user.Id.Should().NotBeNull();
        user.Email.Should().Be(email);
        user.PasswordHash.Should().Be(passwordHash);
        user.GoogleId.Should().BeNull();
        user.CreatedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(1));
        user.SquadMemberships.Should().BeEmpty();
    }

    [Fact]
    public void CreateWithPassword_WithNullEmail_ShouldThrowArgumentNullException()
    {
        // Arrange
        Email email = null!;
        var passwordHash = "hashed_password_123";

        // Act
        var act = () => User.CreateWithPassword(email, passwordHash);

        // Assert
        act.Should().Throw<ArgumentNullException>()
            .WithParameterName("email");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void CreateWithPassword_WithInvalidPasswordHash_ShouldThrowArgumentException(string? passwordHash)
    {
        // Arrange
        var email = Email.Create("test@example.com");

        // Act
        var act = () => User.CreateWithPassword(email, passwordHash!);

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("Password hash cannot be empty.*");
    }

    [Fact]
    public void CreateWithGoogle_WithValidParameters_ShouldCreateUser()
    {
        // Arrange
        var email = Email.Create("test@example.com");
        var googleId = "google_123456";

        // Act
        var user = User.CreateWithGoogle(email, googleId);

        // Assert
        user.Should().NotBeNull();
        user.Id.Should().NotBeNull();
        user.Email.Should().Be(email);
        user.GoogleId.Should().Be(googleId);
        user.PasswordHash.Should().BeNull();
        user.CreatedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(1));
        user.SquadMemberships.Should().BeEmpty();
    }

    [Fact]
    public void CreateWithGoogle_WithNullEmail_ShouldThrowArgumentNullException()
    {
        // Arrange
        Email email = null!;
        var googleId = "google_123456";

        // Act
        var act = () => User.CreateWithGoogle(email, googleId);

        // Assert
        act.Should().Throw<ArgumentNullException>()
            .WithParameterName("email");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void CreateWithGoogle_WithInvalidGoogleId_ShouldThrowArgumentException(string? googleId)
    {
        // Arrange
        var email = Email.Create("test@example.com");

        // Act
        var act = () => User.CreateWithGoogle(email, googleId!);

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("Google ID cannot be empty.*");
    }

    [Fact]
    public void JoinSquad_WithValidParameters_ShouldAddMembership()
    {
        // Arrange
        var user = User.CreateWithPassword(Email.Create("test@example.com"), "hash123");
        var squadId = SquadId.NewId();
        var initialRating = EloRating.Default;

        // Act
        user.JoinSquad(squadId, initialRating);

        // Assert
        user.SquadMemberships.Should().HaveCount(1);
        var membership = user.SquadMemberships.First();
        membership.UserId.Should().Be(user.Id);
        membership.SquadId.Should().Be(squadId);
        membership.CurrentRating.Should().Be(initialRating);
        membership.JoinedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(1));
    }

    [Fact]
    public void JoinSquad_WhenAlreadyMember_ShouldThrowInvalidOperationException()
    {
        // Arrange
        var user = User.CreateWithPassword(Email.Create("test@example.com"), "hash123");
        var squadId = SquadId.NewId();
        var initialRating = EloRating.Default;
        user.JoinSquad(squadId, initialRating);

        // Act
        var act = () => user.JoinSquad(squadId, initialRating);

        // Assert
        act.Should().Throw<InvalidOperationException>()
            .WithMessage($"User is already a member of squad {squadId}.");
    }

    [Fact]
    public void JoinSquad_WithNullSquadId_ShouldThrowArgumentNullException()
    {
        // Arrange
        var user = User.CreateWithPassword(Email.Create("test@example.com"), "hash123");
        SquadId squadId = null!;
        var initialRating = EloRating.Default;

        // Act
        var act = () => user.JoinSquad(squadId, initialRating);

        // Assert
        act.Should().Throw<ArgumentNullException>()
            .WithParameterName("squadId");
    }

    [Fact]
    public void JoinSquad_WithNullRating_ShouldThrowArgumentNullException()
    {
        // Arrange
        var user = User.CreateWithPassword(Email.Create("test@example.com"), "hash123");
        var squadId = SquadId.NewId();
        EloRating initialRating = null!;

        // Act
        var act = () => user.JoinSquad(squadId, initialRating);

        // Assert
        act.Should().Throw<ArgumentNullException>()
            .WithParameterName("initialRating");
    }

    [Fact]
    public void GetMembershipForSquad_WhenMemberExists_ShouldReturnMembership()
    {
        // Arrange
        var user = User.CreateWithPassword(Email.Create("test@example.com"), "hash123");
        var squadId = SquadId.NewId();
        var initialRating = EloRating.Create(1200);
        user.JoinSquad(squadId, initialRating);

        // Act
        var membership = user.GetMembershipForSquad(squadId);

        // Assert
        membership.Should().NotBeNull();
        membership.SquadId.Should().Be(squadId);
        membership.UserId.Should().Be(user.Id);
        membership.CurrentRating.Should().Be(initialRating);
    }

    [Fact]
    public void GetMembershipForSquad_WhenNotMember_ShouldThrowInvalidOperationException()
    {
        // Arrange
        var user = User.CreateWithPassword(Email.Create("test@example.com"), "hash123");
        var squadId = SquadId.NewId();

        // Act
        var act = () => user.GetMembershipForSquad(squadId);

        // Assert
        act.Should().Throw<InvalidOperationException>()
            .WithMessage($"User is not a member of squad {squadId}.");
    }

    [Fact]
    public void GetMembershipForSquad_WithNullSquadId_ShouldThrowArgumentNullException()
    {
        // Arrange
        var user = User.CreateWithPassword(Email.Create("test@example.com"), "hash123");
        SquadId squadId = null!;

        // Act
        var act = () => user.GetMembershipForSquad(squadId);

        // Assert
        act.Should().Throw<ArgumentNullException>()
            .WithParameterName("squadId");
    }

    [Fact]
    public void UpdateRatingForSquad_WithValidParameters_ShouldUpdateRating()
    {
        // Arrange
        var user = User.CreateWithPassword(Email.Create("test@example.com"), "hash123");
        var squadId = SquadId.NewId();
        var initialRating = EloRating.Create(1000);
        user.JoinSquad(squadId, initialRating);
        var newRating = EloRating.Create(1150);

        // Act
        user.UpdateRatingForSquad(squadId, newRating);

        // Assert
        var membership = user.GetMembershipForSquad(squadId);
        membership.CurrentRating.Should().Be(newRating);
    }

    [Fact]
    public void UpdateRatingForSquad_WhenNotMember_ShouldThrowInvalidOperationException()
    {
        // Arrange
        var user = User.CreateWithPassword(Email.Create("test@example.com"), "hash123");
        var squadId = SquadId.NewId();
        var newRating = EloRating.Create(1150);

        // Act
        var act = () => user.UpdateRatingForSquad(squadId, newRating);

        // Assert
        act.Should().Throw<InvalidOperationException>()
            .WithMessage($"User is not a member of squad {squadId}.");
    }

    [Fact]
    public void JoinSquad_MultipleSquads_ShouldMaintainSeparateMemberships()
    {
        // Arrange
        var user = User.CreateWithPassword(Email.Create("test@example.com"), "hash123");
        var squad1Id = SquadId.NewId();
        var squad2Id = SquadId.NewId();
        var squad3Id = SquadId.NewId();
        var rating1 = EloRating.Create(1000);
        var rating2 = EloRating.Create(1200);
        var rating3 = EloRating.Create(1500);

        // Act
        user.JoinSquad(squad1Id, rating1);
        user.JoinSquad(squad2Id, rating2);
        user.JoinSquad(squad3Id, rating3);

        // Assert
        user.SquadMemberships.Should().HaveCount(3);
        
        var membership1 = user.GetMembershipForSquad(squad1Id);
        membership1.CurrentRating.Should().Be(rating1);
        
        var membership2 = user.GetMembershipForSquad(squad2Id);
        membership2.CurrentRating.Should().Be(rating2);
        
        var membership3 = user.GetMembershipForSquad(squad3Id);
        membership3.CurrentRating.Should().Be(rating3);
    }

    [Fact]
    public void UpdateRatingForSquad_InOneSquad_ShouldNotAffectOtherSquads()
    {
        // Arrange
        var user = User.CreateWithPassword(Email.Create("test@example.com"), "hash123");
        var squad1Id = SquadId.NewId();
        var squad2Id = SquadId.NewId();
        var initialRating = EloRating.Create(1000);
        user.JoinSquad(squad1Id, initialRating);
        user.JoinSquad(squad2Id, initialRating);
        
        var newRating = EloRating.Create(1200);

        // Act
        user.UpdateRatingForSquad(squad1Id, newRating);

        // Assert
        var membership1 = user.GetMembershipForSquad(squad1Id);
        membership1.CurrentRating.Should().Be(newRating);
        
        var membership2 = user.GetMembershipForSquad(squad2Id);
        membership2.CurrentRating.Should().Be(initialRating); // Should remain unchanged
    }
}
