namespace PitchMate.Domain.LiveTracking;

/// <summary>
/// The per-event result of processing one submitted <c>Match_Event</c> (Requirement 2.1, 2.4): the
/// <see cref="Outcome"/> it received, the <see cref="EventId"/> it was keyed on, and — only when the
/// <see cref="Outcome"/> is <see cref="EventOutcome.Rejected"/> — the <see cref="Error"/> giving the
/// reason it failed validation.
/// <para>
/// Instances are created through the <see cref="Applied"/>, <see cref="Duplicate"/>, and
/// <see cref="Rejected"/> factories so the invariant "an <see cref="Error"/> is present if and only if
/// the outcome is <see cref="EventOutcome.Rejected"/>" always holds. The value object is a pure result
/// shape carrying no behaviour beyond its data.
/// </para>
/// </summary>
/// <param name="Outcome">How the submitted event was classified.</param>
/// <param name="EventId">The client-generated GUID v7 <c>Event_Id</c> the outcome refers to.</param>
/// <param name="Error">The rejection reason when <paramref name="Outcome"/> is <see cref="EventOutcome.Rejected"/>; otherwise <see langword="null"/>.</param>
public readonly record struct RecordOutcome(
    EventOutcome Outcome,
    Guid EventId,
    LiveTrackingError? Error)
{
    /// <summary>
    /// Creates an <see cref="EventOutcome.Applied"/> outcome for <paramref name="eventId"/> — the event
    /// carried a new <c>Event_Id</c> and was appended (Requirement 1.1, 2.1).
    /// </summary>
    /// <param name="eventId">The <c>Event_Id</c> that was appended.</param>
    /// <returns>An applied outcome carrying no error.</returns>
    public static RecordOutcome Applied(Guid eventId) => new(EventOutcome.Applied, eventId, null);

    /// <summary>
    /// Creates an <see cref="EventOutcome.Duplicate"/> outcome for <paramref name="eventId"/> — the
    /// <c>Event_Id</c> was already present and the event was ignored (Requirement 1.2, 2.2, 2.3).
    /// </summary>
    /// <param name="eventId">The already-present <c>Event_Id</c>.</param>
    /// <returns>A duplicate outcome carrying no error.</returns>
    public static RecordOutcome Duplicate(Guid eventId) => new(EventOutcome.Duplicate, eventId, null);

    /// <summary>
    /// Creates an <see cref="EventOutcome.Rejected"/> outcome for <paramref name="eventId"/> carrying
    /// the <paramref name="error"/> that explains why the event failed validation (Requirement 2.4).
    /// </summary>
    /// <param name="eventId">The <c>Event_Id</c> that was rejected.</param>
    /// <param name="error">The validation failure detail; must not be <see langword="null"/>.</param>
    /// <returns>A rejected outcome carrying the reason it failed.</returns>
    public static RecordOutcome Rejected(Guid eventId, LiveTrackingError error)
    {
        ArgumentNullException.ThrowIfNull(error);
        return new RecordOutcome(EventOutcome.Rejected, eventId, error);
    }
}
