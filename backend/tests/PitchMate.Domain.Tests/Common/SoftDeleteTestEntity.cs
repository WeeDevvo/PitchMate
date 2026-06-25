using PitchMate.Domain.Common;

namespace PitchMate.Domain.Tests.Common;

/// <summary>
/// A concrete <see cref="BaseEntity"/> used to exercise the soft-delete state transitions
/// (<see cref="BaseEntity.MarkDeleted(System.DateTimeOffset)"/> and
/// <see cref="BaseEntity.Restore"/>) and the <c>DeletedAt</c>/<c>IsDeleted</c> invariant.
/// The base mediators are <c>internal</c> to the Domain assembly and reachable from this
/// test assembly via the Domain project's <c>InternalsVisibleTo</c> declaration.
/// </summary>
public sealed class SoftDeleteTestEntity : BaseEntity
{
    /// <summary>Creates an entity with an auto-generated UUID version 7 identity.</summary>
    public SoftDeleteTestEntity()
    {
    }

    /// <summary>Creates an entity with the supplied identity (or an auto-generated one when empty).</summary>
    /// <param name="id">The caller-supplied identity, or <see cref="System.Guid.Empty"/> to auto-generate one.</param>
    public SoftDeleteTestEntity(Guid id) : base(id)
    {
    }
}
