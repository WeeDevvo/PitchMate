namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request by an owner or admin to revoke an invite of their squad (Requirement 12.1). The acting
/// user must hold an active <c>Owner</c> or <c>Admin</c> membership in the target squad, and the
/// invite identified by <paramref name="InviteId"/> must belong to that same squad; otherwise the
/// request is rejected with an authorisation failure that leaves the invite unchanged
/// (Requirement 12.7).
/// </summary>
/// <param name="ActingUserId">The authenticated user performing the revocation.</param>
/// <param name="SquadId">The squad the invite belongs to and in which the actor must be owner or admin.</param>
/// <param name="InviteId">The invite to revoke.</param>
public sealed record RevokeInviteCommand(
    Guid ActingUserId,
    Guid SquadId,
    Guid InviteId);
