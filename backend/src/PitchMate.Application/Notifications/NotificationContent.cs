namespace PitchMate.Application.Notifications;

/// <summary>
/// The rendered in-app content of a notification — a <see cref="Title"/> and a <see cref="Body"/>, both in
/// English — produced by the <see cref="NotificationCatalogue"/>'s content routine for a given
/// <see cref="PitchMate.Domain.Notifications.NotificationType"/> and <see cref="NotificationContext"/>
/// (Requirement 2.3). The values become the persisted
/// <see cref="PitchMate.Domain.Notifications.InAppNotification"/>'s title and body, so the catalogue keeps
/// the title within 1..200 characters and the body within 1..2000 characters. No two distinct types
/// produce an identical title or an identical body (Requirement 7.4).
/// </summary>
/// <param name="Title">The rendered English title (1..200 characters).</param>
/// <param name="Body">The rendered English body (1..2000 characters).</param>
public sealed record NotificationContent(string Title, string Body);
