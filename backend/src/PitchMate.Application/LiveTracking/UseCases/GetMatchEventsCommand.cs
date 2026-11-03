namespace PitchMate.Application.LiveTracking.UseCases;

/// <summary>
/// A request by an authenticated squad member to read a live-tracked match's event log: every accepted
/// event, retractions included, so a client can rebuild what it recorded (the keeper in goal, the goals
/// an undo or a correction can name) after a reload. The command carries only the target
/// <paramref name="MatchId"/>; <see cref="GetMatchEventsHandler"/> resolves the requester from the
/// authenticated access-token subject via <see cref="Common.ICurrentUserAccessor"/>, never from the
/// request.
/// </summary>
/// <param name="MatchId">The match whose event log is read.</param>
public sealed record GetMatchEventsCommand(Guid MatchId);
