using PitchMate.Domain.ValueObjects;

namespace PitchMate.Application.Commands.Users;

/// <summary>
/// Command to create a new user with email and password authentication.
/// </summary>
public record CreateUserCommand(string Email, string Password);

/// <summary>
/// Result of user creation command.
/// </summary>
public record CreateUserResult(UserId UserId, bool Success, string? ErrorCode = null, string? ErrorMessage = null);
