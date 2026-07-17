using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Reverses a previously completed guest claim, rebinding a membership from its registered user back
/// to a guest and clearing the claim-completed indicator, as a single atomic operation
/// (Requirement 15.6). The handler resolves the acting membership from the authenticated user and
/// target squad and gates it through <see cref="SquadAuthorization.RequireOwnerOrAdmin"/>, so only an
/// active owner or admin may reverse a claim (Requirement 4.2); a missing or pending-deletion squad
/// yields the same uniform failure (Requirement 17.3).
/// <para>
/// The target membership must resolve and belong to the squad. Reversal is guarded by
/// <see cref="SquadMembership.ReverseClaim"/>, which rejects a membership whose claim-completed
/// indicator is not set as <see cref="SquadErrorCode.ClaimNotEligible"/> and leaves it unchanged
/// (Requirement 15.8). When a completed claim record is found it is transitioned via
/// <see cref="GuestClaim.MarkReversed"/>, stamping the reversal instant from the clock as audit
/// (Requirement 15.6). The membership rebind and the audit transition are staged together and
/// committed by one <see cref="IUnitOfWork.SaveChangesAsync"/>, so if any step fails nothing is
/// persisted; the rebind touches only <c>UserId</c>, <c>Role</c>, and the claim-completed flag,
/// leaving state, display name, rating, stats, and history unchanged (Requirement 15.6).
/// </para>
/// </summary>
public sealed class ReverseGuestClaimHandler
{
    private readonly ISquadRepository _squads;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IGuestClaimRepository _claims;
    private readonly IUnitOfWork _unitOfWork;
    private readonly TimeProvider _clock;

    /// <summary>
    /// Creates the handler with the squad repository it verifies existence/soft-delete through, the
    /// membership repository it authorises and resolves the target with, the guest-claim repository it
    /// loads the claim record from, the unit of work it commits with, and the clock it stamps the
    /// reversal instant from.
    /// </summary>
    public ReverseGuestClaimHandler(
        ISquadRepository squads,
        ISquadMembershipRepository memberships,
        IGuestClaimRepository claims,
        IUnitOfWork unitOfWork,
        TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(claims);
        ArgumentNullException.ThrowIfNull(unitOfWork);
        ArgumentNullException.ThrowIfNull(clock);

        _squads = squads;
        _memberships = memberships;
        _claims = claims;
        _unitOfWork = unitOfWork;
        _clock = clock;
    }

    /// <summary>
    /// Handles a <see cref="ReverseGuestClaimCommand"/>, returning success once the membership is
    /// rebound back to a guest, or a typed <see cref="SquadError"/> when authorisation fails or there
    /// is no completed claim to reverse.
    /// </summary>
    /// <param name="command">The claim-reversal request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(ReverseGuestClaimCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, command.SquadId, cancellationToken);

        // Only an active owner or admin may reverse a claim; every other actor is rejected uniformly (Requirement 4.2).
        Result gate = SquadAuthorization.RequireOwnerOrAdmin(acting);
        if (!gate.IsSuccess)
        {
            return gate;
        }

        // A missing or pending-deletion squad yields the same uniform failure (Requirement 4.2, 17.3).
        Squad? squad = await _squads.GetByIdAsync(command.SquadId, cancellationToken);
        if (squad is null)
        {
            return SquadAuthorization.RequireOwnerOrAdmin(null);
        }

        // The target must be a membership of this squad.
        SquadMembership? target = await _memberships.GetByIdAsync(command.MembershipId, cancellationToken);
        if (target is null || target.SquadId != command.SquadId)
        {
            return Result.Fail(new SquadError(
                SquadErrorCode.ClaimNotEligible,
                "The reversal target is not a membership of this squad."));
        }

        // Guard: reject when the membership carries no completed claim, leaving it unchanged
        // (Requirement 15.8). The claim-completed indicator on the membership is the source of truth.
        Result rebind = target.ReverseClaim();
        if (!rebind.IsSuccess)
        {
            return rebind;
        }

        // Record the reversal on the completed claim as audit; the in-flight (not-yet-reversed) claim
        // for a completed membership is its completed record (Requirement 15.6).
        GuestClaim? claim = await _claims.GetOpenForMembershipAsync(command.MembershipId, cancellationToken);
        if (claim is not null)
        {
            Result reversal = claim.MarkReversed(_clock.GetUtcNow());
            if (!reversal.IsSuccess)
            {
                return reversal;
            }
        }

        // Commit the rebind and the audit reversal atomically; a failure persists neither (Requirement 15.6).
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Ok();
    }
}
