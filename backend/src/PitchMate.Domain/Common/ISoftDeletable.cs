namespace PitchMate.Domain.Common;

/// <summary>
/// Marks an entity that participates in soft-delete behaviour. Rather than removing
/// its row from the database, a soft-deletable entity is flagged as deleted so that
/// history required for integrity and rating replay is retained.
/// </summary>
public interface ISoftDeletable
{
    /// <summary>
    /// Whether the entity is currently soft-deleted. <see langword="true"/> when the
    /// entity has been marked deleted; <see langword="false"/> when it is active.
    /// </summary>
    bool IsDeleted { get; }

    /// <summary>
    /// The UTC instant at which the entity was soft-deleted, or <see langword="null"/>
    /// when the entity is not deleted. Holds a value if and only if
    /// <see cref="IsDeleted"/> is <see langword="true"/>.
    /// </summary>
    DateTimeOffset? DeletedAt { get; }
}
