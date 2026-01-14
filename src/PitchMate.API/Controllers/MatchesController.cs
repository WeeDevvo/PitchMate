using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PitchMate.Application.Commands.Matches;
using PitchMate.Application.Queries;
using PitchMate.Domain.Repositories;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.API.Controllers;

/// <summary>
/// Controller for match management endpoints.
/// Handles match creation, result recording, and match queries.
/// </summary>
[ApiController]
[Route("api")]
[Authorize]
public class MatchesController : ControllerBase
{
    private readonly CreateMatchCommandHandler _createMatchHandler;
    private readonly RecordMatchResultCommandHandler _recordMatchResultHandler;
    private readonly GetSquadMatchesQueryHandler _getSquadMatchesHandler;
    private readonly IMatchRepository _matchRepository;

    public MatchesController(
        CreateMatchCommandHandler createMatchHandler,
        RecordMatchResultCommandHandler recordMatchResultHandler,
        GetSquadMatchesQueryHandler getSquadMatchesHandler,
        IMatchRepository matchRepository)
    {
        _createMatchHandler = createMatchHandler ?? throw new ArgumentNullException(nameof(createMatchHandler));
        _recordMatchResultHandler = recordMatchResultHandler ?? throw new ArgumentNullException(nameof(recordMatchResultHandler));
        _getSquadMatchesHandler = getSquadMatchesHandler ?? throw new ArgumentNullException(nameof(getSquadMatchesHandler));
        _matchRepository = matchRepository ?? throw new ArgumentNullException(nameof(matchRepository));
    }

