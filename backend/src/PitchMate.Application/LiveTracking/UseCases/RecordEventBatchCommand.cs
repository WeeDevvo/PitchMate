namespace PitchMate.Application.LiveTracking.UseCases;

/// <summary>
/// A request to record an <c>Event_Batch</c> of one or more <c>Match_Event</c>s for a single match
/// (Requirement 2.1). The command carries only the target <paramref name="MatchId"/> and the submitted
/// <paramref name="Events"/>; the acting user is <strong>never</strong> taken from the request body —
/// <see cref="RecordEventBatchHandler"/> resolves the requester from the authenticated access-token
/// subject via <see cref="Common.ICurrentUserAccessor"/> and authorises it against the match's squad
/// (Requirement 11.1).
/// <para>
/// Recording a single event is modelled as a batch of one, so every recording flows through the same
/// path (Requirement 1, 2). An empty batch is rejected as a whole-request validation failure
/// (Requirement 2.6); a per-event <c>Duplicate</c> or <c>Rejected</c> outcome is not a request failure
/// and rides in the returned <c>Batch_Result</c>.
/// </para>
/// </summary>
/// <param name="MatchId">The match the batch is recorded against; resolved and squad-scoped by the handler.</param>
/// <param name="Events">The submitted events, in the order the client sent them; must contain at least one.</param>
public sealed record RecordEventBatchCommand(
    Guid MatchId,
    IReadOnlyList<EventSubmission> Events);
