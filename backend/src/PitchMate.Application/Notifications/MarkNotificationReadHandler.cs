using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Notifications;
using Result = PitchMate.Domain.Notifications.Result;

namespace PitchMate.Application.Notifications;

/// <summary>
/// Marks one of the caller's own in-app notifications as read (Requirement 9.5). The handler requires an
/// authenticated caller, then resolves the target through a user-scoped lookup
/// (<see cref="INotificationRepository.GetForUserAsync"/>) so a record that does not exist or is not
/// backed by the caller yields <see langword="null"/> and is rejected with the single uniform,
/// non-disclosing <see cref="NotificationErrorCode.NotFound"/> — existence is never disclosed
/// (Requirements 10.1, 10.4, 10.5). Because "own record" is decided by the recipient membership being
/// backed by the caller, a member inactivated by a <c>RemovedFromSquad</c> event may still mark their own
/// records — including the removal notification itself — read (Requirement 10.6).
/// <para>
/// Marking is monotonic and idempotent: <see cref="InAppNotification.MarkRead"/> moves an <c>Unread</c>
/// record to <c>Read</c> and leaves an already-<c>Read</c> record unchanged, both reported as success, so
/// repeating the request yields the same final <c>Read</c> state (Requirements 3.4, 3.5, 9.5). Only the
/// resolved target is mutated; every other record is untouched. The single flip is committed through
/// <see cref="IUnitOfWork.SaveChangesAsync"/>.
/// </para>
/// </summary>
public sealed class MarkNotificationReadHandler
{
    private readonly INotificationRepository _notifications;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>Creates the handler with the notification read/persistence surface and the unit of work it commits with.</summary>
    /// <param name="notifications">The notification persistence surface used to resolve the caller's own record.</param>
    /// <param name="unitOfWork">The unit of work that commits the read-state change.</param>
    public MarkNotificationReadHandler(INotificationRepository notifications, IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(notifications);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _notifications = notifications;
        _unitOfWork = unitOfWork;
    }

    /// <summary>
    /// Handles a <see cref="MarkNotificationReadCommand"/>, returning success once the caller's own record
    /// is <c>Read</c> (whether it was previously <c>Unread</c> or already <c>Read</c>), or a typed
    /// <see cref="NotificationError"/> when the caller is unauthenticated or the record is not the
    /// caller's.
    /// </summary>
    /// <param name="command">The mark-read request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(MarkNotificationReadCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        // A request without an authenticated caller is rejected up front, disclosing nothing (Requirement 10.2).
        Result authenticated = NotificationAuthorization.RequireAuthenticated(command.CallerUserId);
        if (!authenticated.IsSuccess)
        {
            return authenticated;
        }

        // Resolve the target only through a user-scoped lookup: a record that does not exist or is not
        // backed by the caller comes back null and is rejected with a uniform, non-disclosing not-found
        // (Requirements 9.5, 10.1).
        InAppNotification? record =
            await _notifications.GetForUserAsync(command.NotificationId, command.CallerUserId!.Value, cancellationToken);

        Result ownership = NotificationAuthorization.RequireOwnRecord(record);
        if (!ownership.IsSuccess)
        {
            return ownership;
        }

        // Idempotent, monotonic mark: Unread -> Read, or a no-op success when already Read. Only this
        // record is touched (Requirements 3.4, 3.5, 9.5).
        Result marked = record!.MarkRead();
        if (!marked.IsSuccess)
        {
            return marked;
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Ok();
    }
}
