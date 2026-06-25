using PitchMate.Domain.Common;

namespace PitchMate.Domain.Tests.Common;

/// <summary>
/// A concrete <see cref="BaseEntity"/> used to exercise the abstract base's identity,
/// equality, and hashing behaviour. Exposes the protected constructors publicly so the
/// property tests can drive both the auto-generate and caller-supplied identity paths.
/// </summary>
public sealed class IdentityTestEntity : BaseEntity
{
    /// <summary>Creates an entity with an auto-generated UUID version 7 identity.</summary>
    public IdentityTestEntity()
    {
    }

    /// <summary>Creates an entity with the supplied identity (or an auto-generated one when empty).</summary>
    /// <param name="id">The caller-supplied identity, or <see cref="Guid.Empty"/> to auto-generate one.</param>
    public IdentityTestEntity(Guid id) : base(id)
    {
    }
}
