using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads;

/// <summary>
/// Pure, centralised authorisation gate over a resolved acting membership. Every squad use case
/// resolves the acting membership from the authenticated user and target squad, then calls one of
/// these gates before mutating state. Each gate returns either <see cref="Result.Ok"/> when the actor
/// is permitted, or a single uniform authorisation failure
/// (<see cref="SquadErrorCode.Unauthorized"/>) that is identical whether the actor is a plain member,
/// an inactive membership, a guest membership (which holds no role), or not a member at all — so a
/// rejection never discloses whether the squad exists or what role the actor holds
/// (Requirement 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 16.2). The gates are pure: they read the acting
/// membership only and never mutate state, so a failure leaves everything unchanged.
/// </summary>
internal static class SquadAuthorization
{
    /// <summary>The single, non-disclosing message returned for every authorisation failure.</summary>
    private const string UniformFailureMessage = "The requested action is not permitted.";

    /// <summary>
    /// Requires an active membership of the target squad. Rejects a missing membership (non-member)
    /// or an inactive one with the uniform authorisation failure (Requirement 4.3, 4.6, 16.2).
    /// </summary>
    /// <param name="acting">The resolved acting membership, or <see langword="null"/> when the actor is not a member.</param>
    /// <returns><see cref="Result.Ok"/> when the actor is an active member; otherwise the uniform failure.</returns>
    public static Result RequireActive(SquadMembership? acting) =>
        IsActive(acting) ? Result.Ok() : Unauthorized();

    /// <summary>
    /// Requires an active <see cref="SquadRole.Owner"/> or <see cref="SquadRole.Admin"/> membership,
    /// gating admin-only actions (invites, guests, claims, promote/demote, remove member, toggle
    /// features). A member, inactive membership, guest membership, or non-member is rejected with the
    /// uniform authorisation failure (Requirement 4.2, 4.7).
    /// </summary>
    /// <param name="acting">The resolved acting membership, or <see langword="null"/> when the actor is not a member.</param>
    /// <returns><see cref="Result.Ok"/> when the actor is an active owner or admin; otherwise the uniform failure.</returns>
    public static Result RequireOwnerOrAdmin(SquadMembership? acting) =>
        IsActive(acting) && acting!.Role is SquadRole.Owner or SquadRole.Admin
            ? Result.Ok()
            : Unauthorized();

    /// <summary>
    /// Requires the active <see cref="SquadRole.Owner"/> membership, gating owner-only actions
    /// (ownership transfer, squad deletion and its reversal). Any other actor — an admin, member,
    /// inactive membership, guest membership, or non-member — is rejected with the uniform
    /// authorisation failure (Requirement 4.4, 4.5).
    /// </summary>
    /// <param name="acting">The resolved acting membership, or <see langword="null"/> when the actor is not a member.</param>
    /// <returns><see cref="Result.Ok"/> when the actor is the active owner; otherwise the uniform failure.</returns>
    public static Result RequireOwner(SquadMembership? acting) =>
        IsActive(acting) && acting!.Role is SquadRole.Owner
            ? Result.Ok()
            : Unauthorized();

    private static bool IsActive(SquadMembership? acting) =>
        acting is not null && acting.State == MembershipState.Active;

    private static Result Unauthorized() =>
        Result.Fail(new SquadError(SquadErrorCode.Unauthorized, UniformFailureMessage));
}
