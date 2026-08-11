namespace PitchMate.Domain.LiveTracking;

/// <summary>
/// A <see cref="MatchEvent"/> that compensates for a mistaken goalkeeper stint by retracting a prior
/// <see cref="KeeperStintStartedEvent"/> (Requirement 5). It names the <see cref="TargetEventId"/> of
/// the stint-started event it retracts; the projection treats the target as retracted rather than
/// mutating or removing it, so the log stays strictly append-only and a re-retraction is a harmless
/// duplicate.
/// <para>
/// A retraction is itself never retracted. Its own <see cref="MatchEvent.Minute"/> is not
/// semantically meaningful to derivation but is validated and carried for audit like any other event.
/// The parameterless constructor is reserved for the persistence layer.
/// </para>
/// </summary>
public sealed class KeeperStintRetractedEvent : MatchEvent
{
    /// <summary>Parameterless constructor reserved for the persistence layer.</summary>
    private KeeperStintRetractedEvent()
    {
    }

    /// <summary>
    /// Creates a keeper-stint-retracted event from its client-generated <paramref name="eventId"/>, the
    /// owning <paramref name="matchId"/> and <paramref name="squadId"/>, the <paramref name="minute"/>
    /// of play, and the <paramref name="targetEventId"/> of the <see cref="KeeperStintStartedEvent"/>
    /// it retracts.
    /// </summary>
    /// <param name="eventId">The client-generated GUID v7 <c>Event_Id</c>.</param>
    /// <param name="matchId">The identity of the match the retraction belongs to.</param>
    /// <param name="squadId">The identity of the owning squad.</param>
    /// <param name="minute">The validated minute of play at which the retraction was recorded.</param>
    /// <param name="targetEventId">The identity of the keeper-stint-started event being retracted.</param>
    public KeeperStintRetractedEvent(
        Guid eventId,
        Guid matchId,
        Guid squadId,
        MatchMinute minute,
        Guid targetEventId)
        : base(eventId, matchId, squadId, EventKind.KeeperStintRetracted, minute)
    {
        TargetEventId = targetEventId;
    }

    /// <summary>The identity of the <see cref="KeeperStintStartedEvent"/> this event retracts.</summary>
    public Guid TargetEventId { get; private set; }
}
