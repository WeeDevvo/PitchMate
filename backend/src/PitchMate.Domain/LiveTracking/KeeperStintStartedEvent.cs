namespace PitchMate.Domain.LiveTracking;

/// <summary>
/// A <see cref="MatchEvent"/> recording that a goalkeeper stint began (Requirement 4): the
/// <see cref="KeeperMembershipId"/> took over in goal for the <see cref="KeptTeamId"/> from this
/// event's minute of play. Keepers rotate during a match, so goalkeeping is modelled as a sequence of
/// stints whose closing bounds are derived by the projection rather than stored.
/// <para>
/// Like every <see cref="MatchEvent"/> it is immutable and append-only; a mistaken stint is corrected
/// by a compensating <see cref="KeeperStintRetractedEvent"/>, never by editing this event. The
/// parameterless constructor is reserved for the persistence layer.
/// </para>
/// </summary>
public sealed class KeeperStintStartedEvent : MatchEvent
{
    /// <summary>Parameterless constructor reserved for the persistence layer.</summary>
    private KeeperStintStartedEvent()
    {
    }

    /// <summary>
    /// Creates a keeper-stint-started event from its client-generated <paramref name="eventId"/>, the
    /// owning <paramref name="matchId"/> and <paramref name="squadId"/>, the <paramref name="minute"/>
    /// at which the stint began, the <paramref name="keeperMembershipId"/> taking over in goal, and the
    /// <paramref name="keptTeamId"/> being kept.
    /// </summary>
    /// <param name="eventId">The client-generated GUID v7 <c>Event_Id</c>.</param>
    /// <param name="matchId">The identity of the match the stint belongs to.</param>
    /// <param name="squadId">The identity of the owning squad.</param>
    /// <param name="minute">The validated minute of play at which the stint began.</param>
    /// <param name="keeperMembershipId">The membership taking over in goal.</param>
    /// <param name="keptTeamId">The working <c>MatchTeam.Id</c> being kept.</param>
    public KeeperStintStartedEvent(
        Guid eventId,
        Guid matchId,
        Guid squadId,
        MatchMinute minute,
        Guid keeperMembershipId,
        Guid keptTeamId)
        : base(eventId, matchId, squadId, EventKind.KeeperStintStarted, minute)
    {
        KeeperMembershipId = keeperMembershipId;
        KeptTeamId = keptTeamId;
    }

    /// <summary>The membership that took over in goal at the start of this stint.</summary>
    public Guid KeeperMembershipId { get; private set; }

    /// <summary>The working <c>MatchTeam.Id</c> the keeper was keeping for this stint.</summary>
    public Guid KeptTeamId { get; private set; }
}
