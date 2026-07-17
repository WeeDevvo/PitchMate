namespace PitchMate.Domain.Notifications;

/// <summary>
/// The outcome of a fallible notification operation that produces no value. A success carries
/// nothing; a failure carries a <see cref="NotificationError"/>. Domain factories and behaviours
/// never throw for expected validation failures. Mirrors the established discriminated-result style of
/// <see cref="PitchMate.Domain.Squads.Result"/>.
/// </summary>
public readonly record struct Result
{
    /// <summary>True when the operation succeeded.</summary>
    public bool IsSuccess { get; }

    /// <summary>The failure detail on error; null on success.</summary>
    public NotificationError? Error { get; }

    private Result(bool isSuccess, NotificationError? error)
    {
        IsSuccess = isSuccess;
        Error = error;
    }

    /// <summary>Creates a successful result.</summary>
    public static Result Ok() => new(true, null);

    /// <summary>Creates a failed result carrying <paramref name="error"/>.</summary>
    public static Result Fail(NotificationError error) => new(false, error);
}
