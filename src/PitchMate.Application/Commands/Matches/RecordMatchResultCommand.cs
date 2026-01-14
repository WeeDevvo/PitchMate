using PitchMate.Domain.ValueObjects;

namespace PitchMate.Application.Commands.Matches;

/// <summary>
/// Command to record the result of a completed match.
/// </summary>
public record RecordMatchResultCommand(
    MatchId MatchId,
    TeamDesignation Winner,
    string? BalanceFeedback,
    UserId RequestingUserId);

/// <summary>
/// Result of recording match result command.
/// </summary>
public record RecordMatchResultResult(
    bool Success,
    string? ErrorCode = null,
    string? ErrorMessage = null);
