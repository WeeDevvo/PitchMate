using PitchMate.Domain.Squads;
using MatchError = PitchMate.Domain.Matches.MatchError;
using MatchErrorCode = PitchMate.Domain.Matches.MatchErrorCode;
using Result = PitchMate.Domain.Matches.Result;

namespace PitchMate.Application.Matches;

/// <summary>
/// Pure, centralised authorisation gate over a resolved acting membership for the match-lifecycle
/// use cases. Every match use case resolves the acting <see cref="SquadMembership"/> from the
/// authenticated user and the match's squad, then calls one of these gates before mutating or
/// reading match state. Each gate returns either <see cref="Result.Ok"/> when the actor is
/// permitted, or a single uniform authorisation failure
/// (<see cref="MatchErrorCode.Unauthorized"/>) that is identical whether the actor is a plain
/// member, an inactive membership, a guest membership (which holds no role), or not a member at
/// all — so a rejection never discloses whether the squad or the match exists, nor what role the
/// actor holds (Requirement 14.1, 14.2, 14.3, 14.4). This mirrors the established
/// <see cref="PitchMate.Application.Squads.SquadAuthorization"/> gate while returning the match
/// result triad. The gates are pure: they read the acting membership only and never mutate state,
/// so a failure leaves everything unchanged.
/// </summary>
internal static class MatchAuthorization
{
    /// <summary>The single, non-disclosing message returned for every authorisation failure.</summary>
    private const string UniformFailureMessage = "The requested action is not permitted.";

    /// <summary>
    /// Requires an active registered <see cref="SquadRole.Owner"/> or <see cref="SquadRole.Admin"/>
    /// membership of the match's squad, gating every match-organising action (create draft, confirm,
    /// add/remove participant, roll/lock teams, start, record result, complete, cancel). A plain
    /// member, an inactive membership, a guest membership (which holds no role), or a non-member is
    /// rejected with the uniform authorisation failure that discloses neither the squad nor the match
    /// (Requirement 14.1, 14.2).
    /// </summary>
    /// <param name="acting">The resolved acting membership, or <see langword="null"/> when the actor is not a member.</param>
    /// <returns><see cref="Result.Ok"/> when the actor is an active owner or admin; otherwise the uniform failure.</returns>
    public static Result RequireOrganiser(SquadMembership? acting) =>
        IsActive(acting) && acting!.Role is SquadRole.Owner or SquadRole.Admin
            ? Result.Ok()
            : Unauthorized();

    /// <summary>
    /// Requires an active membership of the match's squad, gating squad-scoped reads (the
    /// availability tally and the team sheet). Any active member — owner, admin, plain member, or an
    /// active guest membership — is permitted; an inactive membership or a non-member is rejected with
    /// the uniform authorisation failure so a rejection conceals whether the match exists
    /// (Requirement 14.3, 14.4).
    /// </summary>
    /// <param name="acting">The resolved acting membership, or <see langword="null"/> when the actor is not a member.</param>
    /// <returns><see cref="Result.Ok"/> when the actor is an active member; otherwise the uniform failure.</returns>
    public static Result RequireActiveMember(SquadMembership? acting) =>
        IsActive(acting) ? Result.Ok() : Unauthorized();

    private static bool IsActive(SquadMembership? acting) =>
        acting is not null && acting.State == MembershipState.Active;

    private static Result Unauthorized() =>
        Result.Fail(new MatchError(MatchErrorCode.Unauthorized, UniformFailureMessage));
}
