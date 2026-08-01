using Microsoft.Extensions.Logging;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Notifications;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;
using NotificationType = PitchMate.Domain.Notifications.NotificationType;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Promotes an active registered <see cref="SquadRole.Member"/> to <see cref="SquadRole.Admin"/>
/// (Requirement 5.1). The handler resolves the acting membership from the authenticated user and the
/// target squad and gates it through <see cref="SquadAuthorization.RequireOwnerOrAdmin"/>, so only an
/// active owner or admin may promote (Requirement 4.2). It then resolves the target by identity and
/// requires it to belong to the same squad; a target that does not resolve, or that belongs to a
/// different squad, is rejected as an ineligible member without disclosing anything further
/// (Requirement 5.7). The <see cref="SquadMembership.PromoteToAdmin"/> domain method enforces the
/// remaining guards — a guest holds no role, an inactive target is ineligible, and only a
/// <c>Member</c> can be promoted — leaving the target unchanged on any violation (Requirement 5.2,
/// 5.5, 5.7). A successful change is committed through <see cref="IUnitOfWork.SaveChangesAsync"/> and
/// touches only the target, leaving every other membership's role unchanged (Requirement 5.8).
/// </summary>
public sealed class PromoteToAdminHandler
{
    private readonly ISquadMembershipRepository _memberships;
    private readonly ISquadRepository _squads;
    private readonly IUnitOfWork _unitOfWork;
    private readonly INotificationPublisher _publisher;
    private readonly ILogger<PromoteToAdminHandler> _logger;

    /// <summary>
    /// Creates the handler with the membership repository it reads/stages through, the squad repository
    /// it reads the squad name from for notification rendering, the unit of work it commits with, the
    /// notification publisher it raises a <c>PromotedToAdmin</c> notification through after a committed
    /// promotion, and the logger it records an isolated publish failure with.
    /// </summary>
    public PromoteToAdminHandler(
        ISquadMembershipRepository memberships,
        ISquadRepository squads,
        IUnitOfWork unitOfWork,
        INotificationPublisher publisher,
        ILogger<PromoteToAdminHandler> logger)
    {
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(unitOfWork);
        ArgumentNullException.ThrowIfNull(publisher);
        ArgumentNullException.ThrowIfNull(logger);

        _memberships = memberships;
        _squads = squads;
        _unitOfWork = unitOfWork;
        _publisher = publisher;
        _logger = logger;
    }

    /// <summary>
    /// Handles a <see cref="PromoteToAdminCommand"/>, returning success once the target is an
    /// <c>Admin</c>, or a typed <see cref="SquadError"/> when authorisation or eligibility fails.
    /// </summary>
    /// <param name="command">The promotion request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(PromoteToAdminCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, command.SquadId, cancellationToken);

        // Only an active owner or admin may promote; every other actor is rejected uniformly (Requirement 4.2).
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

        // Domain guards: no guest role, active only, current role must be Member (Requirement 5.2, 5.5, 5.7).
        Result promotion = target.PromoteToAdmin();
        if (!promotion.IsSuccess)
        {
            return promotion;
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // Only after the promotion has committed successfully, publish the PromotedToAdmin notification
        // directed to the promoted membership. A publish failure is isolated and never rolls back or
        // surfaces from the committed promotion (Requirement 8.2, 8.5, 8.6, 8.8).
        await PublishPromotedToAdminAsync(acting, target, cancellationToken);

        return Result.Ok();
    }

    /// <summary>
    /// Publishes the <see cref="NotificationType.PromotedToAdmin"/> notification directed to the promoted
    /// membership after the promotion has committed (Requirement 8.2). The whole attempt is best-effort
    /// and fully isolated: any failure Result or thrown exception is caught, logged without contact PII —
    /// only the <see cref="NotificationType"/>, the squad id, the actor and promoted membership ids, and a
    /// failure reason — and swallowed, so the already-committed promotion is never rolled back and the
    /// failure never surfaces to the caller (Requirement 8.5, 8.6, 8.8).
    /// </summary>
    private async Task PublishPromotedToAdminAsync(
        SquadMembership? actor, SquadMembership promoted, CancellationToken cancellationToken)
    {
        try
        {
            Squad? squad = await _squads.GetByIdAsync(promoted.SquadId, cancellationToken);
            var context = new NotificationContext
            {
                SquadName = squad?.Name ?? string.Empty,
                ActorDisplayName = actor?.DisplayName,
                AffectedMemberDisplayName = promoted.DisplayName,
            };

            PitchMate.Domain.Notifications.Result published = await _publisher.PublishAsync(
                NotificationType.PromotedToAdmin,
                promoted.SquadId,
                new[] { promoted.Id },
                context,
                cancellationToken);

            if (!published.IsSuccess)
            {
                _logger.LogWarning(
                    "Notification publish failed after committed admin promotion (isolated; promotion retained). "
                    + "Type={NotificationType}, SquadId={SquadId}, PromotedMembershipId={PromotedMembershipId}, "
                    + "ActorMembershipId={ActorMembershipId}, Reason={Reason}",
                    NotificationType.PromotedToAdmin, promoted.SquadId, promoted.Id, actor?.Id,
                    published.Error?.Code.ToString() ?? "Unknown");
            }
        }
        catch (Exception ex) when (ex is not OutOfMemoryException and not StackOverflowException)
        {
            // The promotion is already committed; isolate every publish failure so it is never rolled back
            // and never surfaces to the caller. Log identifiers and the exception type only — no contact
            // PII (Requirement 8.5, 8.6, 8.8).
            _logger.LogWarning(
                "Notification publish threw after committed admin promotion (isolated; promotion retained). "
                + "Type={NotificationType}, SquadId={SquadId}, PromotedMembershipId={PromotedMembershipId}, "
                + "ActorMembershipId={ActorMembershipId}, Reason={Reason}",
                NotificationType.PromotedToAdmin, promoted.SquadId, promoted.Id, actor?.Id, ex.GetType().Name);
        }
    }

    private static Result PendingDeletion() => Result.Fail(new SquadError(
        SquadErrorCode.SquadPendingDeletion,
        "The squad is pending deletion; only exporting the squad and reversing the deletion are permitted."));
}
