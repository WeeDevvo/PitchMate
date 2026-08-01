namespace PitchMate.Application.Notifications;

/// <summary>
/// The per-type recipient-resolution rule the <see cref="NotificationCatalogue"/> associates with every
/// <see cref="PitchMate.Domain.Notifications.NotificationType"/>. Each catalogued type has exactly one
/// targeting rule (Requirement 2.2); the concrete resolution against the squad's memberships is performed
/// by the publish handler using the rule selected here.
/// </summary>
public enum TargetingRule
{
    /// <summary>
    /// Resolve recipients to the owning squad's <b>active registered</b> memberships at the publish
    /// instant. Used by the four match-lifecycle types (<c>MatchDrafted</c>, <c>MatchConfirmed</c>,
    /// <c>TeamsRolled</c>, <c>ResultPosted</c>) — Requirement 4.2.
    /// </summary>
    Broadcast,

    /// <summary>
    /// Resolve recipients to the caller-supplied affected membership ids, intersected with the owning
    /// squad's registered memberships (including a membership that became <c>Inactive</c> as a result of
    /// the very event being notified). Used by the four squad events (<c>MemberJoined</c>,
    /// <c>PromotedToAdmin</c>, <c>RemovedFromSquad</c>, <c>OwnershipTransferred</c>) — Requirements 4.3, 4.4.
    /// </summary>
    Directed
}
