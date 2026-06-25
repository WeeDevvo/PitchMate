namespace PitchMate.Application.Common.Persistence;

/// <summary>
/// Thrown when a save is rejected because a row with the same primary key
/// (client-assigned <c>Entity_Id</c>) already exists.
/// </summary>
/// <remarks>
/// This is a distinct, identifiable type so calling use cases can implement
/// idempotent dedupe-by-Id behaviour, separable from
/// <see cref="ConcurrencyConflictException"/> and all other persistence errors.
/// Infrastructure wraps the underlying provider exception (e.g. PostgreSQL
/// SQLSTATE <c>23505</c>) as the inner exception.
/// Validates: Requirements 9.2, 9.3.
/// </remarks>
public sealed class DuplicateKeyException : Exception
{
    public DuplicateKeyException()
        : base("A row with the same primary key already exists.")
    {
    }

    public DuplicateKeyException(string message)
        : base(message)
    {
    }

    public DuplicateKeyException(Exception innerException)
        : base("A row with the same primary key already exists.", innerException)
    {
    }

    public DuplicateKeyException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
