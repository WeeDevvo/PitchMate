using PitchMate.Domain.ValueObjects;

namespace PitchMate.Application.Queries;

/// <summary>
/// Query to retrieve all squads for a specific user.
/// </summary>
public record GetUserSquadsQuery(UserId UserId);

/// <summary>
/// Result containing squad information for a user.
/// </summary>
public record SquadDto(
    SquadId SquadId,
    string Name,
    EloRating CurrentRating,
    DateTime JoinedAt,
    bool IsAdmin);

/// <summary>
/// Result of GetUserSquadsQuery.
/// </summary>
public record GetUserSquadsResult(
    IReadOnlyList<SquadDto> Squads,
    bool Success,
    string? ErrorCode = null,
    string? ErrorMessage = null);
