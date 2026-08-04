using PitchMate.Application.Stats;

namespace PitchMate.Api.Stats;

/// <summary>
/// The stats composition root (<c>AddStats</c>). It registers the Application stats read use-case
/// handlers — <see cref="GetLeaderboardHandler"/> and <see cref="GetPlayerProfileHandler"/> — so every
/// endpoint in <c>StatsEndpoints</c> can resolve its handler (Requirement 15.4).
/// <para>
/// Like <c>AddMatches</c>, this root wires no Infrastructure implementations: the
/// <c>IStatsRepository</c>, <c>IDisplayRatingParametersSource</c>, and <c>IRichStatsSource</c>
/// implementations are registered directly by <c>AddInfrastructure</c> (via
/// <c>AddStatsInfrastructure</c>) because they are internal to the Infrastructure assembly. This root
/// therefore only registers the Application handlers, which the Api may reference. It expects
/// <c>AddInfrastructure</c> to have registered the shared persistence services (the DbContext and unit
/// of work), the rating engine, and the stats abstractions the handlers depend on, and <c>AddSquads</c>
/// to have registered the squad repositories the handlers read for authorisation.
/// </para>
/// </summary>
public static class StatsServiceCollectionExtensions
{
    /// <summary>
    /// Registers the Application stats read use-case handlers.
    /// </summary>
    /// <param name="services">The service collection to add registrations to.</param>
    /// <returns>The same <paramref name="services"/> for chaining.</returns>
    public static IServiceCollection AddStats(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // Handlers are scoped so they share the request scope's DbContext.
        services.AddScoped<GetLeaderboardHandler>();
        services.AddScoped<GetPlayerProfileHandler>();

        return services;
    }
}
