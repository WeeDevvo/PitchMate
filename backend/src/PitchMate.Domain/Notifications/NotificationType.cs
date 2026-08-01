namespace PitchMate.Domain.Notifications;

/// <summary>
/// The closed notification catalogue: every kind of notification the system recognises. The first
/// four members are the squad-membership events whose producers already exist and are wired to
/// publish in this spec; the last four are the match-lifecycle events defined here so the
/// match-lifecycle spec can publish them by type without extending the catalogue, but which have no
/// wired producer in this spec (Requirements 2.1, 2.4, 8.7).
/// <para>
/// The members are ordered squad-events first, then match-lifecycle events. Persistence stores the
/// stable numeric value, so members must not be reordered or removed once shipped.
/// </para>
/// </summary>
public enum NotificationType
{
    /// <summary>A user joined the squad by redeeming an invite. Directed to the squad's active owner and admins, excluding the joiner.</summary>
    MemberJoined,

    /// <summary>A registered membership was promoted to admin. Directed to the promoted membership.</summary>
    PromotedToAdmin,

    /// <summary>A registered membership was removed from the squad. Directed to the removed membership, even though it is now inactive.</summary>
    RemovedFromSquad,

    /// <summary>Ownership of the squad was transferred. Directed to the new owner and the former owner.</summary>
    OwnershipTransferred,

    /// <summary>A match draft was created. Match-lifecycle event; defined only, with no producer wired in this spec.</summary>
    MatchDrafted,

    /// <summary>A match was confirmed on a day. Match-lifecycle event; defined only, with no producer wired in this spec.</summary>
    MatchConfirmed,

    /// <summary>Teams were rolled for a match. Match-lifecycle event; defined only, with no producer wired in this spec.</summary>
    TeamsRolled,

    /// <summary>A match result was posted. Match-lifecycle event; defined only, with no producer wired in this spec.</summary>
    ResultPosted
}
