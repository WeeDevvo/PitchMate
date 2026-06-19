using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure;

/// <summary>
/// Registers Infrastructure services (EF Core / Npgsql, and later the rating engine,
/// auth token verification, file storage). This is the only place the Api wires into Infrastructure.
/// </summary>
public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, string connectionString)
    {
        services.AddDbContext<PitchMateDbContext>(options =>
            options.UseNpgsql(connectionString));

        return services;
    }
}
