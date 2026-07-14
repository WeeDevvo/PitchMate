using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Completes a consented guest claim, rebinding a guest membership onto its target user as a
/// registered <see cref="SquadRole.Member"/> and setting the claim-completed indicator, as a single
/// atomic operation (Requirement 15.1). The handler resolves the acting membership from the
/// authenticated user and target squad and gates it through
/// <see cref="SquadAuthorization.RequireOwnerOrAdmin"/>, so only an active owner or admin may
/// complete a claim (Requirement 4.2); a missing or pending-deletion squad yields the same uniform
/// failure (Requirement 17.3).
/// <para>
/// The target membership must resolve, belong to the squad, and still be a guest; the open claim for
/// it must exist and have recorded consent, otherwise completion is rejected as
/// <see cref="SquadErrorCode.ClaimNotEligible"/> and the membership is left an unchanged guest
/// (Requirement 15.3, 15.7). If the target user has come to hold another membership in the squad
/// since initiation, completion is rejected as <see cref="SquadErrorCode.AlreadyMember"/> and both
/// memberships are left unchanged (Requirement 15.4). On success the domain
/// <see cref="GuestClaim.MarkCompleted"/> transition (the consent gate) and
/// <see cref="SquadMembership.CompleteClaim"/> rebind are staged together and committed by one
/// <see cref="IUnitOfWork.SaveChangesAsync"/>, so if any step fails the membership remains a guest;
/// the rebind touches only <c>UserId</c>, <c>Role</c>, and the claim-completed flag, leaving state,
/// display name, rating, stats, and history unchanged (Requirement 15.1, 15.2, 15.5).
/// </para>
/// </summary>
public sealed class CompleteGuestClaimHandler
{
    private readonly ISquadRepository _squads;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IGuestClaimRepository _claims;
    private readonly IUnitOfWork _unitOfWork;
    private readonly TimeProvider _clock;

    /// <summary>
    /// Creates the handler with the squad repository it verifies existence/soft-delete through, the
    /// membership repository it authorises and resolves the target with, the guest-claim repository it
    /// loads the open claim from, the unit of work it commits with, and the clock it stamps the
    /// completion instant from.
    /// </summary>
    public CompleteGuestClaimHandler(
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
    /// Handles a <see cref="CompleteGuestClaimCommand"/>, returning success once the membership is
    /// rebound onto its user, or a typed <see cref="SquadError"/> when authorisation, the consent
    /// gate, or target eligibility fails.
    /// </summary>
    /// <param name="command">The claim-completion request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(CompleteGuestClaimCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, command.SquadId, cancellationToken);

        // Only an active owner or admin may complete a claim; every other actor is rejected uniformly (Requirement 4.2).
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

        // The target must be a guest membership of this squad (Requirement 15.7).
        SquadMembership? target = await _memberships.GetByIdAsync(command.MembershipId, cancellationToken);
        if (target is null || target.SquadId != command.SquadId)
        {
            return Fail(SquadErrorCode.ClaimNotEligible, "The claim target is not a membership of this squad.");
        }

        if (!target.IsGuest)
        {
            return Fail(SquadErrorCode.ClaimNotEligible, "Only a guest membership can be completed onto a user.");
        }

        // Resolve the in-flight claim; without one there is nothing to complete (Requirement 15.3).
        GuestClaim? claim = await _claims.GetOpenForMembershipAsync(command.MembershipId, cancellationToken);
        if (claim is null)
        {
            return Fail(SquadErrorCode.ClaimNotEligible, "There is no open guest claim to complete for this membership.");
        }

        // The target user must not have come to hold another membership in the squad since initiation
        // (Requirement 15.4).
        SquadMembership? existing =
            await _memberships.GetByUserAndSquadAsync(claim.TargetUserId, command.SquadId, cancellationToken);
        if (existing is not null)
        {
            return Fail(SquadErrorCode.AlreadyMember, "The target user already holds a membership in this squad.");
        }

        // Consent gate: MarkCompleted rejects a claim that has not recorded consent, leaving the
        // membership an unchanged guest (Requirement 15.3).
        Result completed = claim.MarkCompleted(_clock.GetUtcNow());
        if (!completed.IsSuccess)
        {
            return completed;
        }

        // Rebind the membership guest → registered Member, preserving state, name, and history
        // (Requirement 15.1, 15.2). Both changes commit atomically; a failure persists neither
        // (Requirement 15.1).
        target.CompleteClaim(claim.TargetUserId);

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Ok();
    }

    private static Result Fail(SquadErrorCode code, string message) =>
        Result.Fail(new SquadError(code, message));
}
