using PitchMate.Application.LiveTracking.UseCases;

namespace PitchMate.Api.LiveTracking;

/// <summary>
/// The live-tracking composition root (<c>AddLiveTracking</c>). It registers the Application
/// live-tracking use-case handlers — <see cref="RecordEventBatchHandler"/>,
/// <see cref="FinaliseTrackedResultHandler"/>, and <see cref="GetRunningScoreHandler"/> — so every
/// endpoint in <c>LiveTrackingEndpoints</c> can resolve its handler (Requirement 14.4).
/// <para>
/// Like <c>AddMatches</c> and <c>AddStats</c>, this root wires no Infrastructure implementations: the
/// <c>IMatchEventRepository</c> implementation (<c>EfMatchEventRepository</c>) and the event-log-backed
/// <c>IRichStatsSource</c> (<c>EventLogRichStatsSource</c>) are registered directly by
/// <c>AddInfrastructure</c> (via <c>AddLiveTrackingInfrastructure</c>) because they are
/// <c>internal</c> to the Infrastructure assembly and cannot be referenced from the Api. This root
/// therefore only registers the Application handlers, which the Api may reference. It expects
/// <c>AddInfrastructure</c> to have registered the shared persistence services (the DbContext, unit of
/// work, and <see cref="TimeProvider"/>) and the match-lifecycle services the finalise handler builds
/// on, and <c>AddSquads</c> to have registered the squad repositories the handlers read for
/// authorisation.
/// </para>
/// </summary>
public static class LiveTrackingServiceCollectionExtensions
{
    /// <summary>
    /// Registers the Application live-tracking use-case handlers.
    /// </summary>
    /// <param name="services">The service collection to add registrations to.</param>
    /// <returns>The same <paramref name="services"/> for chaining.</returns>
    public static IServiceCollection AddLiveTracking(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // Handlers are scoped so they share the request scope's DbContext and unit of work.
        services.AddScoped<RecordEventBatchHandler>();
        services.AddScoped<FinaliseTrackedResultHandler>();
        services.AddScoped<GetRunningScoreHandler>();

        return services;
    }
}
