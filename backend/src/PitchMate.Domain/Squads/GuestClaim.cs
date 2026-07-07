using PitchMate.Domain.Common;

namespace PitchMate.Domain.Squads;

/// <summary>
/// The audit record of an admin-initiated action linking a <see cref="SquadMembership"/> that is a
/// guest to a registered user, tracking the claim through its consent-gated, reversible lifecycle.
/// The rebinding of the membership itself lives on <see cref="SquadMembership"/>
/// (<see cref="SquadMembership.CompleteClaim"/> / <see cref="SquadMembership.ReverseClaim"/>); this
/// entity records who claimed whom and when (Requirement 15.1, 15.5).
/// <para>
/// State advances only forwards along <see cref="GuestClaimState.Pending"/> →
/// <see cref="GuestClaimState.Consented"/> → <see cref="GuestClaimState.Completed"/> →
/// <see cref="GuestClaimState.Reversed"/>; each transition is guarded and stamps the corresponding
/// audit instant from the clock (Requirement 15.1, 15.3, 15.5, 15.6). Completion is
/// <b>consent-gated</b>: a claim cannot be marked completed until the target user has recorded
/// consent (Requirement 15.3). Deriving from <see cref="BaseEntity"/> supplies the GUID v7 key and
/// audit fields — <see cref="BaseEntity.CreatedBy"/> records the initiating admin and
/// <see cref="BaseEntity.CreatedAt"/> the initiation instant (Requirement 15.5, 19.5).
/// </para>
/// </summary>
public sealed class GuestClaim : BaseEntity
{
    /// <summary>Parameterless constructor reserved for the persistence layer.</summary>
    private GuestClaim()
    {
    }

    private GuestClaim(Guid membershipId, Guid targetUserId)
    {
        MembershipId = membershipId;
        TargetUserId = targetUserId;
        State = GuestClaimState.Pending;
    }

    /// <summary>The identity of the guest membership this claim links to a registered user (Requirement 15.1).</summary>
    public Guid MembershipId { get; private set; }

    /// <summary>The identity of the registered user the membership is being claimed onto (Requirement 15.1, 15.5).</summary>
    public Guid TargetUserId { get; private set; }

    /// <summary>The current lifecycle state of the claim (Requirement 15.1).</summary>
    public GuestClaimState State { get; private set; }

    /// <summary>The instant the target user's consent was recorded, or <see langword="null"/> before consent (Requirement 15.3).</summary>
    public DateTimeOffset? ConsentAt { get; private set; }

    /// <summary>The instant the claim completed and the membership was rebound, or <see langword="null"/> before completion (Requirement 15.1, 15.5).</summary>
    public DateTimeOffset? CompletedAt { get; private set; }

    /// <summary>The instant the completed claim was reversed, or <see langword="null"/> if never reversed (Requirement 15.6).</summary>
    public DateTimeOffset? ReversedAt { get; private set; }

    /// <summary>
    /// Initiates a guest claim in <see cref="GuestClaimState.Pending"/>, recording the target
    /// membership and user; the claim awaits the user's consent before it can complete
    /// (Requirement 15.1, 15.7). The initiating admin and initiation instant are captured as audit
    /// data via <see cref="BaseEntity.CreatedBy"/> / <see cref="BaseEntity.CreatedAt"/> when the row
    /// is persisted (Requirement 15.5).
    /// </summary>
    /// <param name="membershipId">The guest membership being claimed.</param>
    /// <param name="targetUserId">The registered user the membership is claimed onto.</param>
    /// <returns>A new pending guest claim.</returns>
    public static GuestClaim Initiate(Guid membershipId, Guid targetUserId) =>
        new(membershipId, targetUserId);

    /// <summary>
    /// Records the target user's consent, transitioning a <see cref="GuestClaimState.Pending"/> claim
    /// to <see cref="GuestClaimState.Consented"/> and stamping <see cref="ConsentAt"/> from the clock
    /// (Requirement 15.1, 15.3). Rejected and left unchanged when the claim is not currently pending.
    /// </summary>
    /// <param name="now">The current instant from the clock.</param>
    public Result RecordConsent(DateTimeOffset now)
    {
        if (State != GuestClaimState.Pending)
        {
            return Fail(SquadErrorCode.ClaimNotEligible, "Only a pending claim can record consent.");
        }

        State = GuestClaimState.Consented;
        ConsentAt = now;
        return Result.Ok();
    }

    /// <summary>
    /// Completes the claim, transitioning a <see cref="GuestClaimState.Consented"/> claim to
    /// <see cref="GuestClaimState.Completed"/> and stamping <see cref="CompletedAt"/> from the clock
    /// (Requirement 15.1, 15.5). Completion is consent-gated: a claim that has not recorded consent
    /// is rejected and left unchanged, indicating the claim cannot complete until consent is
    /// recorded (Requirement 15.3).
    /// </summary>
    /// <param name="now">The current instant from the clock.</param>
    public Result MarkCompleted(DateTimeOffset now)
    {
        if (State != GuestClaimState.Consented)
        {
            return Fail(SquadErrorCode.ClaimNotEligible, "A claim can only complete once the target user has recorded consent.");
        }

        State = GuestClaimState.Completed;
        CompletedAt = now;
        return Result.Ok();
    }

    /// <summary>
    /// Reverses a completed claim, transitioning a <see cref="GuestClaimState.Completed"/> claim to
    /// <see cref="GuestClaimState.Reversed"/> and stamping <see cref="ReversedAt"/> from the clock
    /// (Requirement 15.6). Rejected and left unchanged when there is no completed claim to reverse
    /// (Requirement 15.8).
    /// </summary>
    /// <param name="now">The current instant from the clock.</param>
    public Result MarkReversed(DateTimeOffset now)
    {
        if (State != GuestClaimState.Completed)
        {
            return Fail(SquadErrorCode.ClaimNotEligible, "There is no completed claim to reverse.");
        }

        State = GuestClaimState.Reversed;
        ReversedAt = now;
        return Result.Ok();
    }

    private static Result Fail(SquadErrorCode code, string message) =>
        Result.Fail(new SquadError(code, message));
}
