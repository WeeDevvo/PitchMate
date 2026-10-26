using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// The eligibility rule shared by the two guest-availability writes: the target must be an active
/// guest membership of the match's squad. A registered member answers for themselves, so naming one
/// here is refused, as is an inactive guest or one from another squad.
/// </summary>
internal static class GuestAvailabilityTarget
{
    /// <summary>Whether <paramref name="target"/> is an active guest of <paramref name="match"/>'s squad.</summary>
    public static bool IsEligible(SquadMembership? target, Match match) =>
        target is not null
        && target.IsGuest
        && target.SquadId == match.SquadId
        && target.State == MembershipState.Active;

    /// <summary>The validation failure for an ineligible target.</summary>
    public static MatchError Ineligible(Guid guestMembershipId) =>
        new(MatchErrorCode.ValidationFailed,
            $"Membership {guestMembershipId} is ineligible: it must be an active guest membership of this match's squad.");
}
