using PitchMate.Domain.ValueObjects;

namespace PitchMate.Application.Commands.Squads;

/// <summary>
/// Command for a user to join a squad.
/// </summary>
public record JoinSquadCommand(UserId UserId, SquadId SquadId);

/// <summary>
/// Result of join squad command.
/// </summary>
public record JoinSquadResult(bool Success, string? ErrorCode = null, string? ErrorMessage = null);
