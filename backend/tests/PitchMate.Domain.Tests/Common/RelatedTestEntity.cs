using PitchMate.Domain.Common;

namespace PitchMate.Domain.Tests.Common;

/// <summary>
/// A concrete <see cref="BaseEntity"/> used purely as a relationship/navigation target for
/// <see cref="AnonymisableTestEntity"/>. The anonymisation property tests hold references to
/// instances of this type so they can assert that <see cref="IAnonymisable.Anonymise"/> leaves
/// an entity's relationships (a single reference and a collection) untouched.
/// </summary>
public sealed class RelatedTestEntity : BaseEntity
{
    /// <summary>Creates an entity with an auto-generated UUID version 7 identity.</summary>
    public RelatedTestEntity()
    {
    }

    /// <summary>Creates an entity with the supplied identity (or an auto-generated one when empty).</summary>
    /// <param name="id">The caller-supplied identity, or <see cref="Guid.Empty"/> to auto-generate one.</param>
    public RelatedTestEntity(Guid id) : base(id)
    {
    }
}
