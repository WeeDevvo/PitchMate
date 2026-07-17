namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request by an owner or admin to list the invites of their squad (Requirement 10.5). The acting
/// user must hold an active <c>Owner</c> or <c>Admin</c> membership in the target squad
/// (Requirement 4.2); every other actor is rejected with a uniform authorisation failure.
/// </summary>
/// <param name="ActingUserId">The authenticated user requesting the invite list.</param>
/// <param name="SquadId">The squad whose invites are listed.</param>
public sealed record ListInvitesCommand(
    Guid ActingUserId,
    Guid SquadId);
