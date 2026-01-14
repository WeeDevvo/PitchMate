using FluentAssertions;
using PitchMate.Domain.Entities;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Domain.Tests.Entities;

public class SquadTests
{
    [Fact]
    public void Create_WithValidParameters_ShouldCreateSquad()
    {
        // Arrange
        var name = "Test Squad";
        var creatorId = UserId.NewId();

        // Act
        var squad = Squad.Create(name, creatorId);

        // Assert
        squad.Should().NotBeNull();
        squad.Id.Should().NotBeNull();
        squad.Name.Should().Be(name);
        squad.CreatedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(1));
        squad.AdminIds.Should().ContainSingle()
            .Which.Should().Be(creatorId);
        squad.Members.Should().BeEmpty();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Create_WithInvalidName_ShouldThrowArgumentException(string? name)
    {
        // Arrange
        var creatorId = UserId.NewId();

        // Act
        var act = () => Squad.Create(name!, creatorId);

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("Squad name cannot be empty.*");
    }

    [Fact]
    public void Create_WithNullCreatorId_ShouldThrowArgumentNullException()
    {
        // Arrange
        var name = "Test Squad";
        UserId creatorId = null!;

        // Act
        var act = () => Squad.Create(name, creatorId);

        // Assert
        act.Should().Throw<ArgumentNullException>()
            .WithParameterName("creatorId");
    }

    [Fact]
    public void AddAdmin_WithValidUserId_ShouldAddAdmin()
    {
        // Arrange
        var squad = Squad.Create("Test Squad", UserId.NewId());
        var newAdminId = UserId.NewId();

        // Act
        squad.AddAdmin(newAdminId);

        // Assert
        squad.AdminIds.Should().HaveCount(2);
        squad.AdminIds.Should().Contain(newAdminId);
    }

    [Fact]
    public void AddAdmin_WhenAlreadyAdmin_ShouldThrowInvalidOperationException()
    {
        // Arrange
        var creatorId = UserId.NewId();
        var squad = Squad.Create("Test Squad", creatorId);

        // Act
        var act = () => squad.AddAdmin(creatorId);

        // Assert
        act.Should().Throw<InvalidOperationException>()
            .WithMessage($"User {creatorId} is already an admin of this squad.");
    }

    [Fact]
    public void AddAdmin_WithNullUserId_ShouldThrowArgumentNullException()
    {
        // Arrange
        var squad = Squad.Create("Test Squad", UserId.NewId());
        UserId userId = null!;

        // Act
        var act = () => squad.AddAdmin(userId);

        // Assert
        act.Should().Throw<ArgumentNullException>()
            .WithParameterName("userId");
    }

    [Fact]
    public void RemoveAdmin_WithValidUserId_ShouldRemoveAdmin()
    {
        // Arrange
        var squad = Squad.Create("Test Squad", UserId.NewId());
        var adminId = UserId.NewId();
        squad.AddAdmin(adminId);

        // Act
        squad.RemoveAdmin(adminId);

        // Assert
        squad.AdminIds.Should().HaveCount(1);
        squad.AdminIds.Should().NotContain(adminId);
    }

    [Fact]
    public void RemoveAdmin_WhenNotAdmin_ShouldThrowInvalidOperationException()
    {
        // Arrange
        var squad = Squad.Create("Test Squad", UserId.NewId());
        var nonAdminId = UserId.NewId();

        // Act
        var act = () => squad.RemoveAdmin(nonAdminId);

        // Assert
        act.Should().Throw<InvalidOperationException>()
            .WithMessage($"User {nonAdminId} is not an admin of this squad.");
    }

    [Fact]
    public void RemoveAdmin_WhenLastAdmin_ShouldThrowInvalidOperationException()
    {
        // Arrange
        var creatorId = UserId.NewId();
        var squad = Squad.Create("Test Squad", creatorId);

        // Act
        var act = () => squad.RemoveAdmin(creatorId);

        // Assert
        act.Should().Throw<InvalidOperationException>()
            .WithMessage("Cannot remove the last admin from the squad.");
    }

    [Fact]
    public void RemoveAdmin_WithNullUserId_ShouldThrowArgumentNullException()
    {
        // Arrange
        var squad = Squad.Create("Test Squad", UserId.NewId());
        UserId userId = null!;

        // Act
        var act = () => squad.RemoveAdmin(userId);

        // Assert
        act.Should().Throw<ArgumentNullException>()
            .WithParameterName("userId");
    }

