using Microsoft.EntityFrameworkCore;

namespace PitchMate.Infrastructure.Data;

/// <summary>
/// Seeds initial configuration data into the database.
/// </summary>
public static class DatabaseSeeder
{
    /// <summary>
    /// Seeds the database with initial configuration values.
    /// </summary>
    public static async Task SeedAsync(PitchMateDbContext context)
    {
        // Ensure database is created
        await context.Database.EnsureCreatedAsync();

        // Check if configuration already exists
        var hasConfig = await context.SystemConfigurations.AnyAsync();
        if (hasConfig)
        {
            // Already seeded
            return;
        }

        // Seed default configuration values
        var configurations = new[]
        {
            new SystemConfiguration
            {
                Key = "default_elo_rating",
                Value = "1000",
                UpdatedAt = DateTime.UtcNow
            },
            new SystemConfiguration
            {
                Key = "k_factor",
                Value = "32",
                UpdatedAt = DateTime.UtcNow
            },
            new SystemConfiguration
            {
                Key = "default_team_size",
                Value = "5",
                UpdatedAt = DateTime.UtcNow
            }
        };

        await context.SystemConfigurations.AddRangeAsync(configurations);
        await context.SaveChangesAsync();
    }
}
