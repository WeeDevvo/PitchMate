namespace PitchMate.Domain.Squads;

/// <summary>
/// The outcome of a fallible squad/membership operation that produces no value.
/// A success carries nothing; a failure carries a <see cref="SquadError"/>. Domain factories and behaviours
/// never throw for expected validation or authorisation failures. Mirrors the established discriminated-result
/// style of <see cref="PitchMate.Domain.Rating.Result{T}"/> while carrying a <see cref="SquadError"/>.
/// </summary>
public readonly record struct Result
{
    /// <summary>True when the operation succeeded.</summary>
    public bool IsSuccess { get; }

    /// <summary>The failure detail on error; null on success.</summary>
    public SquadError? Error { get; }

    private Result(bool isSuccess, SquadError? error)
    {
        IsSuccess = isSuccess;
        Error = error;
    }

    /// <summary>Creates a successful result.</summary>
    public static Result Ok() => new(true, null);

    /// <summary>Creates a failed result carrying <paramref name="error"/>.</summary>
    public static Result Fail(SquadError error) => new(false, error);
}
