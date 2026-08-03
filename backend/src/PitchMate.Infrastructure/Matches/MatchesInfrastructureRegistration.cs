using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Infrastructure.Matches.Repositories;

namespace PitchMate.Infrastructure.Matches;

/// <summary>
/// Registers the Infrastructure implementations of the Application match-lifecycle abstractions
/// (Requirements 16.3, 16.4). This lives in Infrastructure because the EF Core repositories
/// (<see cref="EfMatchRepository"/>, <see cref="EfAvailabilityRepository"/>,
/// <see cref="EfMembershipRatingRepository"/>) are <c>internal</c> to the assembly and cannot be
/// referenced from the Api; keeping the wiring here lets every match abstraction the lifecycle use
/// cases depend on resolve to a concrete implementation, and a missing one fails startup.
/// <para>
/// Unlike <c>AddSquadsInfrastructure</c> / <c>AddNotificationsInfrastructure</c> — which the Api's
/// composition roots invoke — this method is invoked directly by
/// <see cref="DependencyInjection.AddInfrastructure"/> so the match repositories, the
/// <see cref="ITeamBalancer"/>, and the <see cref="ISillyNameGenerator"/> resolve at startup without
/// any additional Api-side wiring (Requirement 16.4).
/// <see cref="ServiceCollectionDescriptorExtensions.TryAdd(IServiceCollection, ServiceDescriptor)"/>
/// variants are used so a test host can substitute a fake before calling this.
/// </para>
/// </summary>
public static class MatchesInfrastructureRegistration
{
    /// <summary>
    /// Registers the EF Core match/availability/rating repositories, the team balancer, and the silly
    /// name generator behind their Application abstractions.
    /// </summary>
    /// <param name="services">The service collection to add registrations to.</param>
    /// <returns>The same <paramref name="services"/> for chaining.</returns>
    public static IServiceCollection AddMatchesInfrastructure(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // EF Core match-lifecycle repositories — scoped so they share the request scope's DbContext and
        // take part in the same unit-of-work transaction (Requirement 16.3).
        services.TryAddScoped<IMatchRepository, EfMatchRepository>();
        services.TryAddScoped<IAvailabilityRepository, EfAvailabilityRepository>();
        services.TryAddScoped<IMembershipRatingRepository, EfMembershipRatingRepository>();

        // The balancer holds no mutable state — it scores splits solely through the singleton
        // IRatingEngine's pure Predict primitive — so a single shared instance is safe as a singleton
        // (Requirement 16.4).
        services.TryAddSingleton<ITeamBalancer, TeamBalancer>();

        // Silly name generation is stateless and thread-safe (it draws from fixed word lists via
        // Random.Shared), so a single shared instance is safe as a singleton (Requirement 16.4).
        services.TryAddSingleton<ISillyNameGenerator, SillyNameGenerator>();

        return services;
    }
}
