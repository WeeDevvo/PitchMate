using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace PitchMate.Infrastructure.Tests.Persistence;

/// <summary>
/// Test-only <see cref="IEntityTypeConfiguration{TEntity}"/> for
/// <see cref="PersistenceTestRelatedEntity"/>, the navigation target of
/// <see cref="PersistenceTestEntity"/>. Discovered by <see cref="PersistenceTestDbContext"/> via
/// <c>ApplyConfigurationsFromAssembly</c>; the shared <c>BaseEntity</c> conventions are applied
/// afterwards by the base context.
/// </summary>
public sealed class PersistenceTestRelatedEntityConfiguration
    : IEntityTypeConfiguration<PersistenceTestRelatedEntity>
{
    /// <inheritdoc />
    public void Configure(EntityTypeBuilder<PersistenceTestRelatedEntity> builder)
    {
        builder.ToTable("persistence_test_related_entities");
        builder.Property(e => e.Label);
    }
}
