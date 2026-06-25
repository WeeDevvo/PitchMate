using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace PitchMate.Infrastructure.Tests.Persistence;

/// <summary>
/// Test-only <see cref="IEntityTypeConfiguration{TEntity}"/> for <see cref="PersistenceTestEntity"/>.
/// It is discovered by <see cref="PersistenceTestDbContext"/> via
/// <c>ApplyConfigurationsFromAssembly</c>, exactly as a real per-entity configuration would be in
/// the Infrastructure assembly. It maps the entity's PII / non-PII members and its optional
/// navigation; the shared <c>BaseEntity</c> conventions (uuid primary key, xmin concurrency token,
/// soft-delete query filter, audit columns) are layered on afterwards by the base context.
/// </summary>
public sealed class PersistenceTestEntityConfiguration : IEntityTypeConfiguration<PersistenceTestEntity>
{
    /// <inheritdoc />
    public void Configure(EntityTypeBuilder<PersistenceTestEntity> builder)
    {
        builder.ToTable("persistence_test_entities");

        builder.Property(e => e.DisplayName).IsRequired();
        builder.Property(e => e.Email);
        builder.Property(e => e.AvatarUrl);
        builder.Property(e => e.SkillTier);
        builder.Property(e => e.BibCount);

        // Optional reference navigation with an explicit foreign key, giving the harness a real
        // relationship to exercise. Restrict on delete so the relationship survives soft-deletes.
        builder.HasOne(e => e.Related)
            .WithMany()
            .HasForeignKey(e => e.RelatedId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
