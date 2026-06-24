using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure;

/// <summary>
/// Registers Infrastructure services (EF Core / Npgsql, the rating engine, and later
/// auth token verification and file storage). This is the only place the Api wires into Infrastructure.
/// </summary>
public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("Default")
            ?? throw new InvalidOperationException("Connection string 'Default' is not configured.");

        services.AddDbContext<PitchMateDbContext>(options =>
            options.UseNpgsql(connectionString));

        AddRatingEngine(services, configuration);

        return services;
    }

    /// <summary>
    /// Binds the rating-engine model parameters from the optional "RatingEngine" configuration section
    /// and registers the PlackettLuce engine. Any value omitted from the section falls back to the
    /// documented <see cref="RatingEngineConfig"/> default, so an absent section yields a fully-defaulted,
    /// valid configuration. The engine holds no mutable state and validates its configuration once at
    /// construction, so a single shared instance is registered as a singleton (Requirements 11.1, 13.3).
    /// </summary>
    private static void AddRatingEngine(IServiceCollection services, IConfiguration configuration)
    {
        var ratingEngineConfig =
            configuration.GetSection("RatingEngine").Get<RatingEngineConfig>()
            ?? new RatingEngineConfig();

        services.AddSingleton(ratingEngineConfig);
        services.AddSingleton<IRatingEngine, PlackettLuceRatingEngine>();
    }
}