    /// <summary>
    /// Create a new match within a squad (admin only).
    /// </summary>
    /// <param name="squadId">Squad ID for the match.</param>
    /// <param name="request">Match creation request containing scheduled time, players, and team size.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Match ID on success or error details on failure.</returns>
    [HttpPost("squads/{squadId}/matches")]
    [ProducesResponseType(typeof(CreateMatchResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> CreateMatch(Guid squadId, [FromBody] CreateMatchRequest request, CancellationToken ct)
    {
        if (request == null)
            return BadRequest(new ErrorResponse("Invalid request body."));

        var userId = GetAuthenticatedUserId();
        if (userId == null)
            return Unauthorized(new ErrorResponse("User not authenticated."));

        var command = new CreateMatchCommand(
            SquadId: new SquadId(squadId),
            ScheduledAt: request.ScheduledAt,
            PlayerIds: request.PlayerIds.Select(id => new UserId(id)).ToList(),
            TeamSize: request.TeamSize,
            RequestingUserId: userId);

        var result = await _createMatchHandler.HandleAsync(command, ct);

        if (!result.Success)
        {
            if (result.ErrorCode == "AUTHZ_001")
                return StatusCode(StatusCodes.Status403Forbidden, new ErrorResponse(result.ErrorMessage ?? "Forbidden.", result.ErrorCode));

            return BadRequest(new ErrorResponse(result.ErrorMessage ?? "Match creation failed.", result.ErrorCode));
        }

        return CreatedAtAction(
            nameof(GetMatchDetails),
            new { id = result.MatchId!.Value },
            new CreateMatchResponse(result.MatchId!.Value));
    }

    /// <summary>
    /// Get all matches for a specific squad.
    /// </summary>
    /// <param name="squadId">Squad ID to retrieve matches for.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>List of matches for the squad.</returns>
    [HttpGet("squads/{squadId}/matches")]
    [ProducesResponseType(typeof(GetSquadMatchesResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> GetSquadMatches(Guid squadId, CancellationToken ct)
    {
        var userId = GetAuthenticatedUserId();
        if (userId == null)
            return Unauthorized(new ErrorResponse("User not authenticated."));

        var query = new GetSquadMatchesQuery(new SquadId(squadId));
        var result = await _getSquadMatchesHandler.HandleAsync(query, ct);

        if (!result.Success)
        {
            return BadRequest(new ErrorResponse(result.ErrorMessage ?? "Failed to retrieve matches.", result.ErrorCode));
        }

        var matches = result.Matches.Select(m => new MatchResponseDto(
            MatchId: m.MatchId.Value,
            ScheduledAt: m.ScheduledAt,
            TeamSize: m.TeamSize,
            Status: m.Status.ToString(),
            PlayerCount: m.PlayerCount,
            Winner: m.Winner?.ToString(),
            CompletedAt: m.CompletedAt
        )).ToList();

        return Ok(new GetSquadMatchesResponse(matches));
    }

    /// <summary>
    /// Record the result of a match (admin only).
    /// </summary>
    /// <param name="id">Match ID.</param>
    /// <param name="request">Result recording request containing winner and optional feedback.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Success status or error details.</returns>
    [HttpPost("matches/{id}/result")]
    [ProducesResponseType(typeof(RecordMatchResultResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> RecordMatchResult(Guid id, [FromBody] RecordMatchResultRequest request, CancellationToken ct)
    {
        if (request == null)
            return BadRequest(new ErrorResponse("Invalid request body."));

        var userId = GetAuthenticatedUserId();
        if (userId == null)
            return Unauthorized(new ErrorResponse("User not authenticated."));

        // Parse winner designation
        if (!Enum.TryParse<TeamDesignation>(request.Winner, true, out var winner))
        {
            return BadRequest(new ErrorResponse("Invalid winner designation. Must be 'TeamA', 'TeamB', or 'Draw'."));
        }

        var command = new RecordMatchResultCommand(
            MatchId: new MatchId(id),
            Winner: winner,
            BalanceFeedback: request.BalanceFeedback,
            RequestingUserId: userId);

        var result = await _recordMatchResultHandler.HandleAsync(command, ct);

        if (!result.Success)
        {
            if (result.ErrorCode == "AUTHZ_001")
                return StatusCode(StatusCodes.Status403Forbidden, new ErrorResponse(result.ErrorMessage ?? "Forbidden.", result.ErrorCode));

            return BadRequest(new ErrorResponse(result.ErrorMessage ?? "Failed to record match result.", result.ErrorCode));
        }

        return Ok(new RecordMatchResultResponse(Success: true, Message: "Match result recorded successfully."));
    }

    /// <summary>
    /// Get details of a specific match.
    /// </summary>
    /// <param name="id">Match ID.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Match details including teams and players.</returns>
    [HttpGet("matches/{id}")]
    [ProducesResponseType(typeof(MatchDetailsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> GetMatchDetails(Guid id, CancellationToken ct)
    {
        var userId = GetAuthenticatedUserId();
        if (userId == null)
            return Unauthorized(new ErrorResponse("User not authenticated."));

        var match = await _matchRepository.GetByIdAsync(new MatchId(id), ct);
        if (match == null)
        {
            return NotFound(new ErrorResponse("Match not found."));
        }

        var teamAPlayers = match.TeamA?.Players.Select(p => new MatchPlayerDto(
            UserId: p.UserId.Value,
            Rating: p.RatingAtMatchTime.Value
        )).ToList();

        var teamBPlayers = match.TeamB?.Players.Select(p => new MatchPlayerDto(
            UserId: p.UserId.Value,
            Rating: p.RatingAtMatchTime.Value
        )).ToList();

        var response = new MatchDetailsResponse(
            MatchId: match.Id.Value,
            SquadId: match.SquadId.Value,
            ScheduledAt: match.ScheduledAt,
            TeamSize: match.TeamSize,
            Status: match.Status.ToString(),
            TeamA: teamAPlayers != null ? new TeamDto(teamAPlayers, match.TeamA!.TotalRating) : null,
            TeamB: teamBPlayers != null ? new TeamDto(teamBPlayers, match.TeamB!.TotalRating) : null,
            Result: match.Result != null ? new MatchResultDto(
                Winner: match.Result.Winner.ToString(),
                BalanceFeedback: match.Result.BalanceFeedback,
                RecordedAt: match.Result.RecordedAt
            ) : null
        );

        return Ok(response);
    }

    /// <summary>
    /// Helper method to extract authenticated user ID from JWT claims.
    /// </summary>
    /// <returns>UserId if authenticated, null otherwise.</returns>
    private UserId? GetAuthenticatedUserId()
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value 
            ?? User.FindFirst("sub")?.Value;
        if (userIdClaim == null || !Guid.TryParse(userIdClaim, out var userIdGuid))
            return null;

        return new UserId(userIdGuid);
    }
}

// Request/Response DTOs

/// <summary>
/// Request model for match creation.
/// </summary>
public record CreateMatchRequest(
    DateTime ScheduledAt,
    List<Guid> PlayerIds,
    int? TeamSize);

/// <summary>
/// Response model for successful match creation.
/// </summary>
public record CreateMatchResponse(Guid MatchId);

/// <summary>
/// Response model for get squad matches query.
/// </summary>
public record GetSquadMatchesResponse(IReadOnlyList<MatchResponseDto> Matches);

/// <summary>
/// DTO for match information in list responses.
/// </summary>
public record MatchResponseDto(
    Guid MatchId,
    DateTime ScheduledAt,
    int TeamSize,
    string Status,
    int PlayerCount,
    string? Winner,
    DateTime? CompletedAt);

/// <summary>
/// Request model for recording match result.
/// </summary>
public record RecordMatchResultRequest(
    string Winner,
    string? BalanceFeedback);

/// <summary>
/// Response model for record match result operation.
/// </summary>
public record RecordMatchResultResponse(bool Success, string Message);

/// <summary>
/// Response model for match details.
/// </summary>
public record MatchDetailsResponse(
    Guid MatchId,
    Guid SquadId,
    DateTime ScheduledAt,
    int TeamSize,
    string Status,
    TeamDto? TeamA,
    TeamDto? TeamB,
    MatchResultDto? Result);

/// <summary>
/// DTO for team information.
/// </summary>
public record TeamDto(
    IReadOnlyList<MatchPlayerDto> Players,
    int TotalRating);

/// <summary>
/// DTO for match player information.
/// </summary>
public record MatchPlayerDto(
    Guid UserId,
    int Rating);

/// <summary>
/// DTO for match result information.
/// </summary>
public record MatchResultDto(
    string Winner,
    string? BalanceFeedback,
    DateTime RecordedAt);
