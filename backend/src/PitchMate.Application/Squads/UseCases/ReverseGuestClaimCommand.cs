namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request by an owner or admin to reverse a previously completed guest claim, rebinding the
/// membership from its user back to a guest (Requirement 15.6). The acting user must hold an active
/// <c>Owner</c> or <c>Admin</c> membership in the target squad. Reversal is rejected when the
/// membership's claim-completed indicator is not set — there is no completed claim to reverse — and
/// leaves the membership unchanged (Requirement 15.8). A successful reversal preserves the
/// membership's rating, stats, and match history unchanged and records the reversal as audit data
/// (Requirement 15.6).
/// </summary>
/// <param name="ActingUserId">The authenticated owner or admin reversing the claim.</param>
/// <param name="SquadId">The squad the membership belongs to.</param>
/// <param name="MembershipId">The membership whose completed claim is being reversed.</param>
public sealed record ReverseGuestClaimCommand(
    Guid ActingUserId,
    Guid SquadId,
    Guid MembershipId);
