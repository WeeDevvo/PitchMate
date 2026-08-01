using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Notifications;
using Result = PitchMate.Domain.Notifications.Result;

namespace PitchMate.Application.Notifications;

/// <summary>
/// Permanently removes every <see cref="InAppNotification"/> owned by a purged squad, regardless of read
/// state (Requirement 11.3). It is invoked from the squads-and-membership purge path (task 11.1),
/// mirroring the way the squad <c>OnUserErasedHandler</c> is wired, and never touches any match record or
/// rating-replay input (Requirement 11.6).
/// <para>
/// The handler stages the removals through <see cref="INotificationRepository.RemoveForSquadAsync"/> —
/// which bypasses soft-delete so the rows are genuinely deleted — and commits them atomically in one
/// <see cref="IUnitOfWork.SaveChangesAsync"/>. The removal is all-or-nothing: a failure or a signalled
/// <see cref="CancellationToken"/> before the commit leaves every record in scope unchanged and yields
/// <see cref="NotificationErrorCode.RemovalFailed"/> (Requirement 11.7). A scope that contains no matching
/// record is an idempotent success with nothing to commit (Requirement 11.8).
/// </para>
/// </summary>
public sealed class RemoveNotificationsForSquadHandler
{
    private readonly INotificationRepository _notifications;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>Creates the handler with the notification persistence surface it removes through and the unit of work it commits with.</summary>
    /// <param name="notifications">The notification persistence surface used to stage the purged squad's removals.</param>
    /// <param name="unitOfWork">The unit of work that commits the removals atomically.</param>
    public RemoveNotificationsForSquadHandler(INotificationRepository notifications, IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(notifications);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _notifications = notifications;
        _unitOfWork = unitOfWork;
    }

    /// <summary>
    /// Permanently removes every in-app notification owned by <paramref name="squadId"/>, committing the
    /// removal atomically. Returns success — including when the scope was empty — or
    /// <see cref="NotificationErrorCode.RemovalFailed"/> when the removal could not complete, in which case
    /// every record in scope is left unchanged.
    /// </summary>
    /// <param name="squadId">The purged squad whose notifications are removed.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(Guid squadId, CancellationToken cancellationToken)
    {
        try
        {
            await _notifications.RemoveForSquadAsync(squadId, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OutOfMemoryException and not StackOverflowException)
        {
            // A staging or commit failure, or a signalled cancellation token before commit, rolls the unit
            // of work back so every record in scope survives unchanged, and surfaces as a removal failure
            // (Requirement 11.7).
            return Result.Fail(new Domain.Notifications.NotificationError(
                Domain.Notifications.NotificationErrorCode.RemovalFailed,
                "Failed to remove the purged squad's in-app notifications."));
        }

        return Result.Ok();
    }
}
