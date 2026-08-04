namespace PitchMate.Domain.LiveTracking;

/// <summary>
/// The outcome of a fallible live-tracking operation that produces no value.
/// A success carries nothing; a failure carries a <see cref="LiveTrackingError"/>. Domain factories and
/// behaviours never throw for expected validation or authorisation failures. Mirrors the established
/// discriminated-result style of <see cref="PitchMate.Domain.Squads.Result"/> while carrying a
/// <see cref="LiveTrackingError"/>.
/// </summary>
public readonly record struct Result
{
    /// <summary>True when the operation succeeded.</summary>
    public bool IsSuccess { get; }

    /// <summary>The failure detail on error; null on success.</summary>
    public LiveTrackingError? Error { get; }

    private Result(bool isSuccess, LiveTrackingError? error)
    {
        IsSuccess = isSuccess;
        Error = error;
    }

    /// <summary>Creates a successful result.</summary>
    public static Result Ok() => new(true, null);

    /// <summary>Creates a failed result carrying <paramref name="error"/>.</summary>
    public static Result Fail(LiveTrackingError error) => new(false, error);
}
