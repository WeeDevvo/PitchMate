using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Notifications;
using Result = PitchMate.Domain.Notifications.Result;

namespace PitchMate.Application.Notifications;

/// <summary>
/// Permanently removes every <see cref="InAppNotification"/> whose recipient membership is backed by an
/// erased user, across every squad and regardless of read state, because an in-app notification carries
/// no match-history integrity requirement and is therefore removed rather than anonymised
/// (Requirement 11.1). It is invoked from the auth-and-identity erasure path (task 11.1), mirroring the
/// way the squad <c>OnUserErasedHandler</c> is wired, and never touches any match record or rating-replay
/// input (Requirement 11.6).
/// <para>
/// The handler stages the removals through <see cref="INotificationRepository.RemoveForUserAsync"/> —
/// which bypasses soft-delete so the rows are genuinely deleted — and commits them atomically in one
/// <see cref="IUnitOfWork.SaveChangesAsync"/>. The removal is all-or-nothing: a failure or a signalled
/// <see cref="CancellationToken"/> before the commit leaves every record in scope unchanged and yields
/// <see cref="NotificationErrorCode.RemovalFailed"/> (Requirement 11.7). A scope that contains no matching
/// record is an idempotent success with nothing to commit (Requirement 11.8).
/// </para>
/// </summary>
public sealed class RemoveNotificationsForUserHandler
{
    private readonly INotificationRepository _notifications;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>Creates the handler with the notification persistence surface it removes through and the unit of work it commits with.</summary>
    /// <param name="notifications">The notification persistence surface used to stage the erased user's removals.</param>
    /// <param name="unitOfWork">The unit of work that commits the removals atomically.</param>
    public RemoveNotificationsForUserHandler(INotificationRepository notifications, IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(notifications);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _notifications = notifications;
        _unitOfWork = unitOfWork;
    }

    /// <summary>
    /// Permanently removes every in-app notification backed by <paramref name="userId"/>, committing the
    /// removal atomically. Returns success — including when the scope was empty — or
    /// <see cref="NotificationErrorCode.RemovalFailed"/> when the removal could not complete, in which case
    /// every record in scope is left unchanged.
    /// </summary>
    /// <param name="userId">The erased user whose notifications are removed.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(Guid userId, CancellationToken cancellationToken)
    {
        try
        {
            await _notifications.RemoveForUserAsync(userId, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OutOfMemoryException and not StackOverflowException)
        {
            // A staging or commit failure, or a signalled cancellation token before commit, rolls the unit
            // of work back so every record in scope survives unchanged, and surfaces as a removal failure
            // (Requirement 11.7).
            return Result.Fail(new Domain.Notifications.NotificationError(
                Domain.Notifications.NotificationErrorCode.RemovalFailed,
                "Failed to remove the erased user's in-app notifications."));
        }

        return Result.Ok();
    }
}
