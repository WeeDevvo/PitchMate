namespace PitchMate.Application.Common.Persistence;

/// <summary>
/// Thrown when a save detects that a row was modified by another operation
/// since the entity was loaded (optimistic-concurrency conflict).
/// </summary>
/// <remarks>
/// Distinct from <see cref="DuplicateKeyException"/> and all other persistence
/// errors. Infrastructure wraps the underlying provider concurrency exception
/// as the inner exception.
/// Validates: Requirements 8.7.
/// </remarks>
public sealed class ConcurrencyConflictException : Exception
{
    public ConcurrencyConflictException()
        : base("The row was modified by another operation since it was loaded.")
    {
    }

    public ConcurrencyConflictException(string message)
        : base(message)
    {
    }

    public ConcurrencyConflictException(Exception innerException)
        : base("The row was modified by another operation since it was loaded.", innerException)
    {
    }

    public ConcurrencyConflictException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
