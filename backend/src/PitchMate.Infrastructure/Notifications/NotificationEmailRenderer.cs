using System.Globalization;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Notifications;
using PitchMate.Domain.Notifications;

namespace PitchMate.Infrastructure.Notifications;

/// <summary>
/// The Infrastructure implementation of <see cref="INotificationEmailRenderer"/> (Requirement 7.6). It
/// turns a catalogued <see cref="NotificationType"/> and its squad-scoped <see cref="NotificationContext"/>
/// into a transport-agnostic <see cref="EmailMessage"/> for the recipient, in English (Requirement 7.1).
/// <para>
/// Every one of the eight catalogue members has its own fixed, event-descriptive subject and body prose,
/// so no two distinct types can ever produce an identical subject or an identical body regardless of the
/// context supplied (Requirement 7.4). Each subject is forced onto a single line with no line breaks and
/// capped at <see cref="EmailMessage"/>'s 200-character subject budget; each body is non-empty
/// (Requirement 7.1). The context carries only display-oriented values already visible within the squad —
/// never contact PII — so nothing sensitive beyond the supplied recipient address reaches the rendered
/// message.
/// </para>
/// </summary>
public sealed class NotificationEmailRenderer : INotificationEmailRenderer
{
    /// <summary>
    /// The maximum subject length permitted by <see cref="INotificationEmailRenderer"/>: a single line of
    /// no more than 200 characters (Requirement 7.1).
    /// </summary>
    private const int SubjectMaxLength = 200;

    /// <inheritdoc />
    public EmailMessage Render(NotificationType type, string recipientEmail, NotificationContext context)
    {
        ArgumentNullException.ThrowIfNull(recipientEmail);
        ArgumentNullException.ThrowIfNull(context);

        (string subject, string body) = type switch
        {
            NotificationType.MemberJoined => (
                $"New member joined {Squad(context)}",
                $"{Actor(context)} has joined {Squad(context)}. Say hello and get them into the next match."),

            NotificationType.PromotedToAdmin => (
                $"You're now an admin of {Squad(context)}",
                $"You have been promoted to admin in {Squad(context)}. You can now organise matches, manage "
                    + "players, and roll teams for the squad."),

            NotificationType.RemovedFromSquad => (
                $"You've been removed from {Squad(context)}",
                $"You have been removed from {Squad(context)}. Your match history and stats are kept, so your "
                    + "record continues if you ever rejoin."),

            NotificationType.OwnershipTransferred => (
                $"Ownership of {Squad(context)} has changed",
                $"Ownership of {Squad(context)} has been transferred{NewOwnerClause(context)}. The squad always "
                    + "has exactly one owner, who can organise matches and manage every member."),

            NotificationType.MatchDrafted => (
                $"New match drafted for {Squad(context)} — respond now",
                $"A new match has been drafted for {Squad(context)}.{MatchWhenClause(context)} Mark which days "
                    + "you can play so an admin can confirm the match."),

            NotificationType.MatchConfirmed => (
                $"Your {Squad(context)} match is confirmed",
                $"Your match in {Squad(context)} is confirmed and you're on the list to play.{MatchWhenClause(context)} "
                    + "Teams will be rolled once the line-up is set."),

            NotificationType.TeamsRolled => (
                $"Teams are set for your {Squad(context)} match",
                $"The teams have been rolled for your match in {Squad(context)}.{MatchWhenClause(context)} Check the "
                    + "team sheet to see your side and who's wearing the bibs."),

            NotificationType.ResultPosted => (
                $"The result is in for your {Squad(context)} match",
                $"The result has been posted for your match in {Squad(context)}.{ResultClause(context)} See how it "
                    + "affected the leaderboard and your rating."),

            _ => throw new ArgumentOutOfRangeException(
                nameof(type), type, "The notification type is not a member of the catalogue."),
        };

        return new EmailMessage(recipientEmail, SingleLineSubject(subject), body);
    }

    /// <summary>
    /// Forces <paramref name="subject"/> onto a single line by collapsing any line breaks to spaces and
    /// caps it at <see cref="SubjectMaxLength"/> characters so the subject invariant always holds even for
    /// an unusually long squad name (Requirement 7.1).
    /// </summary>
    private static string SingleLineSubject(string subject)
    {
        string singleLine = subject
            .Replace("\r\n", " ", StringComparison.Ordinal)
            .Replace('\r', ' ')
            .Replace('\n', ' ');

        return singleLine.Length <= SubjectMaxLength
            ? singleLine
            : singleLine[..SubjectMaxLength];
    }

    private static string Squad(NotificationContext context) =>
        string.IsNullOrWhiteSpace(context.SquadName) ? "your squad" : context.SquadName;

    private static string Actor(NotificationContext context) =>
        string.IsNullOrWhiteSpace(context.ActorDisplayName) ? "A new member" : context.ActorDisplayName;

    private static string NewOwnerClause(NotificationContext context) =>
        string.IsNullOrWhiteSpace(context.AffectedMemberDisplayName)
            ? string.Empty
            : $" to {context.AffectedMemberDisplayName}";

    private static string MatchWhenClause(NotificationContext context)
    {
        bool hasLocation = !string.IsNullOrWhiteSpace(context.MatchLocation);
        bool hasTime = context.MatchScheduledFor is not null;

        if (hasLocation && hasTime)
        {
            return $" It's at {context.MatchLocation} on {FormatWhen(context.MatchScheduledFor!.Value)}.";
        }

        if (hasLocation)
        {
            return $" It's at {context.MatchLocation}.";
        }

        return hasTime ? $" It's on {FormatWhen(context.MatchScheduledFor!.Value)}." : string.Empty;
    }

    private static string ResultClause(NotificationContext context) =>
        string.IsNullOrWhiteSpace(context.MatchSummary) ? string.Empty : $" {context.MatchSummary}.";

    private static string FormatWhen(DateTimeOffset when) =>
        when.ToString("dddd d MMMM 'at' HH:mm 'UTC'", CultureInfo.InvariantCulture);
}
