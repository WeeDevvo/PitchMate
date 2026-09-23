namespace PitchMate.Api.Notifications.Endpoints;

/// <summary>
/// The response of an unread-notification-count read: the count the Application read model reports,
/// carried as a named member of an object body rather than as a bare JSON number (Requirements 7.1,
/// 7.4). A transport record exists here only because the wire shape differs from the scalar the use
/// case returns — a named object schematises, stays extensible, and gives a client something to key
/// off (D6).
/// </summary>
/// <param name="Count">The number of the caller's unread notifications in the requested scope.</param>
public sealed record UnreadCountResponse(int Count);
