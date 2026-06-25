using PitchMate.Domain.Common;

namespace PitchMate.Domain.Tests.Common;

/// <summary>
/// A concrete <see cref="BaseEntity"/> used to exercise <see cref="ChronologicalOrder"/>.
/// The caller-supplied identity constructor lets a test pin both the <see cref="BaseEntity.Id"/>
/// (a unique UUID version 7) and the <see cref="BaseEntity.CreatedAt"/> instant, so creation-time
/// collisions can be forced to drive the <see cref="UuidV7Comparer"/> tie-break path.
/// </summary>
public sealed class OrderingTestEntity : BaseEntity
{
    /// <summary>Creates an entity with an auto-generated UUID version 7 identity.</summary>
    public OrderingTestEntity()
    {
    }

    /// <summary>Creates an entity with the supplied identity (or an auto-generated one when empty).</summary>
    /// <param name="id">The caller-supplied identity, or <see cref="Guid.Empty"/> to auto-generate one.</param>
    public OrderingTestEntity(Guid id) : base(id)
    {
    }
}
