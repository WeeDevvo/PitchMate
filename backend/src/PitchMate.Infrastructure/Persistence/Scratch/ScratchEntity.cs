using PitchMate.Domain.Common;

namespace PitchMate.Infrastructure.Persistence.Scratch;

// TEMPORARY scratch entity used only to generate a throwaway migration and inspect
// how the xmin concurrency token is rendered. DELETE after inspection.
public class ScratchEntity : BaseEntity
{
    public string Name { get; set; } = string.Empty;
}
