using PitchMate.Domain.ValueObjects;

namespace PitchMate.Application.Commands.Squads;

/// <summary>
/// Command to remove a member from a squad.
/// </summary>
public record RemoveSquadMemberCommand(SquadId SquadId, UserId RequestingUserId, UserId TargetUserId);

/// <summary>
/// Result of remove squad member command.
/// </summary>
public record RemoveSquadMemberResult(bool Success, string? ErrorCode = null, string? ErrorMessage = null);
