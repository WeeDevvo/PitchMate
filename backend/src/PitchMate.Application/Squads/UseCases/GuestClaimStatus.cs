namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Where a guest's claim stands, as an admin sees it. Crosses the wire as its member name.
/// </summary>
public enum GuestClaimStatus
{
    /// <summary>A claim link is out and can still be accepted.</summary>
    LinkIssued = 1,

    /// <summary>The claim link expired before anyone accepted it; a new link is needed.</summary>
    LinkExpired = 2,

    /// <summary>A player accepted the link; the claim awaits an admin completing it.</summary>
    Accepted = 3,

    /// <summary>The claim is complete: the membership now belongs to a registered player.</summary>
    Claimed = 4
}
