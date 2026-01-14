using PitchMate.Application.Services;
using PitchMate.Domain.Entities;
using PitchMate.Domain.Repositories;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Application.Commands.Users;

/// <summary>
/// Handler for AuthenticateWithGoogleCommand.
/// Verifies Google token, creates user if first time, and generates JWT token.
/// </summary>
public class AuthenticateWithGoogleCommandHandler
{
    private readonly IUserRepository _userRepository;
    private readonly IJwtTokenService _jwtTokenService;
    private readonly IGoogleTokenValidator _googleTokenValidator;

    public AuthenticateWithGoogleCommandHandler(
        IUserRepository userRepository,
        IJwtTokenService jwtTokenService,
        IGoogleTokenValidator googleTokenValidator)
    {
        _userRepository = userRepository ?? throw new ArgumentNullException(nameof(userRepository));
        _jwtTokenService = jwtTokenService ?? throw new ArgumentNullException(nameof(jwtTokenService));
        _googleTokenValidator = googleTokenValidator ?? throw new ArgumentNullException(nameof(googleTokenValidator));
    }

    /// <summary>
    /// Handles the AuthenticateWithGoogleCommand.
    /// </summary>
    /// <param name="command">The command containing Google OAuth token.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Result with JWT token and user info on success or error details on failure.</returns>
    public async Task<AuthenticateWithGoogleResult> HandleAsync(
        AuthenticateWithGoogleCommand command, 
        CancellationToken ct = default)
    {
        if (command == null)
            throw new ArgumentNullException(nameof(command));

        if (string.IsNullOrWhiteSpace(command.GoogleToken))
        {
            return new AuthenticateWithGoogleResult(
                UserId: null,
                Token: null,
                Success: false,
                ErrorCode: "AUTH_003",
                ErrorMessage: "Invalid Google token.");
        }

        // Validate Google token
        var googleUserInfo = await _googleTokenValidator.ValidateTokenAsync(command.GoogleToken, ct);
        if (googleUserInfo == null)
        {
            return new AuthenticateWithGoogleResult(
                UserId: null,
                Token: null,
                Success: false,
                ErrorCode: "AUTH_003",
                ErrorMessage: "Invalid Google token.");
        }

        // Validate email format
        Email email;
        try
        {
            email = Email.Create(googleUserInfo.Email);
        }
        catch (ArgumentException)
        {
            return new AuthenticateWithGoogleResult(
                UserId: null,
                Token: null,
                Success: false,
                ErrorCode: "VAL_001",
                ErrorMessage: "Invalid email format from Google.");
        }

        // Check if user already exists by Google ID
        var existingUser = await _userRepository.GetByGoogleIdAsync(googleUserInfo.GoogleId, ct);
        
        bool isNewUser = false;
        User user;

        if (existingUser == null)
        {
            // Check if email is already registered with password auth
            var userByEmail = await _userRepository.GetByEmailAsync(email, ct);
            if (userByEmail != null)
            {
                return new AuthenticateWithGoogleResult(
                    UserId: null,
                    Token: null,
                    Success: false,
                    ErrorCode: "AUTH_002",
                    ErrorMessage: "Email already registered with password authentication.");
            }

            // Create new user with Google OAuth
            user = User.CreateWithGoogle(email, googleUserInfo.GoogleId);
            await _userRepository.AddAsync(user, ct);
            isNewUser = true;
        }
        else
        {
            user = existingUser;
        }

        // Generate JWT token
        var token = _jwtTokenService.GenerateToken(user.Id, user.Email);

        return new AuthenticateWithGoogleResult(
            UserId: user.Id,
            Token: token,
            Success: true,
            IsNewUser: isNewUser);
    }
}
