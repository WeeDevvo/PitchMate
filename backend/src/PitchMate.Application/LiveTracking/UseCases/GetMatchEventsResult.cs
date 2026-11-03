using PitchMate.Domain.LiveTracking;

namespace PitchMate.Application.LiveTracking.UseCases;

/// <summary>
/// The outcome of a successful event-log read: the match's identity and every accepted event for it,
/// retractions included, in the order the events were minted (their client-generated GUID v7
/// <c>Event_Id</c>s ascending), so a client replays them as they were recorded.
/// </summary>
/// <param name="MatchId">The identity of the match whose log was read.</param>
/// <param name="Events">Every accepted event, oldest first.</param>
public sealed record GetMatchEventsResult(
    Guid MatchId,
    IReadOnlyList<MatchEvent> Events);
