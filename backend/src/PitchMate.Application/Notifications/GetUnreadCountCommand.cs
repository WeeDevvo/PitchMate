namespace PitchMate.Application.Notifications;

/// <summary>
/// A request by an authenticated caller for the count of their own <c>Unread</c> in-app notifications,
/// optionally scoped to a single squad (Requirements 9.3, 9.4). The count is always restricted to
/// records backed by <see cref="CallerUserId"/>.
/// </summary>
/// <param name="CallerUserId">
/// The authenticated caller's user id, or <see langword="null"/> when the request is unauthenticated
/// (rejected by the authorisation gate, Requirement 10.2).
/// </param>
/// <param name="SquadId">
/// An optional squad to scope the count to, or <see langword="null"/> to count across all the caller's
/// squads (Requirement 9.4).
/// </param>
public sealed record GetUnreadCountCommand(Guid? CallerUserId, Guid? SquadId = null);
