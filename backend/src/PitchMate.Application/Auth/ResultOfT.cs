namespace PitchMate.Application.Auth;

/// <summary>
/// The outcome of a fallible authentication/identity use case. A success carries a <typeparamref name="T"/>
/// value; a failure carries an <see cref="AuthError"/>. Use cases never throw for expected validation or
/// authentication failures. Mirrors the established discriminated-result style of
/// <see cref="PitchMate.Domain.Rating.Result{T}"/> while carrying an <see cref="AuthError"/>.
/// </summary>
/// <typeparam name="T">The value type produced on success.</typeparam>
public readonly record struct Result<T>
{
    /// <summary>True when the operation succeeded and <see cref="Value"/> is populated.</summary>
    public bool IsSuccess { get; }

    /// <summary>The produced value on success; default/null on failure.</summary>
    public T? Value { get; }

    /// <summary>The failure detail on error; null on success.</summary>
    public AuthError? Error { get; }

    private Result(bool isSuccess, T? value, AuthError? error)
    {
        IsSuccess = isSuccess;
        Value = value;
        Error = error;
    }

    /// <summary>Creates a successful result carrying <paramref name="value"/>.</summary>
    public static Result<T> Ok(T value) => new(true, value, null);

    /// <summary>Creates a failed result carrying <paramref name="error"/>.</summary>
    public static Result<T> Fail(AuthError error) => new(false, default, error);
}
