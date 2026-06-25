using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using PitchMate.Application.Common;

namespace PitchMate.Infrastructure.Persistence.Scratch;

// TEMPORARY design-time factory so `dotnet ef migrations add` can construct the context
// (which now requires TimeProvider + ICurrentUserAccessor). DELETE after inspection.
public class ScratchDesignTimeFactory : IDesignTimeDbContextFactory<PitchMateDbContext>
{
    public PitchMateDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<PitchMateDbContext>()
            .UseNpgsql("Host=localhost;Database=scratch;Username=scratch;Password=scratch")
            .Options;

        return new PitchMateDbContext(options, TimeProvider.System, new ScratchUserAccessor());
    }

    private sealed class ScratchUserAccessor : ICurrentUserAccessor
    {
        public string? CurrentUserId => null;
    }
}
