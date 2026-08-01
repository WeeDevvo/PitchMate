using PitchMate.Domain.Notifications;

namespace PitchMate.Application.Notifications;

/// <summary>
/// The closed metadata the <see cref="NotificationCatalogue"/> holds for a single
/// <see cref="NotificationType"/>: the one <see cref="TargetingRule"/> that resolves its recipients
/// (Requirement 2.2) and the content routine that renders a <see cref="NotificationContext"/> into the
/// in-app <see cref="NotificationContent"/> for that type (Requirement 2.3). Every catalogued type has
/// exactly one entry, guaranteeing totality over all eight members.
/// </summary>
/// <param name="TargetingRule">The single recipient-resolution rule for the type.</param>
/// <param name="RenderInAppContent">The content routine turning a context into the type's in-app title and body.</param>
public sealed record NotificationCatalogueEntry(
    TargetingRule TargetingRule,
    Func<NotificationContext, NotificationContent> RenderInAppContent);
