namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request by an owner or admin to remove a member (registered or guest) from their squad
/// (Requirement 8.1, 8.3). The acting user must hold an active <c>Owner</c> or <c>Admin</c>
/// membership in the target squad; the target is identified by its membership identity and must be a
/// membership of the same squad other than the owner (Requirement 8.2, 8.5).
/// </summary>
/// <param name="ActingUserId">The authenticated user performing the removal.</param>
/// <param name="SquadId">The squad the target is removed from.</param>
/// <param name="TargetMembershipId">The membership to remove (deactivate).</param>
public sealed record RemoveMemberCommand(
    Guid ActingUserId,
    Guid SquadId,
    Guid TargetMembershipId);
