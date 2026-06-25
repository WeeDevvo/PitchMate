namespace PitchMate.Application.Common.Persistence;

/// <summary>
/// Thrown when an entity is submitted for persistence with an absent or
/// all-zero default <c>Entity_Id</c>. The operation is rejected before any I/O
/// and the entity is not persisted.
/// </summary>
/// <remarks>
/// Distinct from all other persistence errors.
/// Validates: Requirements 9.4.
/// </remarks>
public sealed class InvalidEntityIdException : Exception
{
    public InvalidEntityIdException()
        : base("An entity was submitted for persistence with an absent or all-zero identifier.")
    {
    }

    public InvalidEntityIdException(string message)
        : base(message)
    {
    }

    public InvalidEntityIdException(Exception innerException)
        : base("An entity was submitted for persistence with an absent or all-zero identifier.", innerException)
    {
    }

    public InvalidEntityIdException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
