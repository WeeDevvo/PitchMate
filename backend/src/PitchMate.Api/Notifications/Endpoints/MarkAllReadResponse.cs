namespace PitchMate.Api.Notifications.Endpoints;

/// <summary>
/// The response of a mark-all-notifications-read action: the number of records the action changed,
/// carried as a named member of an object body rather than as a bare JSON number (Requirements 7.2,
/// 7.4). A transport record exists here only because the wire shape differs from the scalar the use
/// case returns (D6).
/// </summary>
/// <param name="MarkedCount">The number of the caller's notifications this action marked read.</param>
public sealed record MarkAllReadResponse(int MarkedCount);
