using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;

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
        
        // Build configuration to read from appsettings.json, user secrets, and environment variables
        var configuration = new ConfigurationBuilder()
            .SetBasePath(Directory.GetCurrentDirectory())
            .AddJsonFile("appsettings.json", optional: true)
            .AddUserSecrets<PitchMateDbContextFactory>(optional: true)
            .AddEnvironmentVariables()
            .Build();
        
        var connectionString = configuration.GetConnectionString("DefaultConnection")
            ?? "Host=localhost;Database=pitchmate;Username=postgres;Password=postgres";
        
        optionsBuilder.UseNpgsql(connectionString);
        
        return new PitchMateDbContext(optionsBuilder.Options);
    }
}
