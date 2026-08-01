namespace PitchMate.Application.Notifications;

/// <summary>
/// A request by an authenticated caller to mark one of their own in-app notifications as read
/// (Requirement 9.5). The caller is identified by <see cref="CallerUserId"/> — the notification is only
/// acted on when it is backed by that user, so a record that does not exist or is not the caller's is
/// reported with a uniform, non-disclosing not-found (Requirement 10.1). Marking read is idempotent: a
/// record that is already <c>Read</c> stays <c>Read</c> and the request still succeeds.
/// </summary>
/// <param name="CallerUserId">The authenticated caller's user id, or <see langword="null"/> when the request is unauthenticated.</param>
/// <param name="NotificationId">The identity of the caller's own notification to mark read.</param>
public sealed record MarkNotificationReadCommand(
    Guid? CallerUserId,
    Guid NotificationId);
