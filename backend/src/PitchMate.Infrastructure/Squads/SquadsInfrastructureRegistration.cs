using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Infrastructure.Squads.Repositories;

namespace PitchMate.Infrastructure.Squads;

/// <summary>
/// Registers the Infrastructure implementations of the Application squad abstractions
/// (Requirement 19.3, 19.4). This lives in Infrastructure because the EF Core repositories are
/// <c>internal</c> to the assembly and cannot be referenced from the Api; the Api's
/// <c>AddSquads</c> composition root calls this so every abstraction the squad use cases depend
/// on resolves to a concrete implementation, and a missing one fails startup.
/// <para>
/// The use-case handler registrations and the <c>Squads:Invites</c> options binding live in the
/// Api's <c>AddSquads</c>; this method only wires the Infrastructure side, mirroring the auth
/// layer's <c>AddAuthInfrastructure</c>. <see cref="ServiceCollectionDescriptorExtensions.TryAdd(IServiceCollection, ServiceDescriptor)"/>
/// variants are used so a test host can substitute a fake (for example a real
/// <see cref="IMembershipHistoryProbe"/> once the match-lifecycle spec exists) before calling this.
/// </para>
/// </summary>
public static class SquadsInfrastructureRegistration
{
    /// <summary>
    /// Registers the EF Core squad repositories, the invite secret service, and the conservative
    /// membership-history probe behind their Application abstractions.
    /// </summary>
    /// <param name="services">The service collection to add registrations to.</param>
    /// <returns>The same <paramref name="services"/> for chaining.</returns>
    public static IServiceCollection AddSquadsInfrastructure(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // EF Core squad repositories — scoped so they share the request scope's DbContext and take
        // part in the same unit-of-work transaction (Requirement 19.3).
        services.TryAddScoped<ISquadRepository, EfSquadRepository>();
        services.TryAddScoped<ISquadMembershipRepository, EfSquadMembershipRepository>();
        services.TryAddScoped<IInviteRepository, EfInviteRepository>();
        services.TryAddScoped<IGuestClaimRepository, EfGuestClaimRepository>();

        // Invite secret generation/hashing is stateless and thread-safe, so a single shared
        // instance is safe as a singleton (Requirement 10.7).
        services.TryAddSingleton<IInviteSecretService, InviteSecretService>();

        // Conservative default until the match-lifecycle spec introduces the match tables this probe
        // would query; it reports no match history so erasure hard-removes rather than anonymising
        // (Requirement 18.2). Stateless, so a singleton is safe.
        services.TryAddSingleton<IMembershipHistoryProbe, NoMatchHistoryProbe>();

        return services;
    }
}
