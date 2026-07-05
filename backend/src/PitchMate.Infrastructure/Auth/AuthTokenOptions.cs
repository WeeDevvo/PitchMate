namespace PitchMate.Infrastructure.Auth;

/// <summary>
/// Configuration for access- and refresh-token issuance and verification, bound from the
/// <c>Auth:Token</c> configuration section. The signing key and other secrets come from
/// user-secrets locally and the platform secret store in the cloud, never from source
/// (Requirements 15.1, 15.5). The Api binds and validates these at startup so an absent or
/// empty signing key, a missing issuer/audience, or a non-positive lifetime fails fast
/// (Requirements 15.2, 15.3, 15.4).
/// </summary>
public sealed class AuthTokenOptions
{
    /// <summary>The configuration section these options bind from.</summary>
    public const string SectionName = "Auth:Token";

    /// <summary>
    /// The symmetric HMAC-SHA256 signing key. Secret; supplied via user-secrets or the platform
    /// secret store and validated as non-empty at startup (Requirement 15.2).
    /// </summary>
    public string SigningKey { get; init; } = "";

    /// <summary>The issuer (<c>iss</c>) claim stamped on, and required when verifying, access tokens.</summary>
    public string Issuer { get; init; } = "";

    /// <summary>The audience (<c>aud</c>) claim stamped on, and required when verifying, access tokens.</summary>
    public string Audience { get; init; } = "";

    /// <summary>
    /// The lifetime applied to issued access tokens; expiry is the issue instant plus this value.
    /// Short by design, defaulting to 15 minutes (Requirements 8.2, 15.7).
    /// </summary>
    public TimeSpan AccessTokenLifetime { get; init; } = TimeSpan.FromMinutes(15);

    /// <summary>
    /// The lifetime applied to issued refresh tokens, defaulting to 30 days (Requirements 9.1, 15.7).
    /// </summary>
    public TimeSpan RefreshTokenLifetime { get; init; } = TimeSpan.FromDays(30);
}
