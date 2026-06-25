using PitchMate.Domain.Common;

namespace PitchMate.Domain.Tests.Common;

/// <summary>
/// A second, distinct concrete <see cref="BaseEntity"/> subtype used to verify cross-type
/// inequality: two entities of different runtime types are never equal even when they
/// carry the same <see cref="BaseEntity.Id"/>.
/// </summary>
public sealed class OtherIdentityTestEntity : BaseEntity
{
    /// <summary>Creates an entity with an auto-generated UUID version 7 identity.</summary>
    public OtherIdentityTestEntity()
    {
    }

    /// <summary>Creates an entity with the supplied identity (or an auto-generated one when empty).</summary>
    /// <param name="id">The caller-supplied identity, or <see cref="Guid.Empty"/> to auto-generate one.</param>
    public OtherIdentityTestEntity(Guid id) : base(id)
    {
    }
}
