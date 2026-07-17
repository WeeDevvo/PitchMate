namespace PitchMate.Domain.Squads;

/// <summary>
/// The state of a guest-claim audit record tracking the linking of a guest membership to a registered user.
/// </summary>
public enum GuestClaimState
{
    /// <summary>The claim has been initiated by an admin and awaits the target user's consent.</summary>
    Pending = 1,

    /// <summary>The target user has consented to the claim.</summary>
    Consented = 2,

    /// <summary>The claim has completed; the membership is now backed by the registered user.</summary>
    Completed = 3,

    /// <summary>The claim has been reversed, unbinding the user while preserving membership history.</summary>
    Reversed = 4
}
