using PitchMate.Domain.Squads;
using LiveTrackingError = PitchMate.Domain.LiveTracking.LiveTrackingError;
using LiveTrackingErrorCode = PitchMate.Domain.LiveTracking.LiveTrackingErrorCode;
using Result = PitchMate.Domain.LiveTracking.Result;

namespace PitchMate.Application.LiveTracking;

/// <summary>
/// Pure, centralised authorisation gate over a resolved acting membership for the live-tracking use
/// cases. Every use case resolves the acting <see cref="SquadMembership"/> from the authenticated
/// access-token subject and the match's squad, then calls one of these gates before recording or
/// reading live detail. Each gate returns either <see cref="Result.Ok"/> when the actor is permitted,
/// or a single uniform authorisation failure (<see cref="LiveTrackingErrorCode.Unauthorized"/>) that is
/// identical whether the actor is a plain member, an inactive membership, a guest membership (which
/// holds no role), or not a member at all — so a rejection never discloses whether the squad or the
/// match exists, nor what role the actor holds (Requirement 11.1, 11.2, 11.3, 11.4). This mirrors the
/// established <see cref="PitchMate.Application.Squads.SquadAuthorization"/> and
/// <see cref="PitchMate.Application.Matches.MatchAuthorization"/> gates while returning the
/// live-tracking result triad. The gates are pure: they read the acting membership only and never
/// mutate state, so a failure leaves everything unchanged.
/// </summary>
internal static class LiveTrackingAuthorization
{
    /// <summary>The single, non-disclosing message returned for every authorisation failure.</summary>
    private const string UniformFailureMessage = "The requested action is not permitted.";

    /// <summary>
    /// Requires an active registered <see cref="SquadRole.Owner"/> or <see cref="SquadRole.Admin"/>
    /// membership of the match's squad, gating every recording and finalising action. A plain member,
    /// an inactive membership, a guest membership (which holds no role), or a non-member is rejected
    /// with the uniform authorisation failure that discloses neither the squad nor the match
    /// (Requirement 11.1, 11.2).
    /// </summary>
    /// <param name="requesterMembership">The resolved acting membership, or <see langword="null"/> when the actor is not a member.</param>
    /// <returns><see cref="Result.Ok"/> when the actor is an active owner or admin; otherwise the uniform failure.</returns>
    public static Result RequireAdmin(SquadMembership? requesterMembership) =>
        IsActive(requesterMembership) && requesterMembership!.Role is SquadRole.Owner or SquadRole.Admin
            ? Result.Ok()
            : Unauthorized();

    /// <summary>
    /// Requires an active membership of the match's squad, gating squad-scoped reads (the running
    /// score). Any active member — owner, admin, plain member, or an active guest membership — is
    /// permitted; an inactive membership or a non-member is rejected with the uniform authorisation
    /// failure so a rejection conceals whether the match exists (Requirement 11.3, 11.4).
    /// </summary>
    /// <param name="requesterMembership">The resolved acting membership, or <see langword="null"/> when the actor is not a member.</param>
    /// <returns><see cref="Result.Ok"/> when the actor is an active member; otherwise the uniform failure.</returns>
    public static Result RequireActiveMember(SquadMembership? requesterMembership) =>
        IsActive(requesterMembership) ? Result.Ok() : Unauthorized();

    private static bool IsActive(SquadMembership? requesterMembership) =>
        requesterMembership is not null && requesterMembership.State == MembershipState.Active;

    private static Result Unauthorized() =>
        Result.Fail(new LiveTrackingError(LiveTrackingErrorCode.Unauthorized, UniformFailureMessage));
}
