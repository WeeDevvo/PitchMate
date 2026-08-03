using PitchMate.Application.Matches.UseCases;

namespace PitchMate.Api.Matches;

/// <summary>
/// The matches composition root (<c>AddMatches</c>). It registers the Application match-lifecycle
/// use-case handlers so every endpoint in <c>MatchEndpoints</c> can resolve its handler
/// (Requirement 16.4).
/// <para>
/// Unlike <c>AddSquads</c> / <c>AddNotifications</c>, this method does not wire any Infrastructure
/// implementations: the match repositories, the <c>ITeamBalancer</c>, and the
/// <c>ISillyNameGenerator</c> are registered directly by <c>AddInfrastructure</c> (via
/// <c>AddMatchesInfrastructure</c>) because they are <c>internal</c> to the Infrastructure assembly
/// and cannot be referenced from the Api. This root therefore only registers the Application
/// handlers, which the Api may reference. It expects <c>AddInfrastructure</c> to have registered the
/// shared persistence services (the DbContext, unit of work, and <see cref="TimeProvider"/>), the
/// rating engine, and the match abstractions the handlers depend on.
/// </para>
/// </summary>
public static class MatchesServiceCollectionExtensions
{
    /// <summary>
    /// Registers the Application match-lifecycle use-case handlers.
    /// </summary>
    /// <param name="services">The service collection to add registrations to.</param>
    /// <returns>The same <paramref name="services"/> for chaining.</returns>
    public static IServiceCollection AddMatches(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        AddUseCases(services);

        return services;
    }

    /// <summary>
    /// Registers the Application match use-case handlers. Handlers are scoped so they share the
    /// request scope's DbContext and unit of work.
    /// </summary>
    private static void AddUseCases(IServiceCollection services)
    {
        // Draft creation.
        services.AddScoped<CreateMatchDraftHandler>();

        // Availability (submit / clear / tally).
        services.AddScoped<SubmitAvailabilityResponseHandler>();
        services.AddScoped<ClearAvailabilityResponseHandler>();
        services.AddScoped<GetAvailabilityTallyHandler>();

        // Confirmation.
        services.AddScoped<ConfirmMatchHandler>();

        // Participant management.
        services.AddScoped<AddGuestParticipantHandler>();
        services.AddScoped<RemoveParticipantHandler>();

        // Team proposal, adjustment, and locking.
        services.AddScoped<ProposeTeamsHandler>();
        services.AddScoped<AdjustTeamsHandler>();
        services.AddScoped<LockTeamsHandler>();
        services.AddScoped<GetTeamSheetHandler>();

        // Play: start, record result, complete, and cancel.
        services.AddScoped<StartMatchHandler>();
        services.AddScoped<RecordResultHandler>();
        services.AddScoped<CompleteMatchHandler>();
        services.AddScoped<CancelMatchHandler>();
    }
}
