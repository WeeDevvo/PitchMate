namespace PitchMate.Domain.LiveTracking;

/// <summary>
/// The whole-number minute of play at which a <c>Match_Event</c> occurred, from 0 to 200 inclusive
/// (Requirement 3.6, 4.5). The value object encapsulates the single range rule (<see cref="Create"/>)
/// so every recording path shares one definition of an acceptable minute.
/// <para>
/// Because the underlying store is an <see cref="int"/>, a non-whole minute is structurally
/// unrepresentable; the factory still enforces the inclusive [0, 200] range and returns a validation
/// failure — rather than throwing — for a negative or greater-than-200 value.
/// </para>
/// </summary>
public readonly record struct MatchMinute
{
    /// <summary>The smallest acceptable match minute, inclusive.</summary>
    public const int MinValue = 0;

    /// <summary>The largest acceptable match minute, inclusive.</summary>
    public const int MaxValue = 200;

    /// <summary>The validated whole-number minute of play, in the inclusive range [0, 200].</summary>
    public int Value { get; }

    private MatchMinute(int value) => Value = value;

    /// <summary>
    /// Validates <paramref name="value"/> as a whole minute within the inclusive range
    /// [<see cref="MinValue"/>, <see cref="MaxValue"/>]. Returns a success carrying the
    /// <see cref="MatchMinute"/>, or a <see cref="LiveTrackingErrorCode.ValidationFailed"/> failure
    /// identifying the match-minute policy for a negative or greater-than-200 value. Never throws.
    /// </summary>
    /// <param name="value">The candidate minute of play.</param>
    /// <returns>A successful result with the minute, or a validation failure.</returns>
    public static Result<MatchMinute> Create(int value) =>
        value is >= MinValue and <= MaxValue
            ? Result<MatchMinute>.Ok(new MatchMinute(value))
            : Result<MatchMinute>.Fail(new LiveTrackingError(
                LiveTrackingErrorCode.ValidationFailed,
                $"The match minute must be a whole number from {MinValue} to {MaxValue} inclusive."));
}
