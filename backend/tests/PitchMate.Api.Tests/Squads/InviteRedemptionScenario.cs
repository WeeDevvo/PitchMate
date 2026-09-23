using PitchMate.Domain.Squads;

namespace PitchMate.Api.Tests.Squads;

/// <summary>
/// One fully materialised invite-redemption situation, as the scenario-backed invite and membership
/// repository stand-ins of this folder see it: which squad the invite grants membership to, which user
/// is redeeming, the secret that user presents, the invite whose stored one-way hash that secret must
/// reproduce, the membership the redeeming user already holds (if any), and the display name the request
/// carries (if any).
/// <para>
/// It exists so the redemption guard can drive the real <c>POST /squads/invites/redeem</c> endpoint —
/// routing, authentication, the real invite secret service, the real Application handler, and the real
/// success/error seam — for an arbitrary generated situation without a database behind it. Everything
/// the handler reads is here; nothing it decides is.
/// </para>
/// </summary>
/// <param name="SquadId">The squad the invite grants membership to, which the memberships belong to.</param>
/// <param name="ActingUserId">The redeeming caller, stamped on the access token.</param>
/// <param name="PresentedSecret">The invite secret the request presents.</param>
/// <param name="Invite">
/// The invite the stand-in resolves, whose <see cref="Invite.TokenHash"/> is the real hash of
/// <paramref name="PresentedSecret"/> — so the handler's own hash-and-match step is exercised rather
/// than bypassed.
/// </param>
/// <param name="ExistingMembership">
/// The membership <paramref name="ActingUserId"/> already holds in the squad, or <see langword="null"/>
/// when that user holds none. An <i>active</i> value is precisely the already-member condition under
/// test; an inactive one reactivates, and none joins.
/// </param>
/// <param name="SuppliedDisplayName">The display name the request carries, or <see langword="null"/>.</param>
internal sealed record InviteRedemptionScenario(
    Guid SquadId,
    Guid ActingUserId,
    string PresentedSecret,
    Invite Invite,
    SquadMembership? ExistingMembership,
    string? SuppliedDisplayName);
