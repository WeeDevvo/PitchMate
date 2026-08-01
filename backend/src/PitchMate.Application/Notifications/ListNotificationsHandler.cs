using PitchMate.Domain.Common;
using PitchMate.Domain.Notifications;

namespace PitchMate.Application.Notifications;

/// <summary>
/// Returns the authenticated caller's own in-app notifications, optionally scoped to a single squad
/// (Requirements 9.1, 9.2, 9.4). The read model is <b>own-records-only</b>: the repository resolves
/// only records whose recipient membership is backed by the caller's user, so no other user's records
/// are ever disclosed. The handler:
/// <list type="number">
/// <item>Requires an authenticated caller; an unauthenticated request is rejected with
/// <see cref="NotificationErrorCode.Unauthenticated"/> (Requirement 10.2).</item>
/// <item>For a squad-scoped request, gates on the caller holding a membership of any state in that
/// squad, returning the uniform non-disclosing <see cref="NotificationErrorCode.NotFound"/> otherwise
/// so a squad the caller cannot access is never revealed (Requirements 10.3, 10.4).</item>
/// <item>Orders the resolved records by creation instant descending, breaking ties by GUID v7 identity
/// descending via <see cref="UuidV7Comparer"/> for a stable total order, and caps the result at the
/// most recent <see cref="MaxListSize"/> records (Requirements 9.1, 9.9, 9.10). The ordering and cap are
/// applied in-memory here so the contract holds regardless of the storage layer's own ordering.</item>
/// <item>Projects each record to a <see cref="NotificationSummary"/>. An empty result is an empty
/// collection success, never an error.</item>
/// </list>
/// </summary>
public sealed class ListNotificationsHandler
{
    /// <summary>The maximum number of most-recent notifications a single listing returns (Requirement 9.9).</summary>
    public const int MaxListSize = 200;

    private readonly INotificationRepository _notifications;

    /// <summary>Creates the handler with the notification read surface it queries.</summary>
    /// <param name="notifications">The own-records-only notification read surface.</param>
    public ListNotificationsHandler(INotificationRepository notifications)
    {
        ArgumentNullException.ThrowIfNull(notifications);
        _notifications = notifications;
    }

    /// <summary>
    /// Handles a <see cref="ListNotificationsCommand"/>, returning the caller's own notifications in a
    /// stable, capped, optionally squad-scoped order, or an authorisation failure.
    /// </summary>
    /// <param name="command">The listing request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    /// <returns>The caller's own notifications (possibly empty) on success; otherwise the failure.</returns>
    public async Task<Result<IReadOnlyList<NotificationSummary>>> HandleAsync(
        ListNotificationsCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        Result authenticated = NotificationAuthorization.RequireAuthenticated(command.CallerUserId);
        if (!authenticated.IsSuccess)
        {
            return Result<IReadOnlyList<NotificationSummary>>.Fail(authenticated.Error!);
        }

        Guid userId = command.CallerUserId!.Value;

        if (command.SquadId is { } squadId)
        {
            bool hasMembership =
                await _notifications.UserHasMembershipInSquadAsync(userId, squadId, cancellationToken);

            Result scoped = NotificationAuthorization.RequireSquadScope(hasMembership);
            if (!scoped.IsSuccess)
            {
                return Result<IReadOnlyList<NotificationSummary>>.Fail(scoped.Error!);
            }
        }

        IReadOnlyList<InAppNotification> records =
            await _notifications.ListForUserAsync(userId, command.SquadId, MaxListSize, cancellationToken);

        IReadOnlyList<NotificationSummary> summaries = records
            .OrderByDescending(record => record.CreatedAt)
            .ThenByDescending(record => record.Id, UuidV7Comparer.Instance)
            .Take(MaxListSize)
            .Select(record => new NotificationSummary(
                record.Id,
                record.Type,
                record.SquadId,
                record.Title,
                record.Body,
                record.CreatedAt,
                record.ReadState))
            .ToList();

        return Result<IReadOnlyList<NotificationSummary>>.Ok(summaries);
    }
}