    [Fact]
    public void AddMember_WithValidParameters_ShouldAddMember()
    {
        // Arrange
        var squad = Squad.Create("Test Squad", UserId.NewId());
        var userId = UserId.NewId();
        var initialRating = EloRating.Default;

        // Act
        squad.AddMember(userId, initialRating);

        // Assert
        squad.Members.Should().HaveCount(1);
        var member = squad.Members.First();
        member.UserId.Should().Be(userId);
        member.SquadId.Should().Be(squad.Id);
        member.CurrentRating.Should().Be(initialRating);
        member.JoinedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(1));
    }

    [Fact]
    public void AddMember_WhenAlreadyMember_ShouldThrowInvalidOperationException()
    {
        // Arrange
        var squad = Squad.Create("Test Squad", UserId.NewId());
        var userId = UserId.NewId();
        var initialRating = EloRating.Default;
        squad.AddMember(userId, initialRating);

        // Act
        var act = () => squad.AddMember(userId, initialRating);

        // Assert
        act.Should().Throw<InvalidOperationException>()
            .WithMessage($"User {userId} is already a member of this squad.");
    }

    [Fact]
    public void AddMember_WithNullUserId_ShouldThrowArgumentNullException()
    {
        // Arrange
        var squad = Squad.Create("Test Squad", UserId.NewId());
        UserId userId = null!;
        var initialRating = EloRating.Default;

        // Act
        var act = () => squad.AddMember(userId, initialRating);

        // Assert
        act.Should().Throw<ArgumentNullException>()
            .WithParameterName("userId");
    }

    [Fact]
    public void AddMember_WithNullRating_ShouldThrowArgumentNullException()
    {
        // Arrange
        var squad = Squad.Create("Test Squad", UserId.NewId());
        var userId = UserId.NewId();
        EloRating initialRating = null!;

        // Act
        var act = () => squad.AddMember(userId, initialRating);

        // Assert
        act.Should().Throw<ArgumentNullException>()
            .WithParameterName("initialRating");
    }

    [Fact]
    public void RemoveMember_WithValidUserId_ShouldRemoveMember()
    {
        // Arrange
        var squad = Squad.Create("Test Squad", UserId.NewId());
        var userId = UserId.NewId();
        squad.AddMember(userId, EloRating.Default);

        // Act
        squad.RemoveMember(userId);

        // Assert
        squad.Members.Should().BeEmpty();
    }

    [Fact]
    public void RemoveMember_WhenNotMember_ShouldThrowInvalidOperationException()
    {
        // Arrange
        var squad = Squad.Create("Test Squad", UserId.NewId());
        var nonMemberId = UserId.NewId();

        // Act
        var act = () => squad.RemoveMember(nonMemberId);

        // Assert
        act.Should().Throw<InvalidOperationException>()
            .WithMessage($"User {nonMemberId} is not a member of this squad.");
    }

    [Fact]
    public void RemoveMember_WithNullUserId_ShouldThrowArgumentNullException()
    {
        // Arrange
        var squad = Squad.Create("Test Squad", UserId.NewId());
        UserId userId = null!;

        // Act
        var act = () => squad.RemoveMember(userId);

        // Assert
        act.Should().Throw<ArgumentNullException>()
            .WithParameterName("userId");
    }

    [Fact]
    public void IsAdmin_WhenUserIsAdmin_ShouldReturnTrue()
    {
        // Arrange
        var creatorId = UserId.NewId();
        var squad = Squad.Create("Test Squad", creatorId);

        // Act
        var result = squad.IsAdmin(creatorId);

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public void IsAdmin_WhenUserIsNotAdmin_ShouldReturnFalse()
    {
        // Arrange
        var squad = Squad.Create("Test Squad", UserId.NewId());
        var nonAdminId = UserId.NewId();

        // Act
        var result = squad.IsAdmin(nonAdminId);

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public void IsAdmin_WithNullUserId_ShouldThrowArgumentNullException()
    {
        // Arrange
        var squad = Squad.Create("Test Squad", UserId.NewId());
        UserId userId = null!;

        // Act
        var act = () => squad.IsAdmin(userId);

        // Assert
        act.Should().Throw<ArgumentNullException>()
            .WithParameterName("userId");
    }

    [Fact]
    public void IsMember_WhenUserIsMember_ShouldReturnTrue()
    {
        // Arrange
        var squad = Squad.Create("Test Squad", UserId.NewId());
        var userId = UserId.NewId();
        squad.AddMember(userId, EloRating.Default);

        // Act
        var result = squad.IsMember(userId);

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public void IsMember_WhenUserIsNotMember_ShouldReturnFalse()
    {
        // Arrange
        var squad = Squad.Create("Test Squad", UserId.NewId());
        var nonMemberId = UserId.NewId();

        // Act
        var result = squad.IsMember(nonMemberId);

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public void IsMember_WithNullUserId_ShouldThrowArgumentNullException()
    {
        // Arrange
        var squad = Squad.Create("Test Squad", UserId.NewId());
        UserId userId = null!;

        // Act
        var act = () => squad.IsMember(userId);

        // Assert
        act.Should().Throw<ArgumentNullException>()
            .WithParameterName("userId");
    }

    [Fact]
    public void GetMembershipForUser_WhenMemberExists_ShouldReturnMembership()
    {
        // Arrange
        var squad = Squad.Create("Test Squad", UserId.NewId());
        var userId = UserId.NewId();
        var initialRating = EloRating.Create(1200);
        squad.AddMember(userId, initialRating);

        // Act
        var membership = squad.GetMembershipForUser(userId);

        // Assert
        membership.Should().NotBeNull();
        membership.UserId.Should().Be(userId);
        membership.SquadId.Should().Be(squad.Id);
        membership.CurrentRating.Should().Be(initialRating);
    }

    [Fact]
    public void GetMembershipForUser_WhenNotMember_ShouldThrowInvalidOperationException()
    {
        // Arrange
        var squad = Squad.Create("Test Squad", UserId.NewId());
        var nonMemberId = UserId.NewId();

        // Act
        var act = () => squad.GetMembershipForUser(nonMemberId);

        // Assert
        act.Should().Throw<InvalidOperationException>()
            .WithMessage($"User {nonMemberId} is not a member of this squad.");
    }

    [Fact]
    public void UpdateMemberRating_WithValidParameters_ShouldUpdateRating()
    {
        // Arrange
        var squad = Squad.Create("Test Squad", UserId.NewId());
        var userId = UserId.NewId();
        var initialRating = EloRating.Create(1000);
        squad.AddMember(userId, initialRating);
        var newRating = EloRating.Create(1150);

        // Act
        squad.UpdateMemberRating(userId, newRating);

        // Assert
        var membership = squad.GetMembershipForUser(userId);
        membership.CurrentRating.Should().Be(newRating);
    }

    [Fact]
    public void UpdateMemberRating_WhenNotMember_ShouldThrowInvalidOperationException()
    {
        // Arrange
        var squad = Squad.Create("Test Squad", UserId.NewId());
        var nonMemberId = UserId.NewId();
        var newRating = EloRating.Create(1150);

        // Act
        var act = () => squad.UpdateMemberRating(nonMemberId, newRating);

        // Assert
        act.Should().Throw<InvalidOperationException>()
            .WithMessage($"User {nonMemberId} is not a member of this squad.");
    }

    [Fact]
    public void AddMember_MultipleMembers_ShouldMaintainSeparateMemberships()
    {
        // Arrange
        var squad = Squad.Create("Test Squad", UserId.NewId());
        var user1Id = UserId.NewId();
        var user2Id = UserId.NewId();
        var user3Id = UserId.NewId();
        var rating1 = EloRating.Create(1000);
        var rating2 = EloRating.Create(1200);
        var rating3 = EloRating.Create(1500);

        // Act
        squad.AddMember(user1Id, rating1);
        squad.AddMember(user2Id, rating2);
        squad.AddMember(user3Id, rating3);

        // Assert
        squad.Members.Should().HaveCount(3);
        
        var membership1 = squad.GetMembershipForUser(user1Id);
        membership1.CurrentRating.Should().Be(rating1);
        
        var membership2 = squad.GetMembershipForUser(user2Id);
        membership2.CurrentRating.Should().Be(rating2);
        
        var membership3 = squad.GetMembershipForUser(user3Id);
        membership3.CurrentRating.Should().Be(rating3);
    }

    [Fact]
    public void AddAdmin_MultipleAdmins_ShouldMaintainAllAdmins()
    {
        // Arrange
        var creatorId = UserId.NewId();
        var squad = Squad.Create("Test Squad", creatorId);
        var admin2Id = UserId.NewId();
        var admin3Id = UserId.NewId();

        // Act
        squad.AddAdmin(admin2Id);
        squad.AddAdmin(admin3Id);

        // Assert
        squad.AdminIds.Should().HaveCount(3);
        squad.IsAdmin(creatorId).Should().BeTrue();
        squad.IsAdmin(admin2Id).Should().BeTrue();
        squad.IsAdmin(admin3Id).Should().BeTrue();
    }

    [Fact]
    public void RemoveAdmin_WithMultipleAdmins_ShouldOnlyRemoveSpecifiedAdmin()
    {
        // Arrange
        var creatorId = UserId.NewId();
        var squad = Squad.Create("Test Squad", creatorId);
        var admin2Id = UserId.NewId();
        var admin3Id = UserId.NewId();
        squad.AddAdmin(admin2Id);
        squad.AddAdmin(admin3Id);

        // Act
        squad.RemoveAdmin(admin2Id);

        // Assert
        squad.AdminIds.Should().HaveCount(2);
        squad.IsAdmin(creatorId).Should().BeTrue();
        squad.IsAdmin(admin2Id).Should().BeFalse();
        squad.IsAdmin(admin3Id).Should().BeTrue();
    }
}
