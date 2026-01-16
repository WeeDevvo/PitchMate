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
    /// Validates a Google OAuth token (ID token or access token) and extracts user information.
    /// </summary>
    /// <param name="token">The Google OAuth token to validate.</param>
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
            // First, try to validate as an ID token (JWT)
            try
            {
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
                // Not a valid JWT, might be an access token - try tokeninfo endpoint
            }

            // Try validating as an access token using Google's tokeninfo endpoint
            using var httpClient = new HttpClient();
            var response = await httpClient.GetAsync(
                $"https://www.googleapis.com/oauth2/v3/tokeninfo?access_token={token}", ct);

            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            var json = await response.Content.ReadAsStringAsync(ct);
            var tokenInfo = System.Text.Json.JsonSerializer.Deserialize<GoogleTokenInfo>(json);

            if (tokenInfo == null || string.IsNullOrEmpty(tokenInfo.Email))
            {
                return null;
            }

            // For access tokens, we need to get the user ID separately
            var userInfoResponse = await httpClient.GetAsync(
                $"https://www.googleapis.com/oauth2/v3/userinfo?access_token={token}", ct);

            if (!userInfoResponse.IsSuccessStatusCode)
            {
                return null;
            }

            var userInfoJson = await userInfoResponse.Content.ReadAsStringAsync(ct);
            var userInfo = System.Text.Json.JsonSerializer.Deserialize<GoogleUserInfoResponse>(userInfoJson);

            if (userInfo == null || string.IsNullOrEmpty(userInfo.Sub))
            {
                return null;
            }

            return new GoogleUserInfo(userInfo.Sub, tokenInfo.Email);
        }
        catch (Exception)
        {
            // Other validation errors
            return null;
        }
    }

    private class GoogleTokenInfo
    {
        public string? Email { get; set; }
        public string? Aud { get; set; }
    }

    private class GoogleUserInfoResponse
    {
        public string? Sub { get; set; }
        public string? Email { get; set; }
    }
}
