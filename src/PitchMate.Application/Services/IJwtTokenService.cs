using PitchMate.Domain.ValueObjects;

namespace PitchMate.Application.Services;

/// <summary>
/// Service interface for JWT token generation.
/// Abstracts token generation logic from command handlers.
/// </summary>
public interface IJwtTokenService
{
    /// <summary>
    /// Generates a JWT token for the specified user.
    /// </summary>
    /// <param name="userId">The user's unique identifier.</param>
    /// <param name="email">The user's email address.</param>
    /// <returns>A JWT token string.</returns>
    string GenerateToken(UserId userId, Email email);
}
