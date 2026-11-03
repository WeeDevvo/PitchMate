using PitchMate.Application.LiveTracking.UseCases;

namespace PitchMate.Api.LiveTracking.Endpoints;

/// <summary>
/// The event-log read's response: the match's identity and every accepted event, retractions included,
/// oldest first.
/// </summary>
/// <param name="MatchId">The identity of the match whose log was read.</param>
/// <param name="Events">Every accepted event, in the order it was minted.</param>
public sealed record MatchEventLogResponse(
    Guid MatchId,
    IReadOnlyList<MatchEventResponse> Events)
{
    /// <summary>Projects the Application read result onto the response shape.</summary>
    public static MatchEventLogResponse From(GetMatchEventsResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        return new MatchEventLogResponse(result.MatchId, [.. result.Events.Select(MatchEventResponse.From)]);
    }
}
