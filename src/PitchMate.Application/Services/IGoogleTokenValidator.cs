namespace PitchMate.Application.Services;

/// <summary>
/// Service interface for Google OAuth token validation.
/// Abstracts Google token verification logic from command handlers.
/// </summary>
public interface IGoogleTokenValidator
{
    /// <summary>
    /// Validates a Google OAuth token and extracts user information.
    /// </summary>
    /// <param name="token">The Google OAuth token to validate.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Google user info if valid, null if invalid.</returns>
    Task<GoogleUserInfo?> ValidateTokenAsync(string token, CancellationToken ct = default);
}

/// <summary>
/// Information extracted from a validated Google OAuth token.
/// </summary>
public record GoogleUserInfo(string GoogleId, string Email);
