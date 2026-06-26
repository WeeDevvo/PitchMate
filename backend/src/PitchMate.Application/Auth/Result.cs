namespace PitchMate.Application.Auth;

/// <summary>
/// The outcome of a fallible authentication/identity use case that produces no value.
/// A success carries nothing; a failure carries an <see cref="AuthError"/>. Use cases never throw for
/// expected validation or authentication failures. Mirrors the established discriminated-result style of
/// <see cref="PitchMate.Domain.Rating.Result{T}"/> while carrying an <see cref="AuthError"/>.
/// </summary>
public readonly record struct Result
{
    /// <summary>True when the operation succeeded.</summary>
    public bool IsSuccess { get; }

    /// <summary>The failure detail on error; null on success.</summary>
    public AuthError? Error { get; }

    private Result(bool isSuccess, AuthError? error)
    {
        IsSuccess = isSuccess;
        Error = error;
    }

    /// <summary>Creates a successful result.</summary>
    public static Result Ok() => new(true, null);

    /// <summary>Creates a failed result carrying <paramref name="error"/>.</summary>
    public static Result Fail(AuthError error) => new(false, error);
}
