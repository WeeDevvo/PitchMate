namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request by an owner or admin to complete a consented guest claim, rebinding the guest membership
/// onto its target user as a registered member (Requirement 15.1, 15.2, 15.5). The acting user must
/// hold an active <c>Owner</c> or <c>Admin</c> membership in the target squad. Completion is
/// consent-gated: it is rejected unless the target user has already recorded consent
/// (Requirement 15.3), and it is rejected when the target user has come to hold another membership in
/// the squad since initiation (Requirement 15.4). Completion preserves the membership's state,
/// display name, rating, stats, and match history unchanged (Requirement 15.2).
/// </summary>
/// <param name="ActingUserId">The authenticated owner or admin completing the claim.</param>
/// <param name="SquadId">The squad the guest membership belongs to.</param>
/// <param name="MembershipId">The guest membership being rebound onto its target user.</param>
public sealed record CompleteGuestClaimCommand(
    Guid ActingUserId,
    Guid SquadId,
    Guid MembershipId);
