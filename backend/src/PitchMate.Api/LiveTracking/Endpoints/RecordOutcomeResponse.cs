using PitchMate.Domain.LiveTracking;

namespace PitchMate.Api.LiveTracking.Endpoints;

/// <summary>
/// The per-event outcome of processing one submitted event, mirroring the Domain
/// <see cref="RecordOutcome"/> (Requirement 2.1, 2.4): the <see cref="EventId"/> it was keyed on, how
/// it was classified in <see cref="Outcome"/>, and — only when the <see cref="Outcome"/> is
/// <see cref="EventOutcome.Rejected"/> — the stable <see cref="RejectionCode"/> and human-readable
/// <see cref="RejectionReason"/> explaining why it failed validation.
/// <para>
/// A per-event <c>Duplicate</c> or <c>Rejected</c> is not a request failure — it is carried here inside
/// the successful batch response, so a client can correlate every event it sent with how it was
/// classified. <see cref="RejectionCode"/> and <see cref="RejectionReason"/> are <see langword="null"/>
/// for an <c>Applied</c> or <c>Duplicate</c> outcome.
/// </para>
/// </summary>
/// <param name="EventId">The client-generated GUID v7 <c>Event_Id</c> the outcome refers to.</param>
/// <param name="Outcome">How the submitted event was classified.</param>
/// <param name="RejectionCode">The stable rejection classification when <paramref name="Outcome"/> is <c>Rejected</c>; otherwise <see langword="null"/>.</param>
/// <param name="RejectionReason">The human-readable rejection reason when <paramref name="Outcome"/> is <c>Rejected</c>; otherwise <see langword="null"/>.</param>
public sealed record RecordOutcomeResponse(
    Guid EventId,
    EventOutcome Outcome,
    LiveTrackingErrorCode? RejectionCode,
    string? RejectionReason)
{
    /// <summary>
    /// Maps a Domain <see cref="RecordOutcome"/> onto its response shape, surfacing the rejection code
    /// and message only when the outcome carries an error.
    /// </summary>
    /// <param name="outcome">The per-event outcome to map.</param>
    /// <returns>The equivalent <see cref="RecordOutcomeResponse"/>.</returns>
    public static RecordOutcomeResponse From(RecordOutcome outcome) =>
        new(outcome.EventId, outcome.Outcome, outcome.Error?.Code, outcome.Error?.Message);
}
