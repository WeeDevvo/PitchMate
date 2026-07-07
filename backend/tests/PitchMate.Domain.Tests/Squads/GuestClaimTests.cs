using PitchMate.Domain.Squads;
using Xunit;

namespace PitchMate.Domain.Tests.Squads;

/// <summary>
/// Unit tests for the <see cref="GuestClaim"/> lifecycle (squads-and-membership task 4.4). A claim is
/// initiated pending, records consent, completes only once consented, and reverses only once
/// completed; each transition stamps its audit instant and every out-of-order transition is rejected
/// and leaves the claim unchanged (Requirements 15.1, 15.3, 15.5, 15.6, 15.8).
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class GuestClaimTests
{
    private static readonly DateTimeOffset Now = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Initiate_StartsPendingWithNoAuditInstants()
    {
        var membershipId = Guid.NewGuid();
        var targetUserId = Guid.NewGuid();

        var claim = GuestClaim.Initiate(membershipId, targetUserId);

        Assert.Equal(membershipId, claim.MembershipId);
        Assert.Equal(targetUserId, claim.TargetUserId);
        Assert.Equal(GuestClaimState.Pending, claim.State);
        Assert.Null(claim.ConsentAt);
        Assert.Null(claim.CompletedAt);
        Assert.Null(claim.ReversedAt);
    }

    [Fact]
    public void RecordConsent_FromPending_TransitionsToConsentedAndStampsInstant()
    {
        var claim = GuestClaim.Initiate(Guid.NewGuid(), Guid.NewGuid());

        var result = claim.RecordConsent(Now);

        Assert.True(result.IsSuccess);
        Assert.Equal(GuestClaimState.Consented, claim.State);
        Assert.Equal(Now, claim.ConsentAt);
    }

    [Fact]
    public void MarkCompleted_FromConsented_TransitionsToCompletedAndStampsInstant()
    {
        var claim = GuestClaim.Initiate(Guid.NewGuid(), Guid.NewGuid());
        claim.RecordConsent(Now);

        var completedAt = Now.AddMinutes(5);
        var result = claim.MarkCompleted(completedAt);

        Assert.True(result.IsSuccess);
        Assert.Equal(GuestClaimState.Completed, claim.State);
        Assert.Equal(completedAt, claim.CompletedAt);
    }

    [Fact]
    public void MarkReversed_FromCompleted_TransitionsToReversedAndStampsInstant()
    {
        var claim = GuestClaim.Initiate(Guid.NewGuid(), Guid.NewGuid());
        claim.RecordConsent(Now);
        claim.MarkCompleted(Now.AddMinutes(5));

        var reversedAt = Now.AddMinutes(10);
        var result = claim.MarkReversed(reversedAt);

        Assert.True(result.IsSuccess);
        Assert.Equal(GuestClaimState.Reversed, claim.State);
        Assert.Equal(reversedAt, claim.ReversedAt);
    }

    [Fact]
    public void HappyPath_PreservesAllAuditInstants()
    {
        var claim = GuestClaim.Initiate(Guid.NewGuid(), Guid.NewGuid());
        var consentAt = Now;
        var completedAt = Now.AddMinutes(5);
        var reversedAt = Now.AddMinutes(10);

        claim.RecordConsent(consentAt);
        claim.MarkCompleted(completedAt);
        claim.MarkReversed(reversedAt);

        Assert.Equal(consentAt, claim.ConsentAt);
        Assert.Equal(completedAt, claim.CompletedAt);
        Assert.Equal(reversedAt, claim.ReversedAt);
    }

    [Fact]
    public void RecordConsent_WhenNotPending_IsRejectedAndLeavesStateUnchanged()
    {
        var claim = GuestClaim.Initiate(Guid.NewGuid(), Guid.NewGuid());
        claim.RecordConsent(Now);

        var result = claim.RecordConsent(Now.AddMinutes(1));

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.ClaimNotEligible, result.Error!.Code);
        Assert.Equal(GuestClaimState.Consented, claim.State);
        Assert.Equal(Now, claim.ConsentAt);
    }

    [Fact]
    public void MarkCompleted_WithoutConsent_IsRejectedAsConsentGated()
    {
        var claim = GuestClaim.Initiate(Guid.NewGuid(), Guid.NewGuid());

        var result = claim.MarkCompleted(Now);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.ClaimNotEligible, result.Error!.Code);
        Assert.Equal(GuestClaimState.Pending, claim.State);
        Assert.Null(claim.CompletedAt);
    }

    [Fact]
    public void MarkReversed_WhenNoCompletedClaim_IsRejectedAndLeavesStateUnchanged()
    {
        var claim = GuestClaim.Initiate(Guid.NewGuid(), Guid.NewGuid());
        claim.RecordConsent(Now);

        var result = claim.MarkReversed(Now.AddMinutes(1));

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.ClaimNotEligible, result.Error!.Code);
        Assert.Equal(GuestClaimState.Consented, claim.State);
        Assert.Null(claim.ReversedAt);
    }

    [Fact]
    public void MarkReversed_WhenPending_IsRejected()
    {
        var claim = GuestClaim.Initiate(Guid.NewGuid(), Guid.NewGuid());

        var result = claim.MarkReversed(Now);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.ClaimNotEligible, result.Error!.Code);
        Assert.Equal(GuestClaimState.Pending, claim.State);
    }

    [Fact]
    public void MarkCompleted_WhenAlreadyReversed_IsRejected()
    {
        var claim = GuestClaim.Initiate(Guid.NewGuid(), Guid.NewGuid());
        claim.RecordConsent(Now);
        claim.MarkCompleted(Now.AddMinutes(5));
        claim.MarkReversed(Now.AddMinutes(10));

        var result = claim.MarkCompleted(Now.AddMinutes(15));

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.ClaimNotEligible, result.Error!.Code);
        Assert.Equal(GuestClaimState.Reversed, claim.State);
    }
}
