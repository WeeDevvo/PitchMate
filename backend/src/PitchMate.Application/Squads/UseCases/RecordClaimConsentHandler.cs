using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Records the target user's consent to a pending guest claim, satisfying the consent gate that
/// <see cref="CompleteGuestClaimHandler"/> requires before it may rebind the membership
/// (Requirement 15.1, 15.3). Consent is authorised by the claimed user themselves — not by an admin —
/// so the handler resolves the open claim for the membership and requires the authenticated
/// <see cref="RecordClaimConsentCommand.ConsentingUserId"/> to equal the claim's target user; any
/// other caller is rejected with the uniform authorisation failure that never discloses squad or
/// claim existence (Requirement 15.3, 16.2).
/// <para>
/// A missing or pending-deletion squad, or a membership that does not belong to the named squad,
/// yields the same uniform failure (Requirement 17.3). When no open claim exists for the membership,
/// the request is rejected as <see cref="SquadErrorCode.ClaimNotEligible"/> and nothing is changed.
/// On success the domain <see cref="GuestClaim.RecordConsent"/> transition stamps the consent instant
/// from the clock and the change is committed through <see cref="IUnitOfWork.SaveChangesAsync"/>; the
/// membership is <b>not</b> rebound and remains a guest until an admin completes the claim
/// (Requirement 15.3).
/// </para>
/// </summary>
public sealed class RecordClaimConsentHandler
{
    private readonly ISquadRepository _squads;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IGuestClaimRepository _claims;
    private readonly IUnitOfWork _unitOfWork;
    private readonly TimeProvider _clock;

    /// <summary>
    /// Creates the handler with the squad repository it verifies existence/soft-delete through, the
    /// membership repository it resolves the claimed membership with, the guest-claim repository it
    /// loads the open claim from, the unit of work it commits with, and the clock it stamps the
    /// consent instant from.
    /// </summary>
    public RecordClaimConsentHandler(
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
    /// Handles a <see cref="RecordClaimConsentCommand"/>, returning success once consent is recorded,
    /// or a typed <see cref="SquadError"/> when authorisation or claim eligibility fails.
    /// </summary>
    /// <param name="command">The consent request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(RecordClaimConsentCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        // Load the squad, excluding soft-deleted ones. A missing or pending-deletion squad yields a
        // uniform failure so its (non-)existence is never revealed (Requirement 16.2, 17.3).
        Squad? squad = await _squads.GetByIdAsync(command.SquadId, cancellationToken);
        if (squad is null)
        {
            return Unauthorized();
        }

        // The membership must resolve and belong to the named squad.
        SquadMembership? membership = await _memberships.GetByIdAsync(command.MembershipId, cancellationToken);
        if (membership is null || membership.SquadId != command.SquadId)
        {
            return Unauthorized();
        }

        // Resolve the in-flight claim; without one there is nothing to consent to (Requirement 15.3).
        GuestClaim? claim = await _claims.GetOpenForMembershipAsync(command.MembershipId, cancellationToken);
        if (claim is null)
        {
            return Result.Fail(new SquadError(
                SquadErrorCode.ClaimNotEligible,
                "There is no open guest claim awaiting consent for this membership."));
        }

        // Consent is authorised by the claimed user only; any other caller is rejected uniformly
        // without disclosing that a claim exists (Requirement 15.3, 16.2).
        if (claim.TargetUserId != command.ConsentingUserId)
        {
            return Unauthorized();
        }

        // Domain guard: only a pending claim can record consent, stamping the instant from the clock.
        Result consent = claim.RecordConsent(_clock.GetUtcNow());
        if (!consent.IsSuccess)
        {
            return consent;
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Ok();
    }

    private static Result Unauthorized() =>
        Result.Fail(new SquadError(SquadErrorCode.Unauthorized, "The requested action is not permitted."));
}
