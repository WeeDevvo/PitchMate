using PitchMate.Domain.Squads;
using Xunit;

namespace PitchMate.Domain.Tests.Squads;

/// <summary>
/// Unit tests for the <see cref="GuestClaim"/> claim-link lifecycle. A claim is issued pending with the
/// hash of its link's secret and an expiry; it can be accepted once, by a registered user, before it
/// expires; it completes only once accepted; it reverses only once completed; and an open claim can be
/// cancelled when a newer link replaces it. Each transition stamps its audit instant, and every
/// out-of-order transition is rejected and leaves the claim unchanged.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class GuestClaimTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 23, 12, 0, 0, TimeSpan.Zero);

    private static GuestClaim Issued() =>
        GuestClaim.Initiate(Guid.NewGuid(), "hash::secret", Now + GuestClaim.LinkValidity);

    private static GuestClaim Accepted(Guid? userId = null)
    {
        GuestClaim claim = Issued();
        Assert.True(claim.Accept(userId ?? Guid.NewGuid(), Now).IsSuccess);
        return claim;
    }

    private static GuestClaim Completed()
    {
        GuestClaim claim = Accepted();
        Assert.True(claim.MarkCompleted(Now).IsSuccess);
        return claim;
    }

    [Fact]
    public void Initiate_StartsPendingWithTheHashAndExpiryAndNoTarget()
    {
        var membershipId = Guid.NewGuid();
        DateTimeOffset expiresAt = Now + GuestClaim.LinkValidity;

        var claim = GuestClaim.Initiate(membershipId, "hash::secret", expiresAt);

        Assert.Equal(membershipId, claim.MembershipId);
        Assert.Equal("hash::secret", claim.TokenHash);
        Assert.Equal(expiresAt, claim.ExpiresAt);
        Assert.Equal(GuestClaimState.Pending, claim.State);
        Assert.Null(claim.TargetUserId);
        Assert.Null(claim.ConsentAt);
        Assert.True(claim.IsOpen);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Initiate_RefusesABlankHash(string tokenHash)
    {
        Assert.ThrowsAny<ArgumentException>(() => GuestClaim.Initiate(Guid.NewGuid(), tokenHash, Now));
    }

    [Fact]
    public void LinkValidity_IsSevenDays()
    {
        Assert.Equal(TimeSpan.FromDays(7), GuestClaim.LinkValidity);
    }

    [Fact]
    public void Accept_BeforeExpiry_BindsTheUserAndMovesToConsented()
    {
        GuestClaim claim = Issued();
        var userId = Guid.NewGuid();

        var result = claim.Accept(userId, Now);

        Assert.True(result.IsSuccess);
        Assert.Equal(userId, claim.TargetUserId);
        Assert.Equal(GuestClaimState.Consented, claim.State);
        Assert.Equal(Now, claim.ConsentAt);
        Assert.True(claim.IsOpen);
        Assert.False(claim.IsRedeemableAt(Now));
    }

    [Fact]
    public void Accept_AtOrAfterExpiry_IsRejectedAndChangesNothing()
    {
        GuestClaim claim = Issued();

        var result = claim.Accept(Guid.NewGuid(), claim.ExpiresAt);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.ClaimNotEligible, result.Error!.Code);
        Assert.Equal(GuestClaimState.Pending, claim.State);
        Assert.Null(claim.TargetUserId);
    }

    [Fact]
    public void Accept_ASecondTime_IsRejectedAndKeepsTheFirstUser()
    {
        var first = Guid.NewGuid();
        GuestClaim claim = Accepted(first);

        var result = claim.Accept(Guid.NewGuid(), Now);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.ClaimNotEligible, result.Error!.Code);
        Assert.Equal(first, claim.TargetUserId);
    }

    [Fact]
    public void Accept_ByAnEmptyUser_IsRejected()
    {
        GuestClaim claim = Issued();

        var result = claim.Accept(Guid.Empty, Now);

        Assert.False(result.IsSuccess);
        Assert.Equal(GuestClaimState.Pending, claim.State);
    }

    [Fact]
    public void MarkCompleted_OnlyOnceAccepted()
    {
        GuestClaim pending = Issued();
        Assert.False(pending.MarkCompleted(Now).IsSuccess);
        Assert.Equal(GuestClaimState.Pending, pending.State);

        GuestClaim claim = Accepted();
        Assert.True(claim.MarkCompleted(Now).IsSuccess);
        Assert.Equal(GuestClaimState.Completed, claim.State);
        Assert.Equal(Now, claim.CompletedAt);
        Assert.False(claim.IsOpen);
    }

    [Fact]
    public void MarkReversed_OnlyOnceCompleted()
    {
        GuestClaim accepted = Accepted();
        Assert.False(accepted.MarkReversed(Now).IsSuccess);
        Assert.Equal(GuestClaimState.Consented, accepted.State);

        GuestClaim claim = Completed();
        Assert.True(claim.MarkReversed(Now).IsSuccess);
        Assert.Equal(GuestClaimState.Reversed, claim.State);
        Assert.Equal(Now, claim.ReversedAt);
    }

    [Fact]
    public void Cancel_AnOpenClaim_WithdrawsItSoItCanNeverBeAcceptedOrCompleted()
    {
        GuestClaim pending = Issued();
        Assert.True(pending.Cancel(Now).IsSuccess);
        Assert.Equal(GuestClaimState.Cancelled, pending.State);
        Assert.Equal(Now, pending.CancelledAt);
        Assert.False(pending.IsOpen);
        Assert.False(pending.Accept(Guid.NewGuid(), Now).IsSuccess);

        GuestClaim accepted = Accepted();
        Assert.True(accepted.Cancel(Now).IsSuccess);
        Assert.False(accepted.MarkCompleted(Now).IsSuccess);
    }

    [Fact]
    public void Cancel_AClosedClaim_IsRejected()
    {
        GuestClaim claim = Completed();

        Assert.False(claim.Cancel(Now).IsSuccess);
        Assert.Equal(GuestClaimState.Completed, claim.State);
    }
}
