using PitchMate.Domain.Squads;

namespace PitchMate.Application.Stats;

/// <summary>
/// Pure, centralised authorisation gate over a resolved requester membership for stats reads. Every
/// stats read use case (Leaderboard or Profile) resolves the requester's membership from the
/// authenticated token subject and the target squad, then calls this gate before computing any
/// statistics. The gate returns either <see cref="Result.Ok"/> when the requester holds an
/// <see cref="MembershipState.Active"/> membership of the target squad, or a single uniform
/// authorisation failure (<see cref="StatsErrorCode.Unauthorized"/>) that is identical whether the
/// requester holds an inactive membership or no membership at all — so a rejection never discloses
/// whether the squad or membership exists (Requirement 1.1, 1.2, 1.4, 1.5, 1.6). The gate is pure: it
/// reads the requester membership only and never mutates state.
/// </summary>
internal static class StatsAuthorization
{
    /// <summary>The single, non-disclosing message returned for every authorisation failure.</summary>
    private const string UniformFailureMessage = "The requested action is not permitted.";

    /// <summary>
    /// Requires an active membership of the target squad. Rejects a missing membership (non-member)
    /// or an inactive one with the uniform authorisation failure, disclosing nothing about squad or
    /// membership existence (Requirement 1.1, 1.2, 1.4, 1.6).
    /// </summary>
    /// <param name="requesterMembership">The resolved requester membership, or <see langword="null"/> when the requester is not a member.</param>
    /// <returns><see cref="Result.Ok"/> when the requester is an active member; otherwise the uniform failure.</returns>
    public static Result RequireActiveMember(SquadMembership? requesterMembership) =>
        requesterMembership is not null && requesterMembership.State == MembershipState.Active
            ? Result.Ok()
            : Unauthorized();

    private static Result Unauthorized() =>
        Result.Fail(new StatsError(StatsErrorCode.Unauthorized, UniformFailureMessage));
}
