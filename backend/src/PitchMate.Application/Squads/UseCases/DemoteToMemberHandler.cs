using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Demotes an active registered <see cref="SquadRole.Admin"/> back to <see cref="SquadRole.Member"/>
/// (Requirement 5.3). The handler resolves the acting membership from the authenticated user and the
/// target squad and gates it through <see cref="SquadAuthorization.RequireOwnerOrAdmin"/>, so only an
/// active owner or admin may demote (Requirement 4.2). It then resolves the target by identity and
/// requires it to belong to the same squad; a target that does not resolve, or that belongs to a
/// different squad, is rejected as an ineligible member (Requirement 5.7). The
/// <see cref="SquadMembership.DemoteToMember"/> domain method enforces the remaining guards — a guest
/// holds no role, the owner cannot be removed by demotion, an inactive target is ineligible, and only
/// an <c>Admin</c> can be demoted — leaving the target unchanged on any violation (Requirement 5.4,
/// 5.5, 5.6, 5.7). A successful change is committed through <see cref="IUnitOfWork.SaveChangesAsync"/>
/// and touches only the target, leaving every other membership's role unchanged (Requirement 5.8).
/// </summary>
public sealed class DemoteToMemberHandler
{
    private readonly ISquadMembershipRepository _memberships;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>Creates the handler with the membership repository it reads/stages through and the unit of work it commits with.</summary>
    public DemoteToMemberHandler(ISquadMembershipRepository memberships, IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _memberships = memberships;
        _unitOfWork = unitOfWork;
    }

    /// <summary>
    /// Handles a <see cref="DemoteToMemberCommand"/>, returning success once the target is a
    /// <c>Member</c>, or a typed <see cref="SquadError"/> when authorisation or eligibility fails.
    /// </summary>
    /// <param name="command">The demotion request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(DemoteToMemberCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, command.SquadId, cancellationToken);

        // Only an active owner or admin may demote; every other actor is rejected uniformly (Requirement 4.2).
        Result gate = SquadAuthorization.RequireOwnerOrAdmin(acting);
        if (!gate.IsSuccess)
        {
            return gate;
        }

        // A squad that is pending deletion rejects every action except export and reversal; the check
        // runs only after authorisation, so a non-member never learns the squad's state
        // (Requirement 17.3).
        if (await _memberships.IsSquadPendingDeletionAsync(command.SquadId, cancellationToken))
        {
            return PendingDeletion();
        }

        SquadMembership? target =
            await _memberships.GetByIdAsync(command.TargetMembershipId, cancellationToken);

        // The target must be a membership of the acting member's squad (Requirement 5.7).
        if (target is null || target.SquadId != command.SquadId)
        {
            return Result.Fail(new SquadError(
                SquadErrorCode.NotAMember,
                "The target is not an eligible active member of the squad."));
        }

        // Domain guards: no guest role, never the owner, active only, current role must be Admin
        // (Requirement 5.4, 5.5, 5.6, 5.7).
        Result demotion = target.DemoteToMember();
        if (!demotion.IsSuccess)
        {
            return demotion;
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Ok();
    }

    private static Result PendingDeletion() => Result.Fail(new SquadError(
        SquadErrorCode.SquadPendingDeletion,
        "The squad is pending deletion; only exporting the squad and reversing the deletion are permitted."));
}
