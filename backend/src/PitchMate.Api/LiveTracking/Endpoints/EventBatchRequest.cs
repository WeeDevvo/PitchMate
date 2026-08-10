using PitchMate.Application.LiveTracking.UseCases;

namespace PitchMate.Api.LiveTracking.Endpoints;

/// <summary>
/// The body of a record-events request (Requirement 2.1): an <c>Event_Batch</c> of one or more
/// <see cref="EventSubmissionRequest"/>s to record against a single match, the unit of the
/// offline-first batched sync. The target match is taken from the route and the acting admin from the
/// access token, never from the body.
/// <para>
/// Recording a single event is modelled as a batch of one so every recording flows through the same
/// path (Requirement 1, 2). An empty or absent batch is rejected as a whole-request validation failure
/// (Requirement 2.6); a per-event <c>Duplicate</c> or <c>Rejected</c> outcome is not a request failure
/// and rides in the returned <see cref="BatchResultResponse"/>.
/// </para>
/// </summary>
/// <param name="Events">The submitted events, in the order the client sent them; must contain at least one.</param>
public sealed record EventBatchRequest(IReadOnlyList<EventSubmissionRequest>? Events)
{
    /// <summary>
    /// Projects the submitted events onto the Application <see cref="EventSubmission"/> list the
    /// recording command carries, preserving submission order. An absent list maps to an empty list so
    /// the handler owns the empty-batch rejection (Requirement 2.6).
    /// </summary>
    /// <returns>The submissions in order, or an empty list when none were supplied.</returns>
    public IReadOnlyList<EventSubmission> ToSubmissions() =>
        Events is null ? [] : [.. Events.Select(e => e.ToSubmission())];
}
