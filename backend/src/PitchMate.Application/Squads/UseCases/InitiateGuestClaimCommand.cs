namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request by an owner or admin to initiate a guest claim linking a guest membership in their
/// squad to a registered user (Requirement 15.1, 15.7). The acting user must hold an active
/// <c>Owner</c> or <c>Admin</c> membership in the target squad; the target membership must be an
/// active/inactive <b>guest</b> membership of that squad (a non-guest target is rejected,
/// Requirement 15.7); and the target user must not already hold any membership — active or inactive —
/// in the same squad (Requirement 15.4). The claim is opened in a pending state and awaits the target
/// user's consent before it can complete (Requirement 15.1, 15.3).
/// </summary>
/// <param name="ActingUserId">The authenticated owner or admin initiating the claim.</param>
/// <param name="SquadId">The squad the guest membership belongs to.</param>
/// <param name="MembershipId">The guest membership being claimed onto a user.</param>
/// <param name="TargetUserId">The registered user the membership is being claimed onto.</param>
public sealed record InitiateGuestClaimCommand(
    Guid ActingUserId,
    Guid SquadId,
    Guid MembershipId,
    Guid TargetUserId);
