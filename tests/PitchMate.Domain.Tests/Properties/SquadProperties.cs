using FluentAssertions;
using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Entities;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Domain.Tests.Properties;

public class SquadProperties
{
    /// <summary>
    /// Feature: pitchmate-core, Property 5: Squad creation with admin
    /// For any valid squad name and creator user, creating a squad should result in 
    /// a persisted squad with the creator as an admin.
    /// Validates: Requirements 2.1
    /// </summary>
    [Property(MaxTest = 100)]
    public void SquadCreationWithAdmin_CreatorShouldBeAdmin(NonEmptyString squadName)
    {
        // Guard: Skip whitespace-only strings (FsCheck's NonEmptyString can generate them)
        if (string.IsNullOrWhiteSpace(squadName.Get))
            return;

        // Arrange
        var creatorId = UserId.NewId();

        // Act
        var squad = Squad.Create(squadName.Get, creatorId);

        // Assert
        // 1. Squad should be created with valid ID
        squad.Should().NotBeNull();
        squad.Id.Should().NotBeNull();
        squad.Id.Value.Should().NotBe(Guid.Empty);

        // 2. Squad name should match
        squad.Name.Should().Be(squadName.Get);

        // 3. Creator should be in the admin list
        squad.AdminIds.Should().ContainSingle()
            .Which.Should().Be(creatorId);

        // 4. Creator should be identified as admin
        squad.IsAdmin(creatorId).Should().BeTrue();

        // 5. Squad should have no members initially
        squad.Members.Should().BeEmpty();

        // 6. CreatedAt should be recent
        squad.CreatedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(5));
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 7: Duplicate membership prevention
    /// For any user already in a squad, attempting to join the same squad again 
    /// should either be rejected or have no effect (idempotent).
    /// Validates: Requirements 2.4
    /// </summary>
    [Property(MaxTest = 100)]
    public void DuplicateMembershipPrevention_ShouldRejectOrBeIdempotent(
        NonEmptyString squadName,
        PositiveInt ratingValue)
    {
        // Guard: Skip whitespace-only strings (FsCheck's NonEmptyString can generate them)
        if (string.IsNullOrWhiteSpace(squadName.Get))
            return;

        // Arrange
        var creatorId = UserId.NewId();
        var memberId = UserId.NewId();
        var squad = Squad.Create(squadName.Get, creatorId);
        var rating = EloRating.Create(400 + (ratingValue.Get % 2000));
        
        // Add member first time
        squad.AddMember(memberId, rating);

        // Act & Assert
        // Attempting to add the same member again should throw
        var act = () => squad.AddMember(memberId, rating);
        act.Should().Throw<InvalidOperationException>()
            .WithMessage($"User {memberId} is already a member of this squad.");

        // Verify member count hasn't changed
        squad.Members.Should().HaveCount(1);
        
        // Verify the original membership is still intact
        var membership = squad.GetMembershipForUser(memberId);
        membership.UserId.Should().Be(memberId);
        membership.CurrentRating.Should().Be(rating);
    }
}
