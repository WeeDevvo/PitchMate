using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using PitchMate.Application.Stats;

namespace PitchMate.Infrastructure.Stats;

/// <summary>
/// Registers the Infrastructure implementations of the Application stats abstractions
/// (Requirement 2.5, 15.3). This lives in Infrastructure because <see cref="EfStatsRepository"/> is
/// <c>internal</c> to the assembly and cannot be referenced from the Api; keeping the wiring here lets
/// every stats abstraction the read use cases depend on resolve to a concrete implementation, and a
/// missing one fails startup.
/// <para>
/// Like <c>AddMatchesInfrastructure</c>, this method is invoked directly by
/// <see cref="DependencyInjection.AddInfrastructure"/> so the stats repository and its parameter/rich
/// sources resolve at startup without any additional Api-side wiring. It is registered after the
/// rating engine because <see cref="EfStatsRepository"/> depends on the singleton
/// <see cref="Domain.Rating.IRatingEngine"/> (and on <see cref="IDisplayRatingParametersSource"/>) to
/// derive the <c>Display_Rating</c> leaderboard.
/// <see cref="ServiceCollectionDescriptorExtensions.TryAdd(IServiceCollection, ServiceDescriptor)"/>
/// variants are used so a test host can substitute a fake before calling this.
/// </para>
/// </summary>
public static class StatsInfrastructureRegistration
{
    /// <summary>
    /// Registers the EF Core stats repository, the display-rating parameter source, and the MVP
    /// empty rich-stats source behind their Application abstractions.
    /// </summary>
    /// <param name="services">The service collection to add registrations to.</param>
    /// <returns>The same <paramref name="services"/> for chaining.</returns>
    public static IServiceCollection AddStatsInfrastructure(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // EF Core stats repository — scoped so it shares the request scope's DbContext and reads the
        // squad-scoped, Completed-only aggregation from the same context (Requirement 2.5).
        services.TryAddScoped<IStatsRepository, EfStatsRepository>();

        // The display-rating parameter source is stateless — it returns the MVP defaults for every
        // squad — so a single shared instance is safe as a singleton (Requirement 7.5).
        services.TryAddSingleton<IDisplayRatingParametersSource, SquadDisplayRatingParametersSource>();

        // The MVP rich-stats source is stateless — it reports "no data" for every membership until the
        // live-tracking spec replaces this registration — so a singleton is safe (Requirement 13.2).
        services.TryAddSingleton<IRichStatsSource, EmptyRichStatsSource>();

        return services;
    }
}
