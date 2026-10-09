using PitchMate.Domain.Squads;

namespace PitchMate.Api.Tests.Squads;

/// <summary>
/// One fully materialised guest-claim situation, as the scenario-backed membership and guest-claim
/// repository stand-ins of this folder see it: which squad the routes address, which membership the
/// acting caller holds, which membership the claim targets, which user the claim is being made onto,
/// whether that user already holds a membership in the squad, and the open claim (if any) a completion
/// would act on.
/// <para>
/// It exists so the already-member guard can drive the real guest-claim endpoints — routing,
/// authentication, the real Application handlers, and the real error seam — for an arbitrary generated
/// situation without a database behind it. Everything the handlers read is here; nothing they decide is.
/// </para>
/// </summary>
/// <param name="SquadId">The squad identity carried in the route, which the stand-ins resolve against.</param>
/// <param name="ActingUserId">The caller stamped on the access token, whose membership authorises the call.</param>
/// <param name="Acting">The acting caller's membership — an active owner or admin, so the gate passes.</param>
/// <param name="MembershipId">The membership identity carried in the route.</param>
/// <param name="TargetMembership">The membership <paramref name="MembershipId"/> resolves to, or <see langword="null"/>.</param>
/// <param name="TargetUserId">The registered user the claim is being made onto.</param>
/// <param name="ExistingTargetMembership">
/// The membership <paramref name="TargetUserId"/> already holds in the squad, or <see langword="null"/>
/// when that user holds none. A non-null value is precisely the already-member condition under test.
/// </param>
/// <param name="OpenClaim">The open claim for <paramref name="MembershipId"/>, or <see langword="null"/>.</param>
internal sealed record GuestClaimScenario(
    Guid SquadId,
    Guid ActingUserId,
    SquadMembership Acting,
    Guid MembershipId,
    SquadMembership? TargetMembership,
    Guid TargetUserId,
    SquadMembership? ExistingTargetMembership,
    GuestClaim? OpenClaim);
