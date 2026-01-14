using PitchMate.Domain.ValueObjects;

namespace PitchMate.Application.Commands.Squads;

/// <summary>
/// Command to add a user as an admin to a squad.
/// </summary>
public record AddSquadAdminCommand(SquadId SquadId, UserId RequestingUserId, UserId TargetUserId);

/// <summary>
/// Result of add squad admin command.
/// </summary>
public record AddSquadAdminResult(bool Success, string? ErrorCode = null, string? ErrorMessage = null);
