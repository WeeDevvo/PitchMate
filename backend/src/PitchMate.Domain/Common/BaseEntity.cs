namespace PitchMate.Domain.Common;

/// <summary>
/// The shared abstract base for every persisted PitchMate entity. Carries a
/// time-ordered GUID v7 primary key, audit metadata, and soft-delete state, and
/// implements identity-based equality.
/// <para>
/// Identity is assigned at construction: a caller-supplied non-empty id is retained
/// unchanged (supporting idempotent client-assigned writes), while an absent or
/// all-zero id is replaced with a freshly generated UUID version 7. The
/// <c>Id</c> setter is private so identity is fixed at construction or restored by
/// the persistence layer during materialisation.
/// </para>
/// </summary>
public abstract class BaseEntity : ISoftDeletable
{
    /// <summary>The primary-key identifier, a UUID version 7.</summary>
    public Guid Id { get; private set; }

    /// <summary>The UTC instant at which the entity was first persisted.</summary>
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>The UTC instant at which the entity was last persisted.</summary>
    public DateTimeOffset UpdatedAt { get; set; }

    /// <summary>The actor that first persisted the entity, or <see langword="null"/> for system operations.</summary>
    public string? CreatedBy { get; set; }

    /// <summary>The actor that last persisted the entity, or <see langword="null"/> for system operations.</summary>
    public string? UpdatedBy { get; set; }

    /// <inheritdoc />
    public bool IsDeleted { get; private set; }

    /// <inheritdoc />
    public DateTimeOffset? DeletedAt { get; private set; }

    /// <summary>
    /// Initialises a new entity with an auto-generated UUID version 7 identity.
    /// </summary>
    protected BaseEntity() : this(Guid.Empty)
    {
    }

    /// <summary>
    /// Initialises a new entity. When <paramref name="id"/> is the all-zero GUID, a
    /// fresh UUID version 7 is generated; otherwise the supplied id is retained
    /// unchanged.
    /// </summary>
    /// <param name="id">The caller-supplied identity, or <see cref="Guid.Empty"/> to auto-generate one.</param>
    protected BaseEntity(Guid id)
    {
        Id = id == Guid.Empty ? Guid.CreateVersion7() : id;
    }

    /// <summary>
    /// Marks the entity as soft-deleted, keeping the <see cref="DeletedAt"/> /
    /// <see cref="IsDeleted"/> invariant. Mediated so the persistence layer can apply
    /// soft-delete without exposing public setters.
    /// </summary>
    /// <param name="whenUtc">The UTC instant at which the entity was deleted.</param>
    internal void MarkDeleted(DateTimeOffset whenUtc)
    {
        IsDeleted = true;
        DeletedAt = whenUtc;
    }

    /// <summary>
    /// Restores a soft-deleted entity, clearing <see cref="DeletedAt"/> and keeping the
    /// <see cref="DeletedAt"/> / <see cref="IsDeleted"/> invariant.
    /// </summary>
    internal void Restore()
    {
        IsDeleted = false;
        DeletedAt = null;
    }

    /// <summary>
    /// Determines identity equality. Two entities are equal only when they are the same
    /// object reference, or they share the same runtime entity type and the same
    /// non-empty <see cref="Id"/>. An entity is never equal to <see langword="null"/>,
    /// and entities whose <see cref="Id"/> is the all-zero GUID are unequal unless they
    /// are the same reference.
    /// </summary>
    public override bool Equals(object? obj)
    {
        if (ReferenceEquals(this, obj))
        {
            return true;
        }

        return obj is BaseEntity other
            && GetType() == other.GetType()
            && Id != Guid.Empty
            && other.Id != Guid.Empty
            && Id == other.Id;
    }

    /// <summary>
    /// Returns a hash code derived solely from <see cref="Id"/>, so that any two
    /// entities deemed equal yield the same hash value.
    /// </summary>
    public override int GetHashCode() => Id.GetHashCode();
}
