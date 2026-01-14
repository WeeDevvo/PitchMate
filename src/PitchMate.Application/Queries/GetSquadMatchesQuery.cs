using PitchMate.Domain.ValueObjects;

namespace PitchMate.Application.Queries;

/// <summary>
/// Query to retrieve all matches for a specific squad.
/// </summary>
public record GetSquadMatchesQuery(SquadId SquadId);

/// <summary>
/// Result containing match information for a squad.
/// </summary>
public record MatchDto(
    MatchId MatchId,
    DateTime ScheduledAt,
    int TeamSize,
    MatchStatus Status,
    int PlayerCount,
    TeamDesignation? Winner,
    DateTime? CompletedAt);

/// <summary>
/// Result of GetSquadMatchesQuery.
/// </summary>
public record GetSquadMatchesResult(
    IReadOnlyList<MatchDto> Matches,
    bool Success,
    string? ErrorCode = null,
    string? ErrorMessage = null);
