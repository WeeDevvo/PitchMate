namespace PitchMate.Domain.LiveTracking;

/// <summary>
/// The classification a single submitted <c>Match_Event</c> receives when a batch is processed
/// (Requirement 2.1): it was newly appended, ignored as a known duplicate, or refused for a validation
/// reason.
/// <para>
/// The stable numeric values let the outcome round-trip through contracts and persistence-free logging
/// without depending on member order.
/// </para>
/// </summary>
public enum EventOutcome
{
    /// <summary>The event carried a new <c>Event_Id</c> and was appended to the match's log.</summary>
    Applied = 1,

    /// <summary>The event's <c>Event_Id</c> was already present (in the log or earlier in the same batch); it was ignored and no row was added.</summary>
    Duplicate = 2,

    /// <summary>The event failed validation and was refused; the accompanying <c>LiveTrackingError</c> gives the reason.</summary>
    Rejected = 3
}
