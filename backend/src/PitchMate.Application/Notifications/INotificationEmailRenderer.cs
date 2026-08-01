using PitchMate.Application.Auth.Abstractions;
using PitchMate.Domain.Notifications;

namespace PitchMate.Application.Notifications;

/// <summary>
/// Renders a notification of a given <see cref="NotificationType"/> into an <see cref="EmailMessage"/>
/// for a recipient, in English. This is an Application-declared concern whose implementation lives in
/// Infrastructure (Requirements 7.1, 7.6). The produced subject is a single line of English text with no
/// line breaks and no more than 200 characters; the body is non-empty English text. Every notification
/// type yields a distinct subject and body (Requirement 7.4).
/// </summary>
public interface INotificationEmailRenderer
{
    /// <summary>
    /// Renders the email message for <paramref name="type"/> addressed to <paramref name="recipientEmail"/>,
    /// using the squad-scoped data in <paramref name="context"/> (which carries no contact PII beyond the
    /// supplied recipient address).
    /// </summary>
    /// <param name="type">The catalogued notification type to render.</param>
    /// <param name="recipientEmail">The destination email address for the rendered message.</param>
    /// <param name="context">The squad-scoped rendering data.</param>
    /// <returns>The rendered, transport-agnostic <see cref="EmailMessage"/>.</returns>
    EmailMessage Render(NotificationType type, string recipientEmail, NotificationContext context);
}
