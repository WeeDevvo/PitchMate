using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Initiates a guest claim linking a guest membership to a registered user, opening the
/// consent-gated, audited, reversible lifecycle that later completes with
/// <see cref="CompleteGuestClaimHandler"/> (Requirement 15.1, 15.7). The handler resolves the acting
/// membership from the authenticated user and target squad and gates it through
/// <see cref="SquadAuthorization.RequireOwnerOrAdmin"/>, so only an active owner or admin may
/// initiate a claim; every other actor is rejected with the uniform authorisation failure that never
/// discloses squad existence (Requirement 4.2). A missing or pending-deletion squad yields the same
/// uniform failure (Requirement 17.3).
/// <para>
/// The target membership must resolve, belong to the acting member's squad, and be a
/// <b>guest</b> membership; a non-guest target is rejected as <see cref="SquadErrorCode.ClaimNotEligible"/>
/// and left unchanged (Requirement 15.7). The target user must not already hold any membership —
/// active or inactive — in the same squad; such a target is rejected as
/// <see cref="SquadErrorCode.AlreadyMember"/> and both memberships are left unchanged
/// (Requirement 15.4). On success the handler stages a single pending <see cref="GuestClaim"/> whose
/// initiating admin and initiation instant are captured as audit by the persistence pipeline, and
/// commits it atomically through <see cref="IUnitOfWork.SaveChangesAsync"/> (Requirement 15.1, 15.5).
/// </para>
/// </summary>
public sealed class InitiateGuestClaimHandler
{
    private readonly ISquadRepository _squads;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IGuestClaimRepository _claims;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>
    /// Creates the handler with the squad repository it verifies existence/soft-delete through, the
    /// membership repository it authorises and resolves targets with, the guest-claim repository it
    /// stages the audit record into, and the unit of work it commits with.
    /// </summary>
    public InitiateGuestClaimHandler(
        ISquadRepository squads,
        ISquadMembershipRepository memberships,
        IGuestClaimRepository claims,
        IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(claims);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _squads = squads;
        _memberships = memberships;
        _claims = claims;
        _unitOfWork = unitOfWork;
    }

    /// <summary>
    /// Handles an <see cref="InitiateGuestClaimCommand"/>, returning the created claim's identity on
    /// success, or a typed <see cref="SquadError"/> when authorisation or target eligibility fails.
    /// </summary>
    /// <param name="command">The claim-initiation request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<InitiateGuestClaimResult>> HandleAsync(
        InitiateGuestClaimCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, command.SquadId, cancellationToken);

        // Only an active owner or admin may initiate a claim; every other actor is rejected uniformly (Requirement 4.2).
        Result gate = SquadAuthorization.RequireOwnerOrAdmin(acting);
        if (!gate.IsSuccess)
        {
            return Result<InitiateGuestClaimResult>.Fail(gate.Error!);
        }

        // Load the squad, excluding soft-deleted ones. A missing or pending-deletion squad yields the
        // same uniform failure so its (non-)existence is never revealed (Requirement 4.2, 17.3).
        Squad? squad = await _squads.GetByIdAsync(command.SquadId, cancellationToken);
        if (squad is null)
        {
            return Result<InitiateGuestClaimResult>.Fail(SquadAuthorization.RequireOwnerOrAdmin(null).Error!);
        }

        if (command.TargetUserId == Guid.Empty)
        {
            return Fail(SquadErrorCode.ValidationFailed, "A guest claim requires a non-empty target user identifier.");
        }

        // The target must be a guest membership of the acting member's squad; a non-guest target is
        // rejected and left unchanged (Requirement 15.7).
        SquadMembership? target = await _memberships.GetByIdAsync(command.MembershipId, cancellationToken);
        if (target is null || target.SquadId != command.SquadId)
        {
            return Fail(SquadErrorCode.ClaimNotEligible, "The claim target is not a membership of this squad.");
        }

        if (!target.IsGuest)
        {
            return Fail(SquadErrorCode.ClaimNotEligible, "Only a guest membership can be claimed onto a user.");
        }

        // The target user must not already hold any membership — active or inactive — in the squad
        // (Requirement 15.4).
        SquadMembership? existing =
            await _memberships.GetByUserAndSquadAsync(command.TargetUserId, command.SquadId, cancellationToken);
        if (existing is not null)
        {
            return Fail(SquadErrorCode.AlreadyMember, "The target user already holds a membership in this squad.");
        }

        GuestClaim claim = GuestClaim.Initiate(command.MembershipId, command.TargetUserId);
        await _claims.AddAsync(claim, cancellationToken);

        // Persist the single pending claim atomically; the initiating admin and instant are captured
        // as audit by the persistence pipeline (Requirement 15.1, 15.5).
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return Result<InitiateGuestClaimResult>.Ok(new InitiateGuestClaimResult(claim.Id));
    }

    private static Result<InitiateGuestClaimResult> Fail(SquadErrorCode code, string message) =>
        Result<InitiateGuestClaimResult>.Fail(new SquadError(code, message));
}
