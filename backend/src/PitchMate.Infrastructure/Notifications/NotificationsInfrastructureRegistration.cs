using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using PitchMate.Application.Notifications;

namespace PitchMate.Infrastructure.Notifications;

/// <summary>
/// Registers the Infrastructure implementations of the Application notification abstractions
/// (Requirements 7.6, 13.4, 13.6). This lives in Infrastructure because
/// <see cref="EfNotificationRepository"/> is <c>internal</c> to the assembly and cannot be referenced
/// from the Api; the Api's <c>AddNotifications</c> composition root calls this so every abstraction the
/// notification use cases depend on resolves to a concrete implementation, and a missing one fails
/// startup.
/// <para>
/// The use-case handler registrations live in the Api's <c>AddNotifications</c>; this method only wires
/// the Infrastructure side, mirroring the auth and squad layers' <c>AddAuthInfrastructure</c> /
/// <c>AddSquadsInfrastructure</c>. Email delivery reuses the single <see cref="IEmailSender"/> already
/// registered by <c>AddAuth</c>; no second email transport is introduced here (Requirements 7.2, 13.6).
/// <see cref="ServiceCollectionDescriptorExtensions.TryAdd(IServiceCollection, ServiceDescriptor)"/>
/// variants are used so a test host can substitute a fake before calling this.
/// </para>
/// </summary>
public static class NotificationsInfrastructureRegistration
{
    /// <summary>
    /// Registers the EF Core notification repository and the email renderer behind their Application
    /// abstractions.
    /// </summary>
    /// <param name="services">The service collection to add registrations to.</param>
    /// <returns>The same <paramref name="services"/> for chaining.</returns>
    public static IServiceCollection AddNotificationsInfrastructure(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // EF Core notification repository — scoped so it shares the request scope's DbContext and takes
        // part in the same unit-of-work transaction (Requirements 5.6, 13.2).
        services.TryAddScoped<INotificationRepository, EfNotificationRepository>();

        // Per-event email rendering is stateless (fixed per-type templates), so a single shared instance
        // is safe as a singleton (Requirement 7.6).
        services.TryAddSingleton<INotificationEmailRenderer, NotificationEmailRenderer>();

        return services;
    }
}
