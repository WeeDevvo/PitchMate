using PitchMate.Application.Services;
using PitchMate.Domain.Repositories;
using PitchMate.Domain.ValueObjects;
using BCrypt.Net;

namespace PitchMate.Application.Commands.Users;

/// <summary>
/// Handler for AuthenticateUserCommand.
/// Validates credentials and generates JWT token on success.
/// </summary>
public class AuthenticateUserCommandHandler
{
    private readonly IUserRepository _userRepository;
    private readonly IJwtTokenService _jwtTokenService;

    public AuthenticateUserCommandHandler(
        IUserRepository userRepository,
        IJwtTokenService jwtTokenService)
    {
        _userRepository = userRepository ?? throw new ArgumentNullException(nameof(userRepository));
        _jwtTokenService = jwtTokenService ?? throw new ArgumentNullException(nameof(jwtTokenService));
    }

    /// <summary>
    /// Handles the AuthenticateUserCommand.
    /// </summary>
    /// <param name="command">The command containing email and password.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Result with JWT token on success or error details on failure.</returns>
    public async Task<AuthenticateUserResult> HandleAsync(
        AuthenticateUserCommand command, 
        CancellationToken ct = default)
    {
        if (command == null)
            throw new ArgumentNullException(nameof(command));

        // Validate email format
        Email email;
        try
        {
            email = Email.Create(command.Email);
        }
        catch (ArgumentException)
        {
            return new AuthenticateUserResult(
                UserId: null,
                Token: null,
                Success: false,
                ErrorCode: "AUTH_001",
                ErrorMessage: "Invalid credentials.");
        }

        // Retrieve user by email
        var user = await _userRepository.GetByEmailAsync(email, ct);
        if (user == null)
        {
            return new AuthenticateUserResult(
                UserId: null,
                Token: null,
                Success: false,
                ErrorCode: "AUTH_001",
                ErrorMessage: "Invalid credentials.");
        }

        // Verify user has password authentication (not Google OAuth)
        if (string.IsNullOrEmpty(user.PasswordHash))
        {
            return new AuthenticateUserResult(
                UserId: null,
                Token: null,
                Success: false,
                ErrorCode: "AUTH_001",
                ErrorMessage: "Invalid credentials.");
        }

        // Verify password
        if (string.IsNullOrWhiteSpace(command.Password))
        {
            return new AuthenticateUserResult(
                UserId: null,
                Token: null,
                Success: false,
                ErrorCode: "AUTH_001",
                ErrorMessage: "Invalid credentials.");
        }

        var passwordValid = BCrypt.Net.BCrypt.Verify(command.Password, user.PasswordHash);
        if (!passwordValid)
        {
            return new AuthenticateUserResult(
                UserId: null,
                Token: null,
                Success: false,
                ErrorCode: "AUTH_001",
                ErrorMessage: "Invalid credentials.");
        }

        // Generate JWT token
        var token = _jwtTokenService.GenerateToken(user.Id, user.Email);

        return new AuthenticateUserResult(
            UserId: user.Id,
            Token: token,
            Success: true);
    }
}
