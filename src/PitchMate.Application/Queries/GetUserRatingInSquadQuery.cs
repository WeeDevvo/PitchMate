using PitchMate.Domain.ValueObjects;

namespace PitchMate.Application.Queries;

/// <summary>
/// Query to retrieve a user's current rating in a specific squad.
/// </summary>
public record GetUserRatingInSquadQuery(UserId UserId, SquadId SquadId);

/// <summary>
/// Result containing user's rating information in a squad.
/// </summary>
public record UserRatingDto(
    UserId UserId,
    SquadId SquadId,
    EloRating CurrentRating,
    DateTime JoinedAt);

/// <summary>
/// Result of GetUserRatingInSquadQuery.
/// </summary>
public record GetUserRatingInSquadResult(
    UserRatingDto? Rating,
    bool Success,
    string? ErrorCode = null,
    string? ErrorMessage = null);
