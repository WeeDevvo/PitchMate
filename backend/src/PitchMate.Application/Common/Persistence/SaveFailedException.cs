namespace PitchMate.Application.Common.Persistence;

/// <summary>
/// Thrown when a save fails to commit for reasons other than a duplicate key
/// or a concurrency conflict. Indicates that the save did not commit and no
/// partial change was persisted.
/// </summary>
/// <remarks>
/// Distinct from <see cref="DuplicateKeyException"/> and
/// <see cref="ConcurrencyConflictException"/>. Infrastructure wraps the
/// underlying provider exception as the inner exception. Cancellation surfaces
/// as the standard <see cref="OperationCanceledException"/>, not this type.
/// Validates: Requirements 6.3.
/// </remarks>
public sealed class SaveFailedException : Exception
{
    public SaveFailedException()
        : base("The save failed to commit.")
    {
    }

    public SaveFailedException(string message)
        : base(message)
    {
    }

    public SaveFailedException(Exception innerException)
        : base("The save failed to commit.", innerException)
    {
    }

    public SaveFailedException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
