namespace PitchMate.Domain.Squads;

/// <summary>
/// The state of a guest-claim audit record tracking the linking of a guest membership to a registered user.
/// </summary>
public enum GuestClaimState
{
    /// <summary>The claim link has been issued by an admin and awaits a player accepting it.</summary>
    Pending = 1,

    /// <summary>A player has accepted the link, binding their account; the claim awaits an admin completing it.</summary>
    Consented = 2,

    /// <summary>The claim has completed; the membership is now backed by the registered user.</summary>
    Completed = 3,

    /// <summary>The claim has been reversed, unbinding the user while preserving membership history.</summary>
    Reversed = 4,

    /// <summary>
    /// The claim's link was withdrawn before it completed, because an admin issued a newer link for the
    /// same guest. A cancelled claim can never be accepted or completed.
    /// </summary>
    Cancelled = 5
}
