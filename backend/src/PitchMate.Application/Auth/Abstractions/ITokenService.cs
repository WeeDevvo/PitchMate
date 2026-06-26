using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.Abstractions;

/// <summary>
/// Issues and validates the access/refresh token pair backing a session. Implemented in
/// Infrastructure (JWT + HMAC); the Application layer depends only on this abstraction so token
/// formats and signing concerns never leak inward (Requirements 8.8, 12.2).
/// </summary>
public interface ITokenService
{
    /// <summary>
    /// Issues a signed, short-lived access token for <paramref name="user"/>, carrying the subject
    /// claim and an absolute expiry derived from the clock and configured lifetime (Requirement 8.x).
    /// </summary>
    AccessTokenResult IssueAccessToken(User user);

    /// <summary>
    /// Validates a presented access token, returning a <see cref="AccessTokenValidation"/> verdict.
    /// Never throws on malformed, expired, tampered, or null input (Requirement 8.x).
    /// </summary>
    AccessTokenValidation ValidateAccessToken(string? token);

    /// <summary>
    /// Generates a fresh opaque refresh-token secret together with the one-way hash to persist; the
    /// plaintext is returned to the caller exactly once and never stored (Requirement 9.x).
    /// </summary>
    RefreshTokenSecret GenerateRefreshToken();
}
