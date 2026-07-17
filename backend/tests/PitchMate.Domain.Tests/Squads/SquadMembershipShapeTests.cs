using System.Reflection;
using PitchMate.Domain.Rating;
using PitchMate.Domain.Squads;
using Xunit;

namespace PitchMate.Domain.Tests.Squads;

/// <summary>
/// Unit tests for the shape of a <see cref="SquadMembership"/> and guest data minimisation
/// (squads-and-membership tasks 3.8). Owner, registered, and guest memberships expose the expected
/// fields, and the type holds no contact PII member, so a guest's stored personal data is limited to
/// a display name and an optional skill tier (Requirements 2.1, 2.8, 14.9).
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class SquadMembershipShapeTests
{
    [Fact]
    public void CreateOwner_ProducesActiveRegisteredOwner()
    {
        var squadId = Guid.NewGuid();
        var userId = Guid.NewGuid();

        var result = SquadMembership.CreateOwner(squadId, userId, "  Skipper  ");

        Assert.True(result.IsSuccess);
        var owner = result.Value!;
        Assert.Equal(squadId, owner.SquadId);
        Assert.Equal(userId, owner.UserId);
        Assert.Equal(SquadRole.Owner, owner.Role);
        Assert.Equal(MembershipState.Active, owner.State);
        Assert.False(owner.IsGuest);
        Assert.Equal("Skipper", owner.DisplayName);
        Assert.Equal("skipper", owner.DisplayNameNormalized);
        Assert.Null(owner.SkillTier);
        Assert.False(owner.ClaimCompleted);
        Assert.Null(owner.LawfulBasisAcknowledgedAt);
    }

    [Fact]
    public void CreateRegistered_ProducesActiveMember()
    {
        var squadId = Guid.NewGuid();
        var userId = Guid.NewGuid();

        var member = SquadMembership.CreateRegistered(squadId, userId, "Winger").Value!;

        Assert.Equal(userId, member.UserId);
        Assert.Equal(SquadRole.Member, member.Role);
        Assert.Equal(MembershipState.Active, member.State);
        Assert.False(member.IsGuest);
        Assert.Equal("Winger", member.DisplayName);
    }

    [Fact]
    public void CreateGuest_ProducesActiveGuestWithNoBackingUserOrRole()
    {
        var squadId = Guid.NewGuid();
        var ackAt = DateTimeOffset.UtcNow;

        var guest = SquadMembership.CreateGuest(squadId, "BigDave", SkillTier.Strong, ackAt).Value!;

        Assert.Equal(squadId, guest.SquadId);
        Assert.Null(guest.UserId);
        Assert.Null(guest.Role);
        Assert.True(guest.IsGuest);
        Assert.Equal(MembershipState.Active, guest.State);
        Assert.Equal("BigDave", guest.DisplayName);
        Assert.Equal(SkillTier.Strong, guest.SkillTier);
        Assert.Equal(ackAt, guest.LawfulBasisAcknowledgedAt);
    }

    [Fact]
    public void CreateGuest_WithoutSkillTier_HasNoSeed()
    {
        var guest = SquadMembership.CreateGuest(Guid.NewGuid(), "Sub", skillTier: null, DateTimeOffset.UtcNow).Value!;

        Assert.Null(guest.SkillTier);
        Assert.True(guest.IsGuest);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Create_RejectsEmptyDisplayName(string displayName)
    {
        var registered = SquadMembership.CreateRegistered(Guid.NewGuid(), Guid.NewGuid(), displayName);
        var guest = SquadMembership.CreateGuest(Guid.NewGuid(), displayName, null, DateTimeOffset.UtcNow);

        Assert.False(registered.IsSuccess);
        Assert.Equal(SquadErrorCode.ValidationFailed, registered.Error!.Code);
        Assert.False(guest.IsSuccess);
        Assert.Equal(SquadErrorCode.ValidationFailed, guest.Error!.Code);
    }

    [Fact]
    public void Create_RejectsDisplayNameLongerThanFifty()
    {
        var tooLong = new string('a', SquadMembership.DisplayNameMaxLength + 1);

        var result = SquadMembership.CreateRegistered(Guid.NewGuid(), Guid.NewGuid(), tooLong);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.ValidationFailed, result.Error!.Code);
    }

    [Fact]
    public void CreateRegistered_RejectsEmptyUserId()
    {
        var result = SquadMembership.CreateRegistered(Guid.NewGuid(), Guid.Empty, "Player");

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.ValidationFailed, result.Error!.Code);
    }

    [Fact]
    public void SquadMembership_ExposesNoContactPiiMember()
    {
        var forbidden = new[] { "email", "phone", "mobile", "address", "telephone", "contact" };

        var offending = typeof(SquadMembership)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Select(p => p.Name)
            .Where(name => forbidden.Any(term => name.Contains(term, StringComparison.OrdinalIgnoreCase)))
            .ToArray();

        Assert.True(
            offending.Length == 0,
            $"SquadMembership must hold no contact PII (Requirement 2.8, 14.9); found: {string.Join(", ", offending)}");
    }

    [Fact]
    public void GuestMembership_PersonalDataLimitedToDisplayNameAndSkillTier()
    {
        // A guest's identifying/personal fields are exactly the display name and the optional tier.
        var guest = SquadMembership.CreateGuest(Guid.NewGuid(), "Guest", SkillTier.Average, DateTimeOffset.UtcNow).Value!;

        Assert.Null(guest.UserId);
        Assert.Equal("Guest", guest.DisplayName);
        Assert.Equal(SkillTier.Average, guest.SkillTier);
    }
}
