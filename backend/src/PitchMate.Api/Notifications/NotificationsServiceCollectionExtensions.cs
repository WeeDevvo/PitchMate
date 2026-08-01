using PitchMate.Application.Notifications;
using PitchMate.Infrastructure.Notifications;

namespace PitchMate.Api.Notifications;

/// <summary>
/// The notifications composition root (<c>AddNotifications</c>). It registers the Application use-case
/// handlers — the publish fan-out, the read model, and the lifecycle removals — and wires the
/// Infrastructure implementations behind the Application abstractions via
/// <see cref="NotificationsInfrastructureRegistration.AddNotificationsInfrastructure"/>
/// (Requirements 13.3, 13.4).
/// <para>
/// This is the only notification wiring in the Api; the Api holds no notification logic itself. It
/// expects <c>AddInfrastructure</c> to have registered the shared persistence services (the DbContext,
/// unit of work, and <see cref="TimeProvider"/>) and, crucially, <c>AddAuth</c> to have registered the
/// single <see cref="IEmailSender"/> transport that <see cref="PublishNotificationHandler"/> reuses for
/// best-effort email — no second email transport is introduced (Requirements 7.2, 13.6).
/// </para>
/// </summary>
public static class NotificationsServiceCollectionExtensions
{
    /// <summary>
    /// Registers the Application notification use-case handlers and the Infrastructure implementations of
    /// the notification abstractions.
    /// </summary>
    /// <param name="services">The service collection to add registrations to.</param>
    /// <returns>The same <paramref name="services"/> for chaining.</returns>
    public static IServiceCollection AddNotifications(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        AddUseCases(services);
        services.AddNotificationsInfrastructure();

        return services;
    }

    /// <summary>
    /// Registers the Application notification use-case handlers. Handlers are scoped so they share the
    /// request scope's DbContext and unit of work. The publish fan-out is exposed through the
    /// <see cref="INotificationPublisher"/> abstraction that producers depend on (Requirement 5.1).
    /// </summary>
    private static void AddUseCases(IServiceCollection services)
    {
        // Publish fan-out: producers depend only on the abstraction (Requirements 5.1, 5.6).
        services.AddScoped<INotificationPublisher, PublishNotificationHandler>();

        // Read model.
        services.AddScoped<ListNotificationsHandler>();
        services.AddScoped<GetUnreadCountHandler>();
        services.AddScoped<MarkNotificationReadHandler>();
        services.AddScoped<MarkAllNotificationsReadHandler>();

        // GDPR / lifecycle removal handlers.
        services.AddScoped<RemoveNotificationsForUserHandler>();
        services.AddScoped<RemoveNotificationsForMembershipHandler>();
        services.AddScoped<RemoveNotificationsForSquadHandler>();
    }
}
