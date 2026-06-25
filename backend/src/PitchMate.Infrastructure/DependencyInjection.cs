using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using PitchMate.Application.Common;
using PitchMate.Application.Common.Persistence;
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

        // Registered as scoped by AddDbContext, so the repository and unit-of-work in a scope
        // share one context (Req 7.4). snake_case maps PascalCase names to snake_case tables/
        // columns centrally (Req 8.2). No Migrate()/EnsureCreated() runs here — migrations are an
        // explicit out-of-process deploy step (Req 12.2).
        services.AddDbContext<PitchMateDbContext>(options =>
            options.UseNpgsql(connectionString)
                   .UseSnakeCaseNamingConvention());

        // Persistence abstractions resolve to the EF Core implementations, scoped to share the
        // context within a request scope (Req 7.2, 7.3).
        services.AddScoped<IUnitOfWork, UnitOfWork>();
        services.AddScoped(typeof(IRepository<>), typeof(EfRepository<>));

        // Clock used for audit stamping. Try* so a host/test can substitute a controllable clock.
        services.TryAddSingleton(TimeProvider.System);

        // Safe default actor accessor (reports no user) so the DbContext is resolvable and DI
        // validation passes at startup (Req 7.6). The Api/auth layer overrides this with a
        // request-scoped accessor via its own registration (Try* keeps that override winning only
        // if registered first; the Api registers before AddInfrastructure or replaces explicitly).
        services.TryAddScoped<ICurrentUserAccessor, SystemCurrentUserAccessor>();

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
