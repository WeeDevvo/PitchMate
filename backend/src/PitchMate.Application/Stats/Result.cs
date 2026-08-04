namespace PitchMate.Application.Stats;

/// <summary>
/// The outcome of a fallible stats read use case that produces no value.
/// A success carries nothing; a failure carries a <see cref="StatsError"/>. Use cases never throw for
/// expected authorisation or validation failures. Mirrors the established discriminated-result style of
/// <see cref="PitchMate.Domain.Rating.Result{T}"/> while carrying a <see cref="StatsError"/>.
/// </summary>
public readonly record struct Result
{
    /// <summary>True when the operation succeeded.</summary>
    public bool IsSuccess { get; }

    /// <summary>The failure detail on error; null on success.</summary>
    public StatsError? Error { get; }

    private Result(bool isSuccess, StatsError? error)
    {
        IsSuccess = isSuccess;
        Error = error;
    }

    /// <summary>Creates a successful result.</summary>
    public static Result Ok() => new(true, null);

    /// <summary>Creates a failed result carrying <paramref name="error"/>.</summary>
    public static Result Fail(StatsError error) => new(false, error);
}
