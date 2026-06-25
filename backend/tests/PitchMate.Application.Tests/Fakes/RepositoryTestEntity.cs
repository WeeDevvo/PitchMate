using PitchMate.Domain.Common;

namespace PitchMate.Application.Tests.Fakes;

/// <summary>
/// A concrete <see cref="BaseEntity"/>-derived entity used to parameterise the in-memory
/// <see cref="InMemoryRepository{T}"/> when exercising the Application-layer repository
/// abstraction. It carries a representative non-identity member (<see cref="Name"/>) so the
/// fake stores something more than bare identity, but the persistence-foundation defines no
/// concrete entities of its own — this type exists solely for the tests.
/// </summary>
public sealed class RepositoryTestEntity : BaseEntity
{
    /// <summary>Creates an entity with an auto-generated UUID version 7 identity.</summary>
    public RepositoryTestEntity()
    {
    }

    /// <summary>Creates an entity with the supplied identity (or an auto-generated one when empty).</summary>
    /// <param name="id">The caller-supplied identity, or <see cref="Guid.Empty"/> to auto-generate one.</param>
    public RepositoryTestEntity(Guid id) : base(id)
    {
    }

    /// <summary>A representative non-identity member.</summary>
    public string? Name { get; set; }
}
