using PitchMate.Domain.LiveTracking;

namespace PitchMate.Application.LiveTracking.UseCases;

/// <summary>
/// One raw, client-supplied event within a <see cref="RecordEventBatchCommand"/> — the transport
/// shape the recording path classifies as <c>Applied</c>, <c>Duplicate</c>, or <c>Rejected</c>. It
/// carries the client-generated <c>Event_Id</c>, the <see cref="Kind"/>, the raw <see cref="Minute"/>
/// (validated to the inclusive [0, 200] range by <see cref="MatchMinute"/> during processing), and the
/// per-kind fields. The fields not relevant to a given <see cref="Kind"/> are left at their defaults;
/// a required field left absent (for example a <c>GoalScored</c> submission with no
/// <see cref="ScoringTeamId"/>) is rejected with a validation error rather than throwing, so a bad
/// submission never aborts the batch.
/// <para>
/// This is deliberately a raw input rather than a constructed <see cref="MatchEvent"/>: an out-of-range
/// minute or a bad <c>Event_Id</c> must be reportable as a per-event rejection, which a pre-constructed
/// domain event could not represent.
/// </para>
/// </summary>
/// <param name="EventId">The client-generated GUID v7 <c>Event_Id</c>; the sole idempotency key.</param>
/// <param name="Kind">The kind of event being recorded.</param>
/// <param name="Minute">The raw minute of play; validated to [0, 200] during processing.</param>
/// <param name="ScoringTeamId"><c>GoalScored</c> only — the working <c>MatchTeam.Id</c> credited with the goal.</param>
/// <param name="ScorerMembershipId"><c>GoalScored</c> only — the scoring membership, or <see langword="null"/> when unrecorded.</param>
/// <param name="OwnGoal"><c>GoalScored</c> only — whether the goal was an own goal.</param>
/// <param name="KeeperMembershipId"><c>KeeperStintStarted</c> only — the membership taking over in goal.</param>
/// <param name="KeptTeamId"><c>KeeperStintStarted</c> only — the working <c>MatchTeam.Id</c> being kept.</param>
/// <param name="TargetEventId">Retraction kinds only — the <c>Event_Id</c> of the event being retracted.</param>
public sealed record EventSubmission(
    Guid EventId,
    EventKind Kind,
    int Minute,
    Guid? ScoringTeamId = null,
    Guid? ScorerMembershipId = null,
    bool OwnGoal = false,
    Guid? KeeperMembershipId = null,
    Guid? KeptTeamId = null,
    Guid? TargetEventId = null);
