using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// The one answer every unusable claim link gets, whatever the reason: an unknown secret, a link already
/// accepted, withdrawn or expired, or a squad pending deletion. A uniform answer means a secret can't be
/// probed for which of those it is.
/// </summary>
internal static class GuestClaimLinkFailures
{
    /// <summary>The fixed, code-only message carried by the uniform failure.</summary>
    public const string UnusableMessage = "The claim link is invalid or no longer usable.";

    /// <summary>The uniform failure for an unusable claim link.</summary>
    public static SquadError Unusable() => new(SquadErrorCode.ClaimNotEligible, UnusableMessage);
}
