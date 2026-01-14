using PitchMate.Domain.ValueObjects;

namespace PitchMate.Application.Commands.Matches;

/// <summary>
/// Command to create a new match within a squad.
/// </summary>
public record CreateMatchCommand(
    SquadId SquadId,
    DateTime ScheduledAt,
    List<UserId> PlayerIds,
    int? TeamSize,
    UserId RequestingUserId);

/// <summary>
/// Result of match creation command.
/// </summary>
public record CreateMatchResult(
    MatchId? MatchId,
    bool Success,
    string? ErrorCode = null,
    string? ErrorMessage = null);
