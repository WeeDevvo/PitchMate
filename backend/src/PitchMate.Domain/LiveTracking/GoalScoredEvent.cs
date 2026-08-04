namespace PitchMate.Domain.LiveTracking;

/// <summary>
/// A <see cref="MatchEvent"/> recording that a goal was scored (Requirement 3). It names the
/// <see cref="ScoringTeamId"/> credited with the goal (a working <c>MatchTeam.Id</c>, one-to-one with
/// a kickoff team), the optional <see cref="ScorerMembershipId"/> (absent when the scorer was not
/// recorded), and whether it was an <see cref="OwnGoal"/>.
/// <para>
/// Like every <see cref="MatchEvent"/> it is immutable and append-only; a mistaken goal is corrected
/// by a compensating <see cref="GoalRetractedEvent"/>, never by editing this event. The parameterless
/// constructor is reserved for the persistence layer.
/// </para>
/// </summary>
public sealed class GoalScoredEvent : MatchEvent
{
    /// <summary>Parameterless constructor reserved for the persistence layer.</summary>
    private GoalScoredEvent()
    {
    }

    /// <summary>
    /// Creates a goal-scored event from its client-generated <paramref name="eventId"/>, the owning
    /// <paramref name="matchId"/> and <paramref name="squadId"/>, the <paramref name="minute"/> of
    /// play, the credited <paramref name="scoringTeamId"/>, the optional
    /// <paramref name="scorerMembershipId"/>, and the <paramref name="ownGoal"/> flag.
    /// </summary>
    /// <param name="eventId">The client-generated GUID v7 <c>Event_Id</c>.</param>
    /// <param name="matchId">The identity of the match the goal belongs to.</param>
    /// <param name="squadId">The identity of the owning squad.</param>
    /// <param name="minute">The validated minute of play at which the goal was scored.</param>
    /// <param name="scoringTeamId">The working <c>MatchTeam.Id</c> credited with the goal.</param>
    /// <param name="scorerMembershipId">The scoring membership, or <see langword="null"/> when unrecorded.</param>
    /// <param name="ownGoal"><see langword="true"/> when the goal was an own goal.</param>
    public GoalScoredEvent(
        Guid eventId,
        Guid matchId,
        Guid squadId,
        MatchMinute minute,
        Guid scoringTeamId,
        Guid? scorerMembershipId,
        bool ownGoal)
        : base(eventId, matchId, squadId, EventKind.GoalScored, minute)
    {
        ScoringTeamId = scoringTeamId;
        ScorerMembershipId = scorerMembershipId;
        OwnGoal = ownGoal;
    }

    /// <summary>The working <c>MatchTeam.Id</c> credited with the goal.</summary>
    public Guid ScoringTeamId { get; private set; }

    /// <summary>The membership credited as scorer, or <see langword="null"/> when the scorer was not recorded (Requirement 3.7).</summary>
    public Guid? ScorerMembershipId { get; private set; }

    /// <summary>Whether the goal was an own goal.</summary>
    public bool OwnGoal { get; private set; }
}
