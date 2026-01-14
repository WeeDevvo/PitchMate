using PitchMate.Domain.ValueObjects;

namespace PitchMate.Application.Commands.Users;

/// <summary>
/// Command to authenticate a user with Google OAuth.
/// </summary>
public record AuthenticateWithGoogleCommand(string GoogleToken);

/// <summary>
/// Result of Google OAuth authentication command.
/// </summary>
public record AuthenticateWithGoogleResult(
    UserId? UserId, 
    string? Token, 
    bool Success, 
    bool IsNewUser = false,
    string? ErrorCode = null, 
    string? ErrorMessage = null);
