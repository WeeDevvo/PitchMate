using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PitchMate.Application.Commands.Squads;
using PitchMate.Application.Queries;
using PitchMate.Domain.Repositories;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.API.Controllers;

/// <summary>
/// Controller for squad management endpoints.
/// Handles squad creation, membership, and administration.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class SquadsController : ControllerBase
{
    private readonly CreateSquadCommandHandler _createSquadHandler;
    private readonly JoinSquadCommandHandler _joinSquadHandler;
    private readonly AddSquadAdminCommandHandler _addSquadAdminHandler;
    private readonly RemoveSquadMemberCommandHandler _removeSquadMemberHandler;
    private readonly GetUserSquadsQueryHandler _getUserSquadsHandler;
    private readonly ISquadRepository _squadRepository;
    private readonly IUserRepository _userRepository;

    public SquadsController(
        CreateSquadCommandHandler createSquadHandler,
        JoinSquadCommandHandler joinSquadHandler,
        AddSquadAdminCommandHandler addSquadAdminHandler,
        RemoveSquadMemberCommandHandler removeSquadMemberHandler,
        GetUserSquadsQueryHandler getUserSquadsHandler,
        ISquadRepository squadRepository,
        IUserRepository userRepository)
    {
        _createSquadHandler = createSquadHandler ?? throw new ArgumentNullException(nameof(createSquadHandler));
        _joinSquadHandler = joinSquadHandler ?? throw new ArgumentNullException(nameof(joinSquadHandler));
        _addSquadAdminHandler = addSquadAdminHandler ?? throw new ArgumentNullException(nameof(addSquadAdminHandler));
        _removeSquadMemberHandler = removeSquadMemberHandler ?? throw new ArgumentNullException(nameof(removeSquadMemberHandler));
        _getUserSquadsHandler = getUserSquadsHandler ?? throw new ArgumentNullException(nameof(getUserSquadsHandler));
        _squadRepository = squadRepository ?? throw new ArgumentNullException(nameof(squadRepository));
        _userRepository = userRepository ?? throw new ArgumentNullException(nameof(userRepository));
    }

    /// <summary>
    /// Create a new squad with the authenticated user as admin.
    /// </summary>
    /// <param name="request">Squad creation request containing squad name.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Squad ID on success or error details on failure.</returns>
    [HttpPost]
    [ProducesResponseType(typeof(CreateSquadResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> CreateSquad([FromBody] CreateSquadRequest request, CancellationToken ct)
    {
        if (request == null)
            return BadRequest(new ErrorResponse("Invalid request body."));

        var userId = GetAuthenticatedUserId();
        if (userId == null)
            return Unauthorized(new ErrorResponse("User not authenticated."));

        var command = new CreateSquadCommand(request.Name, userId);
        var result = await _createSquadHandler.HandleAsync(command, ct);

        if (!result.Success)
        {
            return BadRequest(new ErrorResponse(result.ErrorMessage ?? "Squad creation failed.", result.ErrorCode));
        }

        return CreatedAtAction(
            nameof(GetUserSquads),
            new CreateSquadResponse(result.SquadId!.Value));
    }

    /// <summary>
    /// Get all squads for the authenticated user.
    /// </summary>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>List of squads with user's rating and admin status.</returns>
    [HttpGet]
    [ProducesResponseType(typeof(GetUserSquadsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> GetUserSquads(CancellationToken ct)
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

        var squads = result.Squads.Select(s => new SquadResponseDto(
            SquadId: s.SquadId.Value,
            Name: s.Name,
            CurrentRating: s.CurrentRating.Value,
            JoinedAt: s.JoinedAt,
            IsAdmin: s.IsAdmin
        )).ToList();

        return Ok(new GetUserSquadsResponse(squads));
    }

    /// <summary>
    /// Get a specific squad by ID with all members and admins.
    /// </summary>
    /// <param name="id">Squad ID.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Squad details with members and admins.</returns>
    [HttpGet("{id}")]
    [ProducesResponseType(typeof(GetSquadDetailsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> GetSquadDetails(Guid id, CancellationToken ct)
    {
        var userId = GetAuthenticatedUserId();
        if (userId == null)
            return Unauthorized(new ErrorResponse("User not authenticated."));

        var squad = await _squadRepository.GetByIdAsync(new SquadId(id), ct);
        if (squad == null)
        {
            return NotFound(new ErrorResponse("Squad not found."));
        }

        // Load user details for each member to get their emails
        var members = new List<SquadMemberDto>();
        foreach (var member in squad.Members)
        {
            var user = await _userRepository.GetByIdAsync(member.UserId, ct);
            if (user != null)
            {
                members.Add(new SquadMemberDto(
                    UserId: member.UserId.Value,
                    Email: user.Email.Value,
                    SquadId: member.SquadId.Value,
                    CurrentRating: member.CurrentRating.Value,
                    JoinedAt: member.JoinedAt
                ));
            }
        }

        var adminIds = squad.AdminIds.Select(a => a.Value).ToList();

        var response = new GetSquadDetailsResponse(
            Id: squad.Id.Value,
            Name: squad.Name,
            CreatedAt: squad.CreatedAt,
            AdminIds: adminIds,
            Members: members
        );

        return Ok(response);
    }

    /// <summary>
    /// Join a squad as a member.
    /// </summary>
    /// <param name="id">Squad ID to join.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Success status or error details.</returns>
    [HttpPost("{id}/join")]
    [ProducesResponseType(typeof(JoinSquadResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> JoinSquad(Guid id, CancellationToken ct)
    {
        var userId = GetAuthenticatedUserId();
        if (userId == null)
            return Unauthorized(new ErrorResponse("User not authenticated."));

        var command = new JoinSquadCommand(userId, new SquadId(id));
        var result = await _joinSquadHandler.HandleAsync(command, ct);

        if (!result.Success)
        {
            return BadRequest(new ErrorResponse(result.ErrorMessage ?? "Failed to join squad.", result.ErrorCode));
        }

        return Ok(new JoinSquadResponse(Success: true, Message: "Successfully joined squad."));
    }

    /// <summary>
    /// Add a user as an admin to a squad (admin only).
    /// </summary>
    /// <param name="id">Squad ID.</param>
    /// <param name="request">Request containing target user ID.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Success status or error details.</returns>
    [HttpPost("{id}/admins")]
    [ProducesResponseType(typeof(AddSquadAdminResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> AddSquadAdmin(Guid id, [FromBody] AddSquadAdminRequest request, CancellationToken ct)
    {
        if (request == null)
            return BadRequest(new ErrorResponse("Invalid request body."));

        var userId = GetAuthenticatedUserId();
        if (userId == null)
            return Unauthorized(new ErrorResponse("User not authenticated."));

        var command = new AddSquadAdminCommand(
            SquadId: new SquadId(id),
            RequestingUserId: userId,
            TargetUserId: new UserId(request.TargetUserId));

        var result = await _addSquadAdminHandler.HandleAsync(command, ct);

        if (!result.Success)
        {
            if (result.ErrorCode == "AUTHZ_001")
                return StatusCode(StatusCodes.Status403Forbidden, new ErrorResponse(result.ErrorMessage ?? "Forbidden.", result.ErrorCode));

            return BadRequest(new ErrorResponse(result.ErrorMessage ?? "Failed to add admin.", result.ErrorCode));
        }

        return Ok(new AddSquadAdminResponse(Success: true, Message: "Successfully added admin."));
    }

    /// <summary>
    /// Remove a member from a squad (admin only).
    /// </summary>
    /// <param name="id">Squad ID.</param>
    /// <param name="userId">User ID to remove.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Success status or error details.</returns>
    [HttpDelete("{id}/members/{userId}")]
    [ProducesResponseType(typeof(RemoveSquadMemberResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> RemoveSquadMember(Guid id, Guid userId, CancellationToken ct)
    {
        var requestingUserId = GetAuthenticatedUserId();
        if (requestingUserId == null)
            return Unauthorized(new ErrorResponse("User not authenticated."));

        var command = new RemoveSquadMemberCommand(
            SquadId: new SquadId(id),
            RequestingUserId: requestingUserId,
            TargetUserId: new UserId(userId));

        var result = await _removeSquadMemberHandler.HandleAsync(command, ct);

        if (!result.Success)
        {
            if (result.ErrorCode == "AUTHZ_001")
                return StatusCode(StatusCodes.Status403Forbidden, new ErrorResponse(result.ErrorMessage ?? "Forbidden.", result.ErrorCode));

            return BadRequest(new ErrorResponse(result.ErrorMessage ?? "Failed to remove member.", result.ErrorCode));
        }

        return Ok(new RemoveSquadMemberResponse(Success: true, Message: "Successfully removed member."));
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
/// Request model for squad creation.
/// </summary>
public record CreateSquadRequest(string Name);

/// <summary>
/// Response model for successful squad creation.
/// </summary>
public record CreateSquadResponse(Guid SquadId);

/// <summary>
/// Response model for get user squads query.
/// </summary>
public record GetUserSquadsResponse(IReadOnlyList<SquadResponseDto> Squads);

/// <summary>
/// DTO for squad information in responses.
/// </summary>
public record SquadResponseDto(
    Guid SquadId,
    string Name,
    int CurrentRating,
    DateTime JoinedAt,
    bool IsAdmin);

/// <summary>
/// Response model for join squad operation.
/// </summary>
public record JoinSquadResponse(bool Success, string Message);

/// <summary>
/// Request model for adding a squad admin.
/// </summary>
public record AddSquadAdminRequest(Guid TargetUserId);

/// <summary>
/// Response model for add squad admin operation.
/// </summary>
public record AddSquadAdminResponse(bool Success, string Message);

/// <summary>
/// Response model for remove squad member operation.
/// </summary>
public record RemoveSquadMemberResponse(bool Success, string Message);

/// <summary>
/// Response model for get squad details endpoint.
/// </summary>
public record GetSquadDetailsResponse(
    Guid Id,
    string Name,
    DateTime CreatedAt,
    IReadOnlyList<Guid> AdminIds,
    IReadOnlyList<SquadMemberDto> Members);

/// <summary>
/// DTO for squad member information.
/// </summary>
public record SquadMemberDto(
    Guid UserId,
    string Email,
    Guid SquadId,
    int CurrentRating,
    DateTime JoinedAt);
