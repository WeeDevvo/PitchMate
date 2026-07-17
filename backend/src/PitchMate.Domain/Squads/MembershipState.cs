namespace PitchMate.Domain.Squads;

/// <summary>
/// The lifecycle state of a squad membership. Leaving or removal makes a membership
/// inactive (history retained for rating replay); re-joining reactivates the same membership.
/// </summary>
public enum MembershipState
{
    /// <summary>The membership is active and eligible for player selection.</summary>
    Active = 1,

    /// <summary>The membership has left or been removed; history is retained but it is not selectable.</summary>
    Inactive = 2
}
