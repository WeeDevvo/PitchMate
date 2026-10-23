using PitchMate.Domain.Common;

namespace PitchMate.Domain.Squads;

/// <summary>
/// The audit record of linking a guest <see cref="SquadMembership"/> to a registered user through a
/// one-time claim link. The rebinding of the membership itself lives on <see cref="SquadMembership"/>
/// (<see cref="SquadMembership.CompleteClaim"/> / <see cref="SquadMembership.ReverseClaim"/>); this
/// entity records which link was issued, who accepted it, and when each step happened.
/// <para>
/// The lifecycle is <see cref="GuestClaimState.Pending"/> (link issued) →
/// <see cref="GuestClaimState.Consented"/> (a player accepted, binding their account) →
/// <see cref="GuestClaimState.Completed"/> (an admin confirmed) → <see cref="GuestClaimState.Reversed"/>,
/// with <see cref="GuestClaimState.Cancelled"/> for a link withdrawn while still open. Each transition is
/// guarded and stamps its audit instant from the clock. Only the one-way hash of the link's secret is
/// held, and the link works once, before <see cref="ExpiresAt"/>. <see cref="BaseEntity.CreatedBy"/>
/// records the admin who issued the link and <see cref="BaseEntity.CreatedAt"/> when.
/// </para>
/// </summary>
public sealed class GuestClaim : BaseEntity
{
    /// <summary>How long a claim link stays usable after it is issued.</summary>
    public static readonly TimeSpan LinkValidity = TimeSpan.FromDays(7);

    /// <summary>Parameterless constructor reserved for the persistence layer.</summary>
    private GuestClaim()
    {
        TokenHash = string.Empty;
    }

    private GuestClaim(Guid membershipId, string tokenHash, DateTimeOffset expiresAt)
    {
        MembershipId = membershipId;
        TokenHash = tokenHash;
        ExpiresAt = expiresAt;
        State = GuestClaimState.Pending;
    }

    /// <summary>The identity of the guest membership this claim links to a registered user.</summary>
    public Guid MembershipId { get; private set; }

    /// <summary>
    /// The registered user who accepted the link, or <see langword="null"/> while nobody has. Set once, by
    /// <see cref="Accept"/>.
    /// </summary>
    public Guid? TargetUserId { get; private set; }

    /// <summary>The one-way hash of the link's secret; the secret itself is never stored.</summary>
    public string TokenHash { get; private set; }

    /// <summary>The instant after which the link can no longer be accepted.</summary>
    public DateTimeOffset ExpiresAt { get; private set; }

    /// <summary>The current lifecycle state of the claim.</summary>
    public GuestClaimState State { get; private set; }

    /// <summary>The instant a player accepted the link, or <see langword="null"/> before then.</summary>
    public DateTimeOffset? ConsentAt { get; private set; }

    /// <summary>The instant an admin completed the claim, or <see langword="null"/> before then.</summary>
    public DateTimeOffset? CompletedAt { get; private set; }

    /// <summary>The instant the completed claim was reversed, or <see langword="null"/> if never reversed.</summary>
    public DateTimeOffset? ReversedAt { get; private set; }

    /// <summary>The instant the open claim's link was withdrawn, or <see langword="null"/> if never cancelled.</summary>
    public DateTimeOffset? CancelledAt { get; private set; }

    /// <summary>Whether the claim is still in flight: issued or accepted, not yet completed or withdrawn.</summary>
    public bool IsOpen => State is GuestClaimState.Pending or GuestClaimState.Consented;

    /// <summary>
    /// Issues a claim for a guest membership, holding the hash of its link's secret and when the link
    /// expires. The claim awaits a player accepting the link.
    /// </summary>
    /// <param name="membershipId">The guest membership being claimed.</param>
    /// <param name="tokenHash">The one-way hash of the link's secret.</param>
    /// <param name="expiresAt">When the link stops working.</param>
    /// <returns>A new pending guest claim.</returns>
    public static GuestClaim Initiate(Guid membershipId, string tokenHash, DateTimeOffset expiresAt)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(tokenHash);
        return new GuestClaim(membershipId, tokenHash, expiresAt);
    }

    /// <summary>Whether the link can still be accepted at <paramref name="now"/>: pending and not expired.</summary>
    /// <param name="now">The current instant from the clock.</param>
    public bool IsRedeemableAt(DateTimeOffset now) =>
        State == GuestClaimState.Pending && now < ExpiresAt;

    /// <summary>
    /// Records a player accepting the link: binds <paramref name="userId"/> as the claim's target, stamps
    /// <see cref="ConsentAt"/>, and moves to <see cref="GuestClaimState.Consented"/>. Rejected and left
    /// unchanged unless the link is still redeemable.
    /// </summary>
    /// <param name="userId">The signed-in user accepting the link.</param>
    /// <param name="now">The current instant from the clock.</param>
    public Result Accept(Guid userId, DateTimeOffset now)
    {
        if (userId == Guid.Empty)
        {
            return Fail(SquadErrorCode.ValidationFailed, "A claim can only be accepted by a registered user.");
        }

        if (!IsRedeemableAt(now))
        {
            return Fail(SquadErrorCode.ClaimNotEligible, "The claim link is invalid or no longer usable.");
        }

        TargetUserId = userId;
        State = GuestClaimState.Consented;
        ConsentAt = now;
        return Result.Ok();
    }

    /// <summary>
    /// Completes the claim, moving an accepted claim to <see cref="GuestClaimState.Completed"/> and
    /// stamping <see cref="CompletedAt"/>. Consent-gated: a claim nobody has accepted is rejected and
    /// left unchanged.
    /// </summary>
    /// <param name="now">The current instant from the clock.</param>
    public Result MarkCompleted(DateTimeOffset now)
    {
        if (State != GuestClaimState.Consented)
        {
            return Fail(SquadErrorCode.ClaimNotEligible, "A claim can only complete once a player has accepted it.");
        }

        State = GuestClaimState.Completed;
        CompletedAt = now;
        return Result.Ok();
    }

    /// <summary>
    /// Reverses a completed claim, moving it to <see cref="GuestClaimState.Reversed"/> and stamping
    /// <see cref="ReversedAt"/>. Rejected and left unchanged when the claim is not completed.
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

    /// <summary>
    /// Withdraws an open claim's link, moving it to <see cref="GuestClaimState.Cancelled"/> and stamping
    /// <see cref="CancelledAt"/>, so a newer link can replace it. Rejected and left unchanged when the
    /// claim is not open.
    /// </summary>
    /// <param name="now">The current instant from the clock.</param>
    public Result Cancel(DateTimeOffset now)
    {
        if (!IsOpen)
        {
            return Fail(SquadErrorCode.ClaimNotEligible, "Only an open claim can be cancelled.");
        }

        State = GuestClaimState.Cancelled;
        CancelledAt = now;
        return Result.Ok();
    }

    private static Result Fail(SquadErrorCode code, string message) =>
        Result.Fail(new SquadError(code, message));
}
