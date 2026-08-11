using PitchMate.Application.LiveTracking.UseCases;
using PitchMate.Domain.LiveTracking;

namespace PitchMate.Api.LiveTracking.Endpoints;

/// <summary>
/// One client-supplied event within an <see cref="EventBatchRequest"/> — the transport shape the
/// recording path classifies as <c>Applied</c>, <c>Duplicate</c>, or <c>Rejected</c>. It mirrors the
/// Application <see cref="EventSubmission"/> input: the client-generated GUID v7 <see cref="EventId"/>
/// (the sole idempotency key), the <see cref="Kind"/>, the raw <see cref="Minute"/> (validated to the
/// inclusive [0, 200] range during processing), and the per-kind fields. Fields not relevant to a given
/// <see cref="Kind"/> are left at their defaults; a required field left absent (for example a
/// <c>GoalScored</c> submission with no <see cref="ScoringTeamId"/>) is reported as a per-event
/// rejection rather than a request failure, so a bad submission never aborts the batch (Requirement 1.7,
/// 2.4).
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
public sealed record EventSubmissionRequest(
    Guid EventId,
    EventKind Kind,
    int Minute,
    Guid? ScoringTeamId = null,
    Guid? ScorerMembershipId = null,
    bool OwnGoal = false,
    Guid? KeeperMembershipId = null,
    Guid? KeptTeamId = null,
    Guid? TargetEventId = null)
{
    /// <summary>
    /// Projects this transport shape onto the Application <see cref="EventSubmission"/> the recording
    /// handler consumes, carrying every field through unchanged. Validation of the <c>Event_Id</c>
    /// policy, the minute range, and the per-kind required fields happens during processing, not here.
    /// </summary>
    /// <returns>The equivalent <see cref="EventSubmission"/>.</returns>
    public EventSubmission ToSubmission() => new(
        EventId,
        Kind,
        Minute,
        ScoringTeamId,
        ScorerMembershipId,
        OwnGoal,
        KeeperMembershipId,
        KeptTeamId,
        TargetEventId);
}
