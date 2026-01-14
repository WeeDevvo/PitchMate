using PitchMate.Domain.ValueObjects;

namespace PitchMate.Application.Commands.Users;

/// <summary>
/// Command to authenticate a user with email and password.
/// </summary>
public record AuthenticateUserCommand(string Email, string Password);

/// <summary>
/// Result of user authentication command.
/// </summary>
public record AuthenticateUserResult(
    UserId? UserId, 
    string? Token, 
    bool Success, 
    string? ErrorCode = null, 
    string? ErrorMessage = null);
