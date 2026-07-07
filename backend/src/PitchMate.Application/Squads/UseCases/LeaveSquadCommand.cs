namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request by an authenticated user to leave a squad they belong to (Requirement 7.1). The acting
/// user is identified by their user identity and the target squad; the handler resolves that user's
/// own membership and deactivates it. An owner must transfer ownership before leaving (Requirement
/// 7.2), and a membership that is already inactive is treated as satisfied (Requirement 7.3).
/// </summary>
/// <param name="ActingUserId">The authenticated user requesting to leave.</param>
/// <param name="SquadId">The squad the user is leaving.</param>
public sealed record LeaveSquadCommand(
    Guid ActingUserId,
    Guid SquadId);
