using PitchMate.Domain.LiveTracking;

namespace PitchMate.Api.LiveTracking.Endpoints;

/// <summary>
/// The response of a record-events request, mirroring the Domain <see cref="BatchResult"/>
/// (Requirement 2.1): the ordered per-event <see cref="RecordOutcomeResponse"/>s, one for each
/// submitted event and in the order it was submitted, so a client can correlate every event it sent
/// with how it was classified. This response is returned with a success status even when some events
/// were classified <c>Duplicate</c> or <c>Rejected</c>, because those are per-event outcomes rather
/// than request failures.
/// </summary>
/// <param name="Outcomes">The per-event outcomes, in the order the events were submitted in the batch.</param>
public sealed record BatchResultResponse(IReadOnlyList<RecordOutcomeResponse> Outcomes)
{
    /// <summary>
    /// Maps a Domain <see cref="BatchResult"/> onto its response shape, preserving the per-event order.
    /// </summary>
    /// <param name="result">The batch result to map.</param>
    /// <returns>The equivalent <see cref="BatchResultResponse"/>.</returns>
    public static BatchResultResponse From(BatchResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        return new BatchResultResponse([.. result.Outcomes.Select(RecordOutcomeResponse.From)]);
    }
}
