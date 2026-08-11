namespace PitchMate.Domain.LiveTracking;

/// <summary>
/// The closed set of <c>Match_Event</c> kinds recorded during live tracking (Requirement 1.6):
/// a goal, a retraction of a goal, the start of a goalkeeper stint, and a retraction of a stint.
/// <para>
/// Persistence stores the stable numeric value as a table-per-hierarchy discriminator, so members
/// must not be renumbered or removed once shipped.
/// </para>
/// </summary>
public enum EventKind
{
    /// <summary>A goal was scored: records the scoring team, an optional scorer, an own-goal flag, and the minute.</summary>
    GoalScored = 1,

    /// <summary>A compensating correction that retracts a prior <see cref="GoalScored"/> event.</summary>
    GoalRetracted = 2,

    /// <summary>A goalkeeper stint began: records the keeper, the kept team, and the minute.</summary>
    KeeperStintStarted = 3,

    /// <summary>A compensating correction that retracts a prior <see cref="KeeperStintStarted"/> event.</summary>
    KeeperStintRetracted = 4
}
