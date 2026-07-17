using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Removes a member from a squad by setting the target membership <see cref="MembershipState.Inactive"/>
/// while retaining its rating, stats, and match history (Requirement 8.1, 8.3). The handler resolves
/// the acting membership from the authenticated user and the target squad and gates it through
/// <see cref="SquadAuthorization.RequireOwnerOrAdmin"/>, so only an active owner or admin may remove
/// (Requirement 4.2). It then resolves the target by identity and requires it to belong to the same
/// squad; a target that does not resolve, or that belongs to a different squad, is rejected as not a
/// member of that squad and nothing changes (Requirement 8.5).
/// <para>
/// The owner cannot be removed: a target holding <see cref="SquadRole.Owner"/> is rejected and left
/// active with role owner (Requirement 8.2). A target that is already inactive is treated as
/// satisfied and reports success without a further change (Requirement 8.4). Only a genuine
/// active→inactive transition is committed through <see cref="IUnitOfWork.SaveChangesAsync"/>.
/// Deactivation retains the row so the membership is excluded from active lists and future selection
/// while its display name stays reserved until anonymisation (Requirement 8.6).
/// </para>
/// </summary>
public sealed class RemoveMemberHandler
{
    private readonly ISquadMembershipRepository _memberships;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>Creates the handler with the membership repository it reads/stages through and the unit of work it commits with.</summary>
    public RemoveMemberHandler(ISquadMembershipRepository memberships, IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _memberships = memberships;
        _unitOfWork = unitOfWork;
    }

    /// <summary>
    /// Handles a <see cref="RemoveMemberCommand"/>, returning success once the target is inactive, or
    /// a typed <see cref="SquadError"/> when authorisation fails, the target is unknown/foreign, or
    /// the target is the owner.
    /// </summary>
    /// <param name="command">The removal request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(RemoveMemberCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, command.SquadId, cancellationToken);

        // Only an active owner or admin may remove members; every other actor is rejected uniformly (Requirement 4.2).
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

        // The target must resolve to a membership of the acting member's squad (Requirement 8.5).
        if (target is null || target.SquadId != command.SquadId)
        {
            return Result.Fail(new SquadError(
                SquadErrorCode.NotAMember,
                "The target is not a member of that squad."));
        }

        // The owner cannot be removed; the membership is left active with role owner (Requirement 8.2).
        if (target.Role == SquadRole.Owner)
        {
            return Result.Fail(new SquadError(
                SquadErrorCode.OwnerConstraint,
                "The owner cannot be removed from the squad."));
        }

        // An already-inactive target is a no-op success and never reaches the commit (Requirement 8.4).
        if (target.State == MembershipState.Inactive)
        {
            return Result.Ok();
        }

        // Deactivate the active target and commit the single-row transition; retains history and keeps
        // the display name reserved (Requirement 8.1, 8.3, 8.6).
        target.Deactivate();
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Ok();
    }

    private static Result PendingDeletion() => Result.Fail(new SquadError(
        SquadErrorCode.SquadPendingDeletion,
        "The squad is pending deletion; only exporting the squad and reversing the deletion are permitted."));
}
