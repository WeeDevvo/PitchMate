using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Revokes an invite so it can no longer be redeemed, without removing any member already created
/// through it (Requirement 12.1, 12.5). The handler resolves the acting membership from the
/// authenticated user and target squad and gates it through
/// <see cref="SquadAuthorization.RequireOwnerOrAdmin"/>, so only an active owner or admin may revoke
/// (Requirement 4.2). It then loads the invite and requires it to belong to the acting member's
/// squad; an invite that does not resolve, or that belongs to a different squad, is rejected with the
/// uniform authorisation failure and left unchanged, so revocation is confined to squads the actor
/// administers and existence is never disclosed (Requirement 12.7).
/// <para>
/// Revocation is idempotent against the clock: only an invite whose effective state is
/// <see cref="InviteState.Active"/> transitions to <see cref="InviteState.Revoked"/> and is committed
/// through <see cref="IUnitOfWork.SaveChangesAsync"/>; an already-revoked or (derived) expired invite
/// is left unchanged and reports success without a write (Requirement 12.1, 12.4). Revocation touches
/// only the invite — no membership created through it is modified (Requirement 12.5).
/// </para>
/// </summary>
public sealed class RevokeInviteHandler
{
    private readonly ISquadMembershipRepository _memberships;
    private readonly IInviteRepository _invites;
    private readonly IUnitOfWork _unitOfWork;
    private readonly TimeProvider _clock;

    /// <summary>
    /// Creates the handler with the membership repository it authorises through, the invite
    /// repository it loads from, the unit of work it commits through, and the clock it derives the
    /// invite's effective state from.
    /// </summary>
    public RevokeInviteHandler(
        ISquadMembershipRepository memberships,
        IInviteRepository invites,
        IUnitOfWork unitOfWork,
        TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(invites);
        ArgumentNullException.ThrowIfNull(unitOfWork);
        ArgumentNullException.ThrowIfNull(clock);

        _memberships = memberships;
        _invites = invites;
        _unitOfWork = unitOfWork;
        _clock = clock;
    }

    /// <summary>
    /// Handles a <see cref="RevokeInviteCommand"/>, returning success once the invite is revoked (or
    /// was already revoked/expired), or the uniform <see cref="SquadErrorCode.Unauthorized"/> failure
    /// when the actor is not an active owner or admin of the invite's squad.
    /// </summary>
    /// <param name="command">The revocation request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(RevokeInviteCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, command.SquadId, cancellationToken);

        // Only an active owner or admin may revoke; every other actor is rejected uniformly (Requirement 4.2, 12.7).
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
            return Result.Fail(new SquadError(
                SquadErrorCode.SquadPendingDeletion,
                "The squad is pending deletion; only exporting the squad and reversing the deletion are permitted."));
        }

        Invite? invite = await _invites.GetByIdAsync(command.InviteId, cancellationToken);

        // The invite must belong to the squad the actor administers. A missing or foreign invite is
        // rejected with the same uniform failure and left unchanged, disclosing nothing (Requirement 12.7).
        if (invite is null || invite.SquadId != command.SquadId)
        {
            return SquadAuthorization.RequireOwnerOrAdmin(null);
        }

        // Revocation is idempotent against the clock: an already-revoked or derived-expired invite is
        // a no-op success and never reaches the commit (Requirement 12.4).
        if (invite.EffectiveState(_clock.GetUtcNow()) != InviteState.Active)
        {
            return Result.Ok();
        }

        // Revoke the active invite and commit; only this invite changes — no membership created
        // through it is touched (Requirement 12.1, 12.5).
        invite.Revoke();
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Ok();
    }
}
