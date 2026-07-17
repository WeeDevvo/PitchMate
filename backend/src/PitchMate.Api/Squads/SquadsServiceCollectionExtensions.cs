using PitchMate.Application.Squads.UseCases;
using PitchMate.Infrastructure.Squads;

namespace PitchMate.Api.Squads;

/// <summary>
/// The squads composition root (<c>AddSquads</c>). It binds the <c>Squads:Invites</c> options,
/// registers the Application use-case handlers, and wires the Infrastructure implementations behind
/// the Application abstractions via <see cref="SquadsInfrastructureRegistration.AddSquadsInfrastructure"/>
/// (Requirement 19.4).
/// <para>
/// This is the only squad wiring in the Api; the Api holds no squad logic itself. It expects
/// <c>AddInfrastructure</c> to have registered the shared persistence services (the DbContext, unit
/// of work, and <see cref="TimeProvider"/>) and <c>AddAuth</c> to have registered the auth
/// repositories (notably <c>IUserRepository</c>) that the squad handlers build on.
/// </para>
/// </summary>
public static class SquadsServiceCollectionExtensions
{
    /// <summary>
    /// Registers the squad invite options, the Application use-case handlers, and the Infrastructure
    /// implementations of the squad abstractions.
    /// </summary>
    /// <param name="services">The service collection to add registrations to.</param>
    /// <param name="configuration">The application configuration to bind the <c>Squads:Invites</c> section from.</param>
    /// <returns>The same <paramref name="services"/> for chaining.</returns>
    public static IServiceCollection AddSquads(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        AddInviteOptions(services, configuration);
        AddUseCases(services);
        services.AddSquadsInfrastructure();

        return services;
    }

    /// <summary>
    /// Binds the invite-generation options from the <c>Squads:Invites</c> section and exposes the
    /// bound value as its plain type, since <see cref="GenerateInviteHandler"/> consumes
    /// <see cref="InviteOptions"/> directly rather than <c>IOptions&lt;T&gt;</c> (Requirement 10.3).
    /// </summary>
    private static void AddInviteOptions(IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<InviteOptions>()
            .Bind(configuration.GetSection(InviteOptions.SectionName));

        services.AddSingleton(sp =>
            sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<InviteOptions>>().Value);
    }

    /// <summary>
    /// Registers the Application squad use-case handlers. Handlers are scoped so they share the
    /// request scope's DbContext and unit of work.
    /// </summary>
    private static void AddUseCases(IServiceCollection services)
    {
        // Squad creation and reads.
        services.AddScoped<CreateSquadHandler>();
        services.AddScoped<GetSquadHandler>();
        services.AddScoped<ListMySquadsHandler>();

        // Role and ownership management.
        services.AddScoped<PromoteToAdminHandler>();
        services.AddScoped<DemoteToMemberHandler>();
        services.AddScoped<TransferOwnershipHandler>();

        // Membership lifecycle.
        services.AddScoped<LeaveSquadHandler>();
        services.AddScoped<RemoveMemberHandler>();

        // Invites.
        services.AddScoped<GenerateInviteHandler>();
        services.AddScoped<ListInvitesHandler>();
        services.AddScoped<RevokeInviteHandler>();
        services.AddScoped<RedeemInviteHandler>();

        // Feature flags.
        services.AddScoped<SetFeatureFlagHandler>();
        services.AddScoped<GetFeatureFlagsHandler>();

        // Guests.
        services.AddScoped<CreateGuestHandler>();
        services.AddScoped<EditGuestHandler>();

        // Guest claims.
        services.AddScoped<InitiateGuestClaimHandler>();
        services.AddScoped<RecordClaimConsentHandler>();
        services.AddScoped<CompleteGuestClaimHandler>();
        services.AddScoped<ReverseGuestClaimHandler>();

        // Squad lifecycle and erasure.
        services.AddScoped<DeleteSquadHandler>();
        services.AddScoped<ReverseSquadDeletionHandler>();
        services.AddScoped<ExportSquadHandler>();
        services.AddScoped<PurgeSquadHandler>();
        services.AddScoped<EraseMembershipHandler>();
        services.AddScoped<OnUserErasedHandler>();
    }
}
