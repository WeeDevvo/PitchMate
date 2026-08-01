namespace PitchMate.Application.Notifications;

/// <summary>
/// A request by an authenticated caller to mark all of their own <c>Unread</c> in-app notifications as
/// read, optionally scoped to a single squad (Requirements 9.6, 9.7). The caller is identified by
/// <see cref="CallerUserId"/> — only records backed by that user are flipped. When
/// <see cref="SquadId"/> is supplied the operation is restricted to that squad and requires the caller
/// to hold a membership of any state there, otherwise it returns the same uniform, non-disclosing
/// not-found (Requirements 9.8, 10.1). Records that are already <c>Read</c> and records outside the
/// scope are left unchanged, and the handler reports the exact number of records changed.
/// </summary>
/// <param name="CallerUserId">The authenticated caller's user id, or <see langword="null"/> when the request is unauthenticated.</param>
/// <param name="SquadId">An optional squad to scope the operation to, or <see langword="null"/> to mark the caller's unread records across all squads.</param>
public sealed record MarkAllNotificationsReadCommand(
    Guid? CallerUserId,
    Guid? SquadId);
