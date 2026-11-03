using PitchMate.Domain.LiveTracking;

namespace PitchMate.Api.LiveTracking.Endpoints;

/// <summary>
/// One accepted event as the event-log read reports it, in the same shape a client submits it
/// (<see cref="EventSubmissionRequest"/>): its identity, kind and minute, and the members its kind
/// carries. A member the kind does not carry is <see langword="null"/> (or <see langword="false"/> for
/// <see cref="OwnGoal"/>).
/// </summary>
/// <param name="EventId">The event's client-generated GUID v7 identity.</param>
/// <param name="Kind">The event's kind.</param>
/// <param name="Minute">The match minute it was recorded at.</param>
/// <param name="ScoringTeamId">A goal's scoring team.</param>
/// <param name="ScorerMembershipId">A goal's scorer, when one was named.</param>
/// <param name="OwnGoal">Whether a goal is an own goal.</param>
/// <param name="KeeperMembershipId">A keeper stint's keeper.</param>
/// <param name="KeptTeamId">A keeper stint's team.</param>
/// <param name="TargetEventId">A retraction's target event.</param>
public sealed record MatchEventResponse(
    Guid EventId,
    EventKind Kind,
    int Minute,
    Guid? ScoringTeamId,
    Guid? ScorerMembershipId,
    bool OwnGoal,
    Guid? KeeperMembershipId,
    Guid? KeptTeamId,
    Guid? TargetEventId)
{
    /// <summary>Projects an accepted <see cref="MatchEvent"/> onto its response shape.</summary>
    public static MatchEventResponse From(MatchEvent matchEvent)
    {
        ArgumentNullException.ThrowIfNull(matchEvent);

        return matchEvent switch
        {
            GoalScoredEvent goal => new(
                goal.Id, goal.Kind, goal.Minute.Value, goal.ScoringTeamId, goal.ScorerMembershipId, goal.OwnGoal,
                KeeperMembershipId: null, KeptTeamId: null, TargetEventId: null),
            KeeperStintStartedEvent stint => new(
                stint.Id, stint.Kind, stint.Minute.Value, ScoringTeamId: null, ScorerMembershipId: null, OwnGoal: false,
                stint.KeeperMembershipId, stint.KeptTeamId, TargetEventId: null),
            GoalRetractedEvent retraction => Retraction(retraction, retraction.TargetEventId),
            KeeperStintRetractedEvent retraction => Retraction(retraction, retraction.TargetEventId),
            _ => throw new InvalidOperationException($"Unknown event kind '{matchEvent.Kind}'."),
        };
    }

    private static MatchEventResponse Retraction(MatchEvent retraction, Guid targetEventId) =>
        new(
            retraction.Id, retraction.Kind, retraction.Minute.Value, ScoringTeamId: null, ScorerMembershipId: null,
            OwnGoal: false, KeeperMembershipId: null, KeptTeamId: null, targetEventId);
}
