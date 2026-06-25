using PitchMate.Domain.Common;

namespace PitchMate.Infrastructure.Tests.Persistence;

/// <summary>
/// A concrete <see cref="BaseEntity"/>-derived entity used purely as the navigation target
/// of <see cref="PersistenceTestEntity"/>. It exists solely to give the persistence harness a
/// real foreign-key relationship to exercise (so tests can assert that anonymisation and the
/// other save-time conventions leave relationships intact, and that the schema maps a
/// navigation correctly). The persistence-foundation defines no concrete domain entities of
/// its own — this type lives only in the test project.
/// </summary>
public sealed class PersistenceTestRelatedEntity : BaseEntity
{
    /// <summary>A representative non-identity member on the related entity.</summary>
    public string Label { get; set; } = string.Empty;

    /// <summary>Creates an entity with an auto-generated UUID version 7 identity.</summary>
    public PersistenceTestRelatedEntity()
    {
    }

    /// <summary>Creates an entity with the supplied identity (or an auto-generated one when empty).</summary>
    /// <param name="id">The caller-supplied identity, or <see cref="Guid.Empty"/> to auto-generate one.</param>
    public PersistenceTestRelatedEntity(Guid id) : base(id)
    {
    }
}
