using Google.Apis.Auth;
using Microsoft.Extensions.Configuration;
using PitchMate.Application.Services;

namespace PitchMate.Infrastructure.Services;

/// <summary>
/// Implementation of Google OAuth token validator using Google.Apis.Auth library.
/// Validates Google ID tokens and extracts user information.
/// </summary>
public class GoogleTokenValidator : IGoogleTokenValidator
{
    private readonly string? _clientId;

    public GoogleTokenValidator(IConfiguration configuration)
    {
        _clientId = configuration["Google:ClientId"];
    }

    /// <summary>
    /// Validates a Google OAuth ID token and extracts user information.
    /// </summary>
    /// <param name="token">The Google OAuth ID token to validate.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Google user info if valid, null if invalid.</returns>
    public async Task<GoogleUserInfo?> ValidateTokenAsync(string token, CancellationToken ct = default)
    {
        // If Google OAuth is not configured, return null
        if (string.IsNullOrEmpty(_clientId))
        {
            return null;
        }

        try
        {
            // Validate the token using Google's library
            var payload = await GoogleJsonWebSignature.ValidateAsync(token);
            
            // Verify the token is for our client
            if (payload.Audience != _clientId)
            {
                return null;
            }

            // Verify the token has an email
            if (string.IsNullOrEmpty(payload.Email))
            {
                return null;
            }

            return new GoogleUserInfo(payload.Subject, payload.Email);
        }
        catch (InvalidJwtException)
        {
            // Token is invalid (expired, malformed, wrong signature, etc.)
            return null;
        }
        catch (Exception)
        {
            // Other validation errors
            return null;
        }
    }
}
