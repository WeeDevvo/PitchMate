using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace PitchMate.Infrastructure.Data;

/// <summary>
/// Design-time factory for creating PitchMateDbContext instances.
/// Used by EF Core tools for migrations.
/// </summary>
public class PitchMateDbContextFactory : IDesignTimeDbContextFactory<PitchMateDbContext>
{
    public PitchMateDbContext CreateDbContext(string[] args)
    {
        var optionsBuilder = new DbContextOptionsBuilder<PitchMateDbContext>();
        
        // Use a placeholder connection string for design-time operations
        // In production, this will be configured via dependency injection
        optionsBuilder.UseNpgsql("Host=localhost;Database=pitchmate;Username=postgres;Password=postgres");
        
        return new PitchMateDbContext(optionsBuilder.Options);
    }
}
