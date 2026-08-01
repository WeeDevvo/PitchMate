namespace PitchMate.Application.Notifications;

/// <summary>
/// A request by an authenticated caller for their own in-app notifications, optionally scoped to a
/// single squad (Requirements 9.1, 9.4). The listing is always restricted to records backed by
/// <see cref="CallerUserId"/> and capped at the most recent
/// <see cref="ListNotificationsHandler.MaxListSize"/> records in a stable total order.
/// </summary>
/// <param name="CallerUserId">
/// The authenticated caller's user id, or <see langword="null"/> when the request is unauthenticated
/// (rejected by the authorisation gate, Requirement 10.2).
/// </param>
/// <param name="SquadId">
/// An optional squad to scope the listing to, or <see langword="null"/> to list across all the
/// caller's squads (Requirement 9.4).
/// </param>
public sealed record ListNotificationsCommand(Guid? CallerUserId, Guid? SquadId = null);
