namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request by an owner or admin to promote an active registered <c>Member</c> of their squad to
/// <c>Admin</c> (Requirement 5.1). The acting user must hold an active <c>Owner</c> or <c>Admin</c>
/// membership in the target squad; the target is identified by its membership identity and must be an
/// active registered <c>Member</c> of the same squad.
/// </summary>
/// <param name="ActingUserId">The authenticated user performing the promotion.</param>
/// <param name="SquadId">The squad in which the promotion is performed.</param>
/// <param name="TargetMembershipId">The membership to promote to <c>Admin</c>.</param>
public sealed record PromoteToAdminCommand(
    Guid ActingUserId,
    Guid SquadId,
    Guid TargetMembershipId);
