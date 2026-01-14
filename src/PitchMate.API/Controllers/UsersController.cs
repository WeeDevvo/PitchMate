using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PitchMate.Application.Queries;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.API.Controllers;

/// <summary>
/// Controller for user-related endpoints.
/// Handles user profile and rating information.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class UsersController : ControllerBase
{
    private readonly GetUserSquadsQueryHandler _getUserSquadsHandler;
    private readonly GetUserRatingInSquadQueryHandler _getUserRatingInSquadHandler;

    public UsersController(
        GetUserSquadsQueryHandler getUserSquadsHandler,
        GetUserRatingInSquadQueryHandler getUserRatingInSquadHandler)
    {
        _getUserSquadsHandler = getUserSquadsHandler ?? throw new ArgumentNullException(nameof(getUserSquadsHandler));
        _getUserRatingInSquadHandler = getUserRatingInSquadHandler ?? throw new ArgumentNullException(nameof(getUserRatingInSquadHandler));
    }

    /// <summary>
    /// Get the current authenticated user's information.
    /// </summary>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Current user information.</returns>
    [HttpGet("me")]
    [ProducesResponseType(typeof(GetCurrentUserResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status401Unauthorized)]
    public IActionResult GetCurrentUser(CancellationToken ct)
    {
        var userId = GetAuthenticatedUserId();
        if (userId == null)
            return Unauthorized(new ErrorResponse("User not authenticated."));

        var emailClaim = User.FindFirst(ClaimTypes.Email)?.Value 
            ?? User.FindFirst("email")?.Value
            ?? User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Email)?.Value;

        return Ok(new GetCurrentUserResponse(
            UserId: userId.Value,
            Email: emailClaim ?? ""));
    }

    /// <summary>
    /// Get the current authenticated user's squads with ratings.
    /// </summary>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>List of squads with user's rating and admin status.</returns>
    [HttpGet("me/squads")]
    [ProducesResponseType(typeof(GetUserSquadsWithRatingsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> GetCurrentUserSquads(CancellationToken ct)
    {
        var userId = GetAuthenticatedUserId();
        if (userId == null)
            return Unauthorized(new ErrorResponse("User not authenticated."));

        var query = new GetUserSquadsQuery(userId);
        var result = await _getUserSquadsHandler.HandleAsync(query, ct);

        if (!result.Success)
        {
            return BadRequest(new ErrorResponse(result.ErrorMessage ?? "Failed to retrieve squads.", result.ErrorCode));
        }

        var squads = result.Squads.Select(s => new UserSquadDto(
            SquadId: s.SquadId.Value,
            Name: s.Name,
            CurrentRating: s.CurrentRating.Value,
            JoinedAt: s.JoinedAt,
            IsAdmin: s.IsAdmin
        )).ToList();

        return Ok(new GetUserSquadsWithRatingsResponse(squads));
    }

    /// <summary>
    /// Get a user's rating in a specific squad.
    /// </summary>
    /// <param name="id">User ID.</param>
    /// <param name="squadId">Squad ID.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>User's rating information in the squad.</returns>
    [HttpGet("{id}/squads/{squadId}/rating")]
    [ProducesResponseType(typeof(GetUserRatingResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetUserRatingInSquad(Guid id, Guid squadId, CancellationToken ct)
    {
        // Verify authentication
        var requestingUserId = GetAuthenticatedUserId();
        if (requestingUserId == null)
            return Unauthorized(new ErrorResponse("User not authenticated."));

        var query = new GetUserRatingInSquadQuery(new UserId(id), new SquadId(squadId));
        var result = await _getUserRatingInSquadHandler.HandleAsync(query, ct);

        if (!result.Success)
        {
            if (result.ErrorCode == "BUS_001" || result.ErrorCode == "BUS_004")
                return NotFound(new ErrorResponse(result.ErrorMessage ?? "User or membership not found.", result.ErrorCode));

            return BadRequest(new ErrorResponse(result.ErrorMessage ?? "Failed to retrieve rating.", result.ErrorCode));
        }

        return Ok(new GetUserRatingResponse(
            UserId: result.Rating!.UserId.Value,
            SquadId: result.Rating.SquadId.Value,
            CurrentRating: result.Rating.CurrentRating.Value,
            JoinedAt: result.Rating.JoinedAt));
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
/// Response model for get current user endpoint.
/// </summary>
public record GetCurrentUserResponse(Guid UserId, string Email);

/// <summary>
/// Response model for get current user's squads with ratings.
/// </summary>
public record GetUserSquadsWithRatingsResponse(IReadOnlyList<UserSquadDto> Squads);

/// <summary>
/// DTO for user's squad information including rating.
/// </summary>
public record UserSquadDto(
    Guid SquadId,
    string Name,
    int CurrentRating,
    DateTime JoinedAt,
    bool IsAdmin);

/// <summary>
/// Response model for get user rating in squad endpoint.
/// </summary>
public record GetUserRatingResponse(
    Guid UserId,
    Guid SquadId,
    int CurrentRating,
    DateTime JoinedAt);
