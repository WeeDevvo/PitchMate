namespace PitchMate.Domain.LiveTracking;

/// <summary>
/// The client-generated <c>Event_Id</c> policy shared by every recording path. A tracking client
/// mints each event's identity as a GUID version 7, so the server rejects an id that is
/// <see cref="Guid.Empty"/> or whose UUID version is not 7 (Requirement 1.4).
/// <para>
/// The method is pure, static, and free of framework types so that every recording flow shares one
/// definition of an acceptable <c>Event_Id</c> and never throws for an expected validation failure.
/// </para>
/// </summary>
public static class EventIdPolicy
{
    /// <summary>
    /// Validates <paramref name="eventId"/> against the <c>Event_Id</c> policy. Returns a success when
    /// the id is a non-empty UUID version 7; otherwise a <see cref="LiveTrackingErrorCode.ValidationFailed"/>
    /// failure identifying the <c>Event_Id</c> policy. Never throws.
    /// </summary>
    /// <param name="eventId">The candidate client-generated event id.</param>
    /// <returns>A successful result when the id satisfies the policy, or a validation failure.</returns>
    public static Result Validate(Guid eventId) =>
        eventId != Guid.Empty && eventId.Version == 7
            ? Result.Ok()
            : Result.Fail(new LiveTrackingError(
                LiveTrackingErrorCode.ValidationFailed,
                "The Event_Id must be a non-empty client-generated GUID version 7."));
}
