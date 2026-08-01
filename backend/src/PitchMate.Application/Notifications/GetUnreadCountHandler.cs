using PitchMate.Domain.Notifications;

namespace PitchMate.Application.Notifications;

/// <summary>
/// Returns the exact count of the authenticated caller's own <c>Unread</c> in-app notifications,
/// optionally scoped to a single squad (Requirements 9.3, 9.4, 9.8). The count is <b>own-records-only</b>:
/// the repository counts only records whose recipient membership is backed by the caller's user, so no
/// other user's records ever contribute. The handler:
/// <list type="number">
/// <item>Requires an authenticated caller; an unauthenticated request is rejected with
/// <see cref="NotificationErrorCode.Unauthenticated"/> (Requirement 10.2).</item>
/// <item>For a squad-scoped request, gates on the caller holding a membership of any state in that
/// squad, returning the uniform non-disclosing <see cref="NotificationErrorCode.NotFound"/> otherwise so
/// a squad the caller cannot access is never revealed (Requirements 10.3, 10.4).</item>
/// <item>Returns the exact non-negative count, which is <c>0</c> when the caller has no matching unread
/// records (Requirement 9.3).</item>
/// </list>
/// </summary>
public sealed class GetUnreadCountHandler
{
    private readonly INotificationRepository _notifications;

    /// <summary>Creates the handler with the notification read surface it queries.</summary>
    /// <param name="notifications">The own-records-only notification read surface.</param>
    public GetUnreadCountHandler(INotificationRepository notifications)
    {
        ArgumentNullException.ThrowIfNull(notifications);
        _notifications = notifications;
    }

    /// <summary>
    /// Handles a <see cref="GetUnreadCountCommand"/>, returning the caller's own unread count in scope,
    /// or an authorisation failure.
    /// </summary>
    /// <param name="command">The unread-count request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    /// <returns>The caller's own unread count (<c>0</c> when none) on success; otherwise the failure.</returns>
    public async Task<Result<int>> HandleAsync(
        GetUnreadCountCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        Result authenticated = NotificationAuthorization.RequireAuthenticated(command.CallerUserId);
        if (!authenticated.IsSuccess)
        {
            return Result<int>.Fail(authenticated.Error!);
        }

        Guid userId = command.CallerUserId!.Value;

        if (command.SquadId is { } squadId)
        {
            bool hasMembership =
                await _notifications.UserHasMembershipInSquadAsync(userId, squadId, cancellationToken);

            Result scoped = NotificationAuthorization.RequireSquadScope(hasMembership);
            if (!scoped.IsSuccess)
            {
                return Result<int>.Fail(scoped.Error!);
            }
        }

        int count = await _notifications.CountUnreadForUserAsync(userId, command.SquadId, cancellationToken);

        return Result<int>.Ok(count);
    }
}
