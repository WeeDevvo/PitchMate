using PitchMate.Domain.ValueObjects;

namespace PitchMate.Application.Commands.Squads;

/// <summary>
/// Command to create a new squad with the creator as an admin.
/// </summary>
public record CreateSquadCommand(string Name, UserId CreatorId);

/// <summary>
/// Result of squad creation command.
/// </summary>
public record CreateSquadResult(SquadId? SquadId, bool Success, string? ErrorCode = null, string? ErrorMessage = null);
