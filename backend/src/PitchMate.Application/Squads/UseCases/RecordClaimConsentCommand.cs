namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request by the <b>target user</b> of a pending guest claim to record their consent to that claim
/// (Requirement 15.1, 15.3). Unlike the admin-gated initiate/complete/reverse steps, consent is
/// authorised by the claimed user themselves: the authenticated <paramref name="ConsentingUserId"/>
/// must equal the open claim's target user, so no one else can consent on their behalf. Recording
/// consent transitions the claim from pending to consented; it does not rebind the membership, which
/// remains a guest until an admin completes the claim (Requirement 15.3).
/// </summary>
/// <param name="ConsentingUserId">The authenticated user recording consent; must be the claim's target user.</param>
/// <param name="SquadId">The squad the claimed guest membership belongs to.</param>
/// <param name="MembershipId">The guest membership whose open claim is being consented to.</param>
public sealed record RecordClaimConsentCommand(
    Guid ConsentingUserId,
    Guid SquadId,
    Guid MembershipId);
