using Microsoft.AspNetCore.Mvc;
using PitchMate.Application.Commands.Users;
using PitchMate.Domain.Repositories;

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
    private readonly IUserRepository _userRepository;

    public AuthController(
        CreateUserCommandHandler createUserHandler,
        AuthenticateUserCommandHandler authenticateUserHandler,
        AuthenticateWithGoogleCommandHandler authenticateWithGoogleHandler,
        IUserRepository userRepository)
    {
        _createUserHandler = createUserHandler ?? throw new ArgumentNullException(nameof(createUserHandler));
        _authenticateUserHandler = authenticateUserHandler ?? throw new ArgumentNullException(nameof(authenticateUserHandler));
        _authenticateWithGoogleHandler = authenticateWithGoogleHandler ?? throw new ArgumentNullException(nameof(authenticateWithGoogleHandler));
        _userRepository = userRepository ?? throw new ArgumentNullException(nameof(userRepository));
    }

    /// <summary>
    /// Register a new user with email and password.
    /// </summary>
    /// <param name="request">Registration request containing email and password.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>User details and JWT token on success or error details on failure.</returns>
    [HttpPost("register")]
    [ProducesResponseType(typeof(AuthResponse), StatusCodes.Status201Created)]
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

        // Auto-login after successful registration
        var loginCommand = new AuthenticateUserCommand(request.Email, request.Password);
        var loginResult = await _authenticateUserHandler.HandleAsync(loginCommand, ct);

        if (!loginResult.Success)
        {
            // Registration succeeded but login failed - this shouldn't happen
            return StatusCode(500, new ErrorResponse("Registration succeeded but auto-login failed. Please try logging in manually."));
        }

        var userResponse = new UserDto(
            loginResult.UserId!.Value,
            request.Email,
            DateTime.UtcNow
        );

        return CreatedAtAction(
            nameof(Register), 
            new AuthResponse(loginResult.Token!, userResponse));
    }

    /// <summary>
    /// Authenticate a user with email and password.
    /// </summary>
    /// <param name="request">Login request containing email and password.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>JWT token and user details on success or error details on failure.</returns>
    [HttpPost("login")]
    [ProducesResponseType(typeof(AuthResponse), StatusCodes.Status200OK)]
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

        var userResponse = new UserDto(
            result.UserId!.Value,
            request.Email,
            DateTime.UtcNow
        );

        return Ok(new AuthResponse(result.Token!, userResponse));
    }

    /// <summary>
    /// Authenticate a user with Google OAuth.
    /// </summary>
    /// <param name="request">Google OAuth request containing Google token.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>JWT token and user details on success or error details on failure.</returns>
    [HttpPost("google")]
    [ProducesResponseType(typeof(AuthResponse), StatusCodes.Status200OK)]
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

        // Get user details
        var user = await _userRepository.GetByIdAsync(result.UserId!, ct);
        if (user == null)
        {
            return StatusCode(500, new ErrorResponse("User not found after authentication."));
        }

        var userResponse = new UserDto(
            user.Id.Value,
            user.Email.Value,
            user.CreatedAt
        );

        return Ok(new AuthResponse(result.Token!, userResponse));
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
/// Response model for authentication (login/register).
/// </summary>
public record AuthResponse(string Token, UserDto User);

/// <summary>
/// User data transfer object.
/// </summary>
public record UserDto(Guid Id, string Email, DateTime CreatedAt);

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
