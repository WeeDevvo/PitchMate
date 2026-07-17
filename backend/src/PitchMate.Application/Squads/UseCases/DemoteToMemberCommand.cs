namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request by an owner or admin to demote an active registered <c>Admin</c> of their squad back to
/// <c>Member</c> (Requirement 5.3). The acting user must hold an active <c>Owner</c> or <c>Admin</c>
/// membership in the target squad; the target is identified by its membership identity and must be an
/// active registered <c>Admin</c> of the same squad. The owner cannot be demoted (Requirement 5.6).
/// </summary>
/// <param name="ActingUserId">The authenticated user performing the demotion.</param>
/// <param name="SquadId">The squad in which the demotion is performed.</param>
/// <param name="TargetMembershipId">The membership to demote to <c>Member</c>.</param>
public sealed record DemoteToMemberCommand(
    Guid ActingUserId,
    Guid SquadId,
    Guid TargetMembershipId);
