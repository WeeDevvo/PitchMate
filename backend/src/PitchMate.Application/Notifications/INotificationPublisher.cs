using PitchMate.Domain.Notifications;

namespace PitchMate.Application.Notifications;

/// <summary>
/// The single abstraction a producer depends on to raise a catalogued notification. An implementation
/// resolves the recipients for the given <see cref="NotificationType"/>, persists one in-app record per
/// recipient as the source of truth, and then attempts email delivery on a best-effort basis. Producers
/// know nothing about storage or email — they only call this method (Requirements 5.1, 5.6).
/// </summary>
public interface INotificationPublisher
{
    /// <summary>
    /// Publishes a notification of <paramref name="type"/> owned by the squad identified by
    /// <paramref name="squadId"/>. For a broadcast type <paramref name="directedTargetMembershipIds"/> is
    /// empty and recipients are resolved from the squad's active registered memberships; for a directed
    /// type it names the specifically affected registered memberships. The <paramref name="context"/>
    /// supplies the squad-scoped data needed to render content and carries no contact PII. The returned
    /// <see cref="Result"/> indicates success only once the in-app records for all resolved recipients have
    /// been committed; the email outcome never affects it (Requirements 5.1, 5.2, 5.3, 5.4).
    /// </summary>
    /// <param name="type">The catalogued notification type being raised.</param>
    /// <param name="squadId">The owning squad's identity.</param>
    /// <param name="directedTargetMembershipIds">The affected membership ids for a directed type; empty for a broadcast type.</param>
    /// <param name="context">The squad-scoped rendering data; carries no contact PII.</param>
    /// <param name="cancellationToken">A token to cancel the operation before the in-app records are committed.</param>
    /// <returns>A success once all recipients' in-app records are committed, or a failure that persists no partial set.</returns>
    Task<Result> PublishAsync(
        NotificationType type,
        Guid squadId,
        IReadOnlyCollection<Guid> directedTargetMembershipIds,
        NotificationContext context,
        CancellationToken cancellationToken);
}
