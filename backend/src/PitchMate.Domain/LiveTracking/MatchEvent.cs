using PitchMate.Domain.Common;

namespace PitchMate.Domain.LiveTracking;

/// <summary>
/// An immutable, append-only record of one occurrence tracked while a match is played (Requirement 1.3,
/// 1.6). Modelled as an abstract base with one concrete subclass per <see cref="EventKind"/>
/// (table-per-hierarchy on the <see cref="Kind"/> discriminator), it carries the common event state:
/// the client-generated GUID v7 <c>Event_Id</c> (the <see cref="BaseEntity.Id"/> base key, assigned
/// from the request and never server-generated), the owning <see cref="MatchId"/> and
/// <see cref="SquadId"/>, the <see cref="Kind"/>, the <see cref="Minute"/> of play, and the audit
/// fields inherited from <see cref="BaseEntity"/>.
/// <para>
/// A <see cref="MatchEvent"/> exposes no mutator: once accepted it is never updated or deleted
/// (Requirement 1.3), and in-match corrections are recorded as compensating retraction events rather
/// than in-place edits. Whether an event is retracted is <strong>not</strong> stored here — it is
/// derived by the projection from the presence of a matching accepted retraction event, keeping the
/// log strictly append-only.
/// </para>
/// <para>
/// The type uses only the .NET base class library and existing Domain types, keeping Domain free of
/// framework concerns. The parameterless constructor is reserved for the persistence layer's
/// table-per-hierarchy materialisation.
/// </para>
/// </summary>
public abstract class MatchEvent : BaseEntity
{
    /// <summary>Parameterless constructor reserved for the persistence layer.</summary>
    protected MatchEvent()
    {
    }

    /// <summary>
    /// Initialises the common event state. The <paramref name="eventId"/> is the client-generated GUID
    /// v7 <c>Event_Id</c> retained unchanged as the entity's identity (its policy is validated by the
    /// recording path before construction).
    /// </summary>
    /// <param name="eventId">The client-generated GUID v7 <c>Event_Id</c>, retained as the entity identity.</param>
    /// <param name="matchId">The identity of the match the event belongs to.</param>
    /// <param name="squadId">The identity of the owning squad — the visibility scope boundary.</param>
    /// <param name="kind">The event kind discriminator.</param>
    /// <param name="minute">The validated minute of play at which the event occurred.</param>
    protected MatchEvent(Guid eventId, Guid matchId, Guid squadId, EventKind kind, MatchMinute minute)
        : base(eventId)
    {
        MatchId = matchId;
        SquadId = squadId;
        Kind = kind;
        Minute = minute;
    }

    /// <summary>The identity of the match this event belongs to; an event is never applied to a different match.</summary>
    public Guid MatchId { get; private set; }

    /// <summary>The identity of the owning squad — the scope boundary for all visibility (Requirement 11.3).</summary>
    public Guid SquadId { get; private set; }

    /// <summary>The event kind discriminator (Requirement 1.6).</summary>
    public EventKind Kind { get; private set; }

    /// <summary>The whole-number minute of play at which the event occurred, in the inclusive range [0, 200].</summary>
    public MatchMinute Minute { get; private set; }
}
