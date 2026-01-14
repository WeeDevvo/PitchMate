using Microsoft.AspNetCore.Mvc;
using PitchMate.Application.Commands.Users;

namespace PitchMate.API.Controllers;

/// <summary>
/// Controller for authentication endpoints.
/// Handles user registration, login, and Google OAuth authentication.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly CreateUserCommandHandler _createUserHandler;
    private readonly AuthenticateUserCommandHandler _authenticateUserHandler;
    private readonly AuthenticateWithGoogleCommandHandler _authenticateWithGoogleHandler;

    public AuthController(
        CreateUserCommandHandler createUserHandler,
        AuthenticateUserCommandHandler authenticateUserHandler,
        AuthenticateWithGoogleCommandHandler authenticateWithGoogleHandler)
    {
        _createUserHandler = createUserHandler ?? throw new ArgumentNullException(nameof(createUserHandler));
        _authenticateUserHandler = authenticateUserHandler ?? throw new ArgumentNullException(nameof(authenticateUserHandler));
        _authenticateWithGoogleHandler = authenticateWithGoogleHandler ?? throw new ArgumentNullException(nameof(authenticateWithGoogleHandler));
    }

    /// <summary>
    /// Register a new user with email and password.
    /// </summary>
    /// <param name="request">Registration request containing email and password.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>User ID on success or error details on failure.</returns>
    [HttpPost("register")]
    [ProducesResponseType(typeof(RegisterResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Register([FromBody] RegisterRequest request, CancellationToken ct)
    {
        if (request == null)
            return BadRequest(new ErrorResponse("Invalid request body."));

        var command = new CreateUserCommand(request.Email, request.Password);
        var result = await _createUserHandler.HandleAsync(command, ct);

        if (!result.Success)
        {
            return BadRequest(new ErrorResponse(result.ErrorMessage ?? "Registration failed.", result.ErrorCode));
        }

        return CreatedAtAction(
            nameof(Register), 
            new RegisterResponse(result.UserId.Value));
    }

    /// <summary>
    /// Authenticate a user with email and password.
    /// </summary>
    /// <param name="request">Login request containing email and password.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>JWT token on success or error details on failure.</returns>
    [HttpPost("login")]
    [ProducesResponseType(typeof(LoginResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Login([FromBody] LoginRequest request, CancellationToken ct)
    {
        if (request == null)
            return BadRequest(new ErrorResponse("Invalid request body."));

        var command = new AuthenticateUserCommand(request.Email, request.Password);
        var result = await _authenticateUserHandler.HandleAsync(command, ct);

        if (!result.Success)
        {
            return Unauthorized(new ErrorResponse(result.ErrorMessage ?? "Authentication failed.", result.ErrorCode));
        }

        return Ok(new LoginResponse(result.Token!, result.UserId!.Value));
    }

    /// <summary>
    /// Authenticate a user with Google OAuth.
    /// </summary>
    /// <param name="request">Google OAuth request containing Google token.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>JWT token on success or error details on failure.</returns>
    [HttpPost("google")]
    [ProducesResponseType(typeof(GoogleAuthResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ErrorResponse), StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> GoogleAuth([FromBody] GoogleAuthRequest request, CancellationToken ct)
    {
        if (request == null)
            return BadRequest(new ErrorResponse("Invalid request body."));

        var command = new AuthenticateWithGoogleCommand(request.GoogleToken);
        var result = await _authenticateWithGoogleHandler.HandleAsync(command, ct);

        if (!result.Success)
        {
            return Unauthorized(new ErrorResponse(result.ErrorMessage ?? "Google authentication failed.", result.ErrorCode));
        }

        return Ok(new GoogleAuthResponse(result.Token!, result.UserId!.Value, result.IsNewUser));
    }
}

// Request/Response DTOs

/// <summary>
/// Request model for user registration.
/// </summary>
public record RegisterRequest(string Email, string Password);

/// <summary>
/// Response model for successful registration.
/// </summary>
public record RegisterResponse(Guid UserId);

/// <summary>
/// Request model for user login.
/// </summary>
public record LoginRequest(string Email, string Password);

/// <summary>
/// Response model for successful login.
/// </summary>
public record LoginResponse(string Token, Guid UserId);

/// <summary>
/// Request model for Google OAuth authentication.
/// </summary>
public record GoogleAuthRequest(string GoogleToken);

/// <summary>
/// Response model for successful Google OAuth authentication.
/// </summary>
public record GoogleAuthResponse(string Token, Guid UserId, bool IsNewUser);

/// <summary>
/// Response model for error cases.
/// </summary>
public record ErrorResponse(string Message, string? Code = null);
