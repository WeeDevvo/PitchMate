using PitchMate.Domain.Notifications;

namespace PitchMate.Application.Notifications;

/// <summary>
/// The closed, static metadata table mapping every <see cref="NotificationType"/> to exactly one
/// <see cref="TargetingRule"/> and to a content routine that renders its in-app title and body
/// (Requirements 2.2, 2.3). The table is <b>total</b> over the eight catalogue members: the four squad
/// events are <see cref="TargetingRule.Directed"/> and the four match-lifecycle events are
/// <see cref="TargetingRule.Broadcast"/>. Every type produces a distinct title and a distinct body so no
/// two types are indistinguishable in-app (Requirement 7.4).
/// <para>
/// The publish handler uses <see cref="IsRecognised"/> to reject a value outside the eight defined members
/// before any recipient resolution (Requirement 2.5), <see cref="GetTargetingRule"/> to pick the
/// resolution rule, and <see cref="RenderInAppContent"/> to build each recipient's persisted content.
/// </para>
/// </summary>
public static class NotificationCatalogue
{
    private static readonly IReadOnlyDictionary<NotificationType, NotificationCatalogueEntry> Entries =
        new Dictionary<NotificationType, NotificationCatalogueEntry>
        {
            // --- Squad events: directed to the specifically affected registered memberships. ---
            [NotificationType.MemberJoined] = new NotificationCatalogueEntry(
                TargetingRule.Directed,
                context => new NotificationContent(
                    "New squad member",
                    $"{Actor(context)} joined {Squad(context)}.")),

            [NotificationType.PromotedToAdmin] = new NotificationCatalogueEntry(
                TargetingRule.Directed,
                context => new NotificationContent(
                    "You're now an admin",
                    $"You were promoted to admin in {Squad(context)}.")),

            [NotificationType.RemovedFromSquad] = new NotificationCatalogueEntry(
                TargetingRule.Directed,
                context => new NotificationContent(
                    "Removed from squad",
                    $"You were removed from {Squad(context)}.")),

            [NotificationType.OwnershipTransferred] = new NotificationCatalogueEntry(
                TargetingRule.Directed,
                context => new NotificationContent(
                    "Squad ownership changed",
                    $"Ownership of {Squad(context)} was transferred.")),

            // --- Match-lifecycle events: broadcast to the squad's active registered memberships. ---
            [NotificationType.MatchDrafted] = new NotificationCatalogueEntry(
                TargetingRule.Broadcast,
                context => new NotificationContent(
                    "New match — respond now",
                    $"A match was drafted for {Squad(context)}. Mark your availability.")),

            [NotificationType.MatchConfirmed] = new NotificationCatalogueEntry(
                TargetingRule.Broadcast,
                context => new NotificationContent(
                    "Match confirmed",
                    $"Your match in {Squad(context)} is confirmed.")),

            [NotificationType.TeamsRolled] = new NotificationCatalogueEntry(
                TargetingRule.Broadcast,
                context => new NotificationContent(
                    "Teams are set",
                    $"Teams have been rolled for your match in {Squad(context)}.")),

            [NotificationType.ResultPosted] = new NotificationCatalogueEntry(
                TargetingRule.Broadcast,
                context => new NotificationContent(
                    "Result posted",
                    $"The result for your match in {Squad(context)} has been posted.")),
        };

    /// <summary>
    /// Determines whether <paramref name="type"/> is one of the eight defined catalogue members. A value
    /// outside the catalogue (for example an undefined enum value cast from an integer) returns
    /// <see langword="false"/> so the publish handler can reject it before resolving any recipient
    /// (Requirement 2.5).
    /// </summary>
    /// <param name="type">The candidate notification type.</param>
    /// <returns><see langword="true"/> when the type has a catalogue entry; otherwise <see langword="false"/>.</returns>
    public static bool IsRecognised(NotificationType type) => Entries.ContainsKey(type);

    /// <summary>
    /// Returns the single <see cref="TargetingRule"/> for <paramref name="type"/>.
    /// </summary>
    /// <param name="type">A recognised notification type.</param>
    /// <returns>The type's targeting rule.</returns>
    /// <exception cref="ArgumentOutOfRangeException">Thrown when <paramref name="type"/> is not a catalogue member; callers guard with <see cref="IsRecognised"/> first.</exception>
    public static TargetingRule GetTargetingRule(NotificationType type) => Entry(type).TargetingRule;

    /// <summary>
    /// Renders the in-app <see cref="NotificationContent"/> for <paramref name="type"/> from
    /// <paramref name="context"/>.
    /// </summary>
    /// <param name="type">A recognised notification type.</param>
    /// <param name="context">The squad-scoped rendering data.</param>
    /// <returns>The rendered in-app title and body for the type.</returns>
    /// <exception cref="ArgumentOutOfRangeException">Thrown when <paramref name="type"/> is not a catalogue member; callers guard with <see cref="IsRecognised"/> first.</exception>
    public static NotificationContent RenderInAppContent(NotificationType type, NotificationContext context) =>
        Entry(type).RenderInAppContent(context);

    /// <summary>
    /// Attempts to obtain the catalogue <paramref name="entry"/> for <paramref name="type"/> without
    /// throwing, returning <see langword="false"/> for an unrecognised type.
    /// </summary>
    /// <param name="type">The candidate notification type.</param>
    /// <param name="entry">The matching entry when recognised; otherwise <see langword="null"/>.</param>
    /// <returns><see langword="true"/> when the type has an entry; otherwise <see langword="false"/>.</returns>
    public static bool TryGetEntry(NotificationType type, out NotificationCatalogueEntry? entry) =>
        Entries.TryGetValue(type, out entry);

    private static NotificationCatalogueEntry Entry(NotificationType type) =>
        Entries.TryGetValue(type, out NotificationCatalogueEntry? entry)
            ? entry
            : throw new ArgumentOutOfRangeException(
                nameof(type), type, "The notification type is not a member of the catalogue.");

    private static string Squad(NotificationContext context) =>
        string.IsNullOrWhiteSpace(context.SquadName) ? "your squad" : context.SquadName;

    private static string Actor(NotificationContext context) =>
        string.IsNullOrWhiteSpace(context.ActorDisplayName) ? "A new member" : context.ActorDisplayName;
}
