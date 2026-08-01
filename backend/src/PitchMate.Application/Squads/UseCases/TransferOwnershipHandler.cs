using Microsoft.Extensions.Logging;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Notifications;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;
using NotificationType = PitchMate.Domain.Notifications.NotificationType;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Transfers squad ownership from the current owner to an active registered member as a single atomic
/// owner↔admin swap (Requirement 6.2). The handler resolves the acting membership from the
/// authenticated user and the target squad and gates it through
/// <see cref="SquadAuthorization.RequireOwner"/>, so only the active owner may transfer
/// (Requirement 6.5). It then resolves the target by identity and requires it to be an active
/// registered membership of the same squad; a target that does not resolve, is a guest, is inactive,
/// or belongs to a different squad is rejected and both memberships are left unchanged
/// (Requirement 6.3), while targeting the owner's own membership is rejected as already the owner
/// (Requirement 6.4).
/// <para>
/// The swap steps the current owner down to <see cref="SquadRole.Admin"/> first and only then
/// promotes the target to <see cref="SquadRole.Owner"/>, so that at no point in the staged change are
/// there two owners, and both role changes are committed together in a single
/// <see cref="IUnitOfWork.SaveChangesAsync"/> — if the commit fails neither change is persisted and
/// both memberships retain their prior role, keeping the single-owner invariant intact throughout
/// (Requirement 6.1, 6.2).
/// </para>
/// </summary>
public sealed class TransferOwnershipHandler
{
    private readonly ISquadMembershipRepository _memberships;
    private readonly IUnitOfWork _unitOfWork;
    private readonly ISquadRepository? _squads;
    private readonly INotificationPublisher? _publisher;
    private readonly ILogger<TransferOwnershipHandler>? _logger;

    /// <summary>
    /// Creates the handler with the membership repository it reads/stages through and the unit of work it
    /// commits with. The squad repository, notification publisher, and logger are optional collaborators
    /// used only for the best-effort <see cref="NotificationType.OwnershipTransferred"/> notification
    /// raised after a committed transfer; production wiring supplies all three, and they are left absent
    /// in tests that exercise only the transfer itself (Requirement 8.4, 8.6, 8.8).
    /// </summary>
    public TransferOwnershipHandler(
        ISquadMembershipRepository memberships,
        IUnitOfWork unitOfWork,
        ISquadRepository? squads = null,
        INotificationPublisher? publisher = null,
        ILogger<TransferOwnershipHandler>? logger = null)
    {
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _memberships = memberships;
        _unitOfWork = unitOfWork;
        _squads = squads;
        _publisher = publisher;
        _logger = logger;
    }

    /// <summary>
    /// Handles a <see cref="TransferOwnershipCommand"/>, returning success once the target holds
    /// <c>Owner</c> and the former owner holds <c>Admin</c>, or a typed <see cref="SquadError"/> when
    /// authorisation or target eligibility fails.
    /// </summary>
    /// <param name="command">The ownership-transfer request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(TransferOwnershipCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, command.SquadId, cancellationToken);

        // Only the active owner may transfer ownership; every other actor is rejected uniformly (Requirement 6.5).
        Result gate = SquadAuthorization.RequireOwner(acting);
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

        SquadMembership? target =
            await _memberships.GetByIdAsync(command.TargetMembershipId, cancellationToken);

        // The target must be an active registered membership of the same squad (Requirement 6.3).
        if (target is null
            || target.SquadId != command.SquadId
            || target.IsGuest
            || target.State != MembershipState.Active)
        {
            return Result.Fail(new SquadError(
                SquadErrorCode.NotAMember,
                "The ownership-transfer target must be an active registered member of the squad."));
        }

        // Transferring to the owner's own membership is a no-op error (Requirement 6.4).
        if (target.Id == acting!.Id)
        {
            return Result.Fail(new SquadError(
                SquadErrorCode.OwnerConstraint,
                "The target is already the owner of this squad."));
        }

        // Step the current owner down first so the staged change never holds two owners, then promote
        // the target; both guards are already satisfied by the checks above (Requirement 6.1, 6.2).
        Result stepDown = acting.StepDownToAdmin();
        if (!stepDown.IsSuccess)
        {
            return stepDown;
        }

        Result assign = target.AssignOwner();
        if (!assign.IsSuccess)
        {
            return assign;
        }

        // Commit both role changes atomically; a failure rolls back both (Requirement 6.2).
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // Only after the transfer has committed do we raise the directed OwnershipTransferred notification
        // to the new and former owners. The publish runs on its own unit of work, so any failure is logged
        // (no PII) and swallowed and can never roll back or surface through the committed transfer
        // (Requirement 8.4, 8.6, 8.8).
        await PublishOwnershipTransferredAsync(command.SquadId, formerOwner: acting!, newOwner: target, cancellationToken);
        return Result.Ok();
    }

    /// <summary>
    /// Raises the best-effort <see cref="NotificationType.OwnershipTransferred"/> notification directed to
    /// both the new owner and the former owner memberships. Every failure — an unresolved squad, a failed
    /// publish result, or a thrown exception — is logged with identifiers only (never a display name,
    /// email, or notification content) and swallowed so the committed transfer is unaffected
    /// (Requirement 8.4, 8.6, 8.8).
    /// </summary>
    private async Task PublishOwnershipTransferredAsync(
        Guid squadId,
        SquadMembership formerOwner,
        SquadMembership newOwner,
        CancellationToken cancellationToken)
    {
        if (_publisher is null || _squads is null)
        {
            return;
        }

        try
        {
            Squad? squad = await _squads.GetByIdAsync(squadId, cancellationToken);
            if (squad is null)
            {
                _logger?.LogWarning(
                    "OwnershipTransferred notification skipped: owning squad could not be resolved. "
                    + "Type={NotificationType}, SquadId={SquadId}, NewOwnerMembershipId={NewOwnerMembershipId}, "
                    + "FormerOwnerMembershipId={FormerOwnerMembershipId}",
                    NotificationType.OwnershipTransferred, squadId, newOwner.Id, formerOwner.Id);
                return;
            }

            var context = new NotificationContext
            {
                SquadName = squad.Name,
                ActorDisplayName = formerOwner.DisplayName,
                AffectedMemberDisplayName = newOwner.DisplayName,
            };

            var publish = await _publisher.PublishAsync(
                NotificationType.OwnershipTransferred,
                squadId,
                [newOwner.Id, formerOwner.Id],
                context,
                cancellationToken);

            if (!publish.IsSuccess)
            {
                _logger?.LogWarning(
                    "OwnershipTransferred notification publish failed (isolated; transfer stays committed). "
                    + "Type={NotificationType}, SquadId={SquadId}, NewOwnerMembershipId={NewOwnerMembershipId}, "
                    + "FormerOwnerMembershipId={FormerOwnerMembershipId}, Reason={Reason}",
                    NotificationType.OwnershipTransferred, squadId, newOwner.Id, formerOwner.Id, publish.Error?.Code);
            }
        }
        catch (Exception ex) when (ex is not OutOfMemoryException and not StackOverflowException)
        {
            _logger?.LogWarning(
                ex,
                "OwnershipTransferred notification publish threw (isolated; transfer stays committed). "
                + "Type={NotificationType}, SquadId={SquadId}, NewOwnerMembershipId={NewOwnerMembershipId}, "
                + "FormerOwnerMembershipId={FormerOwnerMembershipId}",
                NotificationType.OwnershipTransferred, squadId, newOwner.Id, formerOwner.Id);
        }
    }
}
