namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request by the current owner to transfer ownership of their squad to an active registered member
/// (Requirement 6.2). The acting user must hold the active <c>Owner</c> membership in the target
/// squad; the target is identified by its membership identity and must be an active registered
/// membership of the same squad other than the owner's own (Requirement 6.3, 6.4).
/// </summary>
/// <param name="ActingUserId">The authenticated user performing the transfer; must be the current owner.</param>
/// <param name="SquadId">The squad whose ownership is transferred.</param>
/// <param name="TargetMembershipId">The membership to promote to <c>Owner</c>.</param>
public sealed record TransferOwnershipCommand(
    Guid ActingUserId,
    Guid SquadId,
    Guid TargetMembershipId);
