using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Notifications;
using Result = PitchMate.Domain.Notifications.Result;

namespace PitchMate.Application.Notifications;

/// <summary>
/// Marks all of the caller's own <c>Unread</c> in-app notifications as read, optionally scoped to a
/// single squad, and reports the exact number of records changed (Requirements 9.6, 9.7). The handler
/// requires an authenticated caller; when the request is squad-scoped it also requires the caller to hold
/// a membership of any state in that squad, otherwise it returns the same uniform, non-disclosing
/// not-found so a caller never learns whether a squad they cannot access exists (Requirements 9.8, 10.1,
/// 10.3).
/// <para>
/// It flips exactly the caller's own <c>Unread</c> records in scope — resolved through
/// <see cref="INotificationRepository.ListUnreadForUserAsync"/> — via the idempotent, monotonic
/// <see cref="InAppNotification.MarkRead"/>. Records that are already <c>Read</c> are not returned by the
/// listing and so are left unchanged, and records outside the caller's ownership or the requested squad
/// scope are never touched. The returned count equals the number of records flipped, which is <c>0</c>
/// when the caller has no <c>Unread</c> records in scope. All flips commit atomically in one
/// <see cref="IUnitOfWork.SaveChangesAsync"/>.
/// </para>
/// </summary>
public sealed class MarkAllNotificationsReadHandler
{
    private readonly INotificationRepository _notifications;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>Creates the handler with the notification read/persistence surface and the unit of work it commits with.</summary>
    /// <param name="notifications">The notification persistence surface used to resolve the caller's own unread records.</param>
    /// <param name="unitOfWork">The unit of work that commits the read-state changes atomically.</param>
    public MarkAllNotificationsReadHandler(INotificationRepository notifications, IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(notifications);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _notifications = notifications;
        _unitOfWork = unitOfWork;
    }

    /// <summary>
    /// Handles a <see cref="MarkAllNotificationsReadCommand"/>, returning the exact count of the caller's
    /// own <c>Unread</c> records that were flipped to <c>Read</c> in scope (<c>0</c> when none), or a typed
    /// <see cref="NotificationError"/> when the caller is unauthenticated or cannot access the requested
    /// squad scope.
    /// </summary>
    /// <param name="command">The mark-all-read request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<int>> HandleAsync(
        MarkAllNotificationsReadCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        // A request without an authenticated caller is rejected up front, disclosing nothing (Requirement 10.2).
        Result authenticated = NotificationAuthorization.RequireAuthenticated(command.CallerUserId);
        if (!authenticated.IsSuccess)
        {
            return Result<int>.Fail(authenticated.Error!);
        }

        Guid callerUserId = command.CallerUserId!.Value;

        // A squad-scoped request over a squad the caller has no membership of any state in returns the same
        // non-disclosing not-found, so squad existence is never revealed (Requirements 9.8, 10.3).
        if (command.SquadId is { } squadId)
        {
            bool callerHoldsMembership =
                await _notifications.UserHasMembershipInSquadAsync(callerUserId, squadId, cancellationToken);

            Result scope = NotificationAuthorization.RequireSquadScope(callerHoldsMembership);
            if (!scope.IsSuccess)
            {
                return Result<int>.Fail(scope.Error!);
            }
        }

        // Resolve exactly the caller's own Unread records in scope; already-Read and out-of-scope records
        // are excluded and thus left unchanged (Requirements 9.6, 9.7).
        IReadOnlyList<InAppNotification> unread =
            await _notifications.ListUnreadForUserAsync(callerUserId, command.SquadId, cancellationToken);

        int changed = 0;
        foreach (InAppNotification record in unread)
        {
            // Idempotent, monotonic mark: each resolved Unread record flips to Read (Requirements 3.4, 9.5).
            Result marked = record.MarkRead();
            if (!marked.IsSuccess)
            {
                return Result<int>.Fail(marked.Error!);
            }

            changed++;
        }

        // Commit every flip atomically; nothing to commit when the caller had no unread records in scope.
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<int>.Ok(changed);
    }
}
