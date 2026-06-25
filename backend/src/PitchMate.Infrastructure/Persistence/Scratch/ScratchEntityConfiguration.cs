using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace PitchMate.Infrastructure.Persistence.Scratch;

// TEMPORARY scratch configuration so the model contains at least one entity for the
// throwaway migration. DELETE after inspection.
public class ScratchEntityConfiguration : IEntityTypeConfiguration<ScratchEntity>
{
    public void Configure(EntityTypeBuilder<ScratchEntity> builder)
    {
        builder.ToTable("scratch_entities");
        builder.Property(e => e.Name);
    }
}
