using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using PitchMate.Application.LiveTracking;
using PitchMate.Application.Stats;

namespace PitchMate.Infrastructure.LiveTracking;

/// <summary>
/// Registers the Infrastructure implementations of the live-tracking abstractions and replaces the
/// MVP no-data rich-stats source with the real, event-log-backed one (Requirement 14.3). This lives in
/// Infrastructure because <see cref="EfMatchEventRepository"/> and <see cref="EventLogRichStatsSource"/>
/// are <c>internal</c> to the assembly and cannot be referenced from the Api; keeping the wiring here
/// lets every live-tracking abstraction the use cases depend on resolve to a concrete implementation.
/// <para>
/// Like <c>AddMatchesInfrastructure</c> and <c>AddStatsInfrastructure</c>, this method is invoked
/// directly by <see cref="DependencyInjection.AddInfrastructure"/> — <b>after</b>
/// <see cref="StatsInfrastructureRegistration.AddStatsInfrastructure"/> — so the event repository
/// resolves at startup and the <see cref="IRichStatsSource"/> override takes effect. Because the stats
/// registration seeds <c>EmptyRichStatsSource</c> with a <c>TryAdd</c>, a further <c>TryAdd</c> here
/// would be a no-op; the override therefore uses
/// <see cref="ServiceCollectionDescriptorExtensions.Replace(IServiceCollection, ServiceDescriptor)"/>,
/// which removes the existing <see cref="IRichStatsSource"/> descriptor and registers
/// <see cref="EventLogRichStatsSource"/> in its place. This guarantees <see cref="EventLogRichStatsSource"/>
/// is the one resolved regardless of registration order (Requirement 14.3).
/// </para>
/// </summary>
public static class LiveTrackingInfrastructureRegistration
{
    /// <summary>
    /// Registers the EF Core match-event repository and overrides the rich-stats source so the
    /// event-log-backed <see cref="EventLogRichStatsSource"/> is resolved in place of the MVP
    /// <c>EmptyRichStatsSource</c>.
    /// </summary>
    /// <param name="services">The service collection to add registrations to.</param>
    /// <returns>The same <paramref name="services"/> for chaining.</returns>
    public static IServiceCollection AddLiveTrackingInfrastructure(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // EF Core append-only event-log repository — scoped so it shares the request scope's DbContext
        // and takes part in the same unit-of-work transaction as the recording/finalising use cases
        // (Requirement 14.2, 14.3).
        services.TryAddScoped<IMatchEventRepository, EfMatchEventRepository>();

        // Override the MVP no-data rich-stats source (registered by AddStatsInfrastructure as
        // EmptyRichStatsSource) with the real event-log-backed implementation. Replace — not TryAdd —
        // is required because the stats registration already seeded the descriptor; Replace removes it
        // and installs EventLogRichStatsSource so it is the one resolved (Requirement 14.3). Scoped
        // because it depends on the scoped ISquadRepository and IMatchEventRepository.
        services.Replace(ServiceDescriptor.Scoped<IRichStatsSource, EventLogRichStatsSource>());

        return services;
    }
}
