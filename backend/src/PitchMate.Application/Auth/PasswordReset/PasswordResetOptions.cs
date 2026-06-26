namespace PitchMate.Application.Auth.PasswordReset;

/// <summary>
/// Configuration for the password-reset flow, bound from the <c>Auth:PasswordReset</c>
/// configuration section. Lives in the Application layer because the password-reset use
/// cases consume it directly; the Api binds and validates it at startup so a non-positive
/// lifetime or an out-of-range window fails fast (Requirements 5.1, 5.8, 15.x).
/// </summary>
public sealed class PasswordResetOptions
{
    /// <summary>The configuration section these options bind from.</summary>
    public const string SectionName = "Auth:PasswordReset";

    /// <summary>
    /// The lifetime applied to an issued <c>PasswordResetToken</c>; its expiry instant is
    /// the issue instant plus this value. Bounded short by design and never exceeding
    /// 60 minutes (Requirement 5.1). Defaults to 30 minutes.
    /// </summary>
    public TimeSpan TokenLifetime { get; init; } = TimeSpan.FromMinutes(30);

    /// <summary>
    /// The rolling window over which reset requests for a single Password identity are
    /// counted for rate limiting (Requirement 5.8). Defaults to 1 hour.
    /// </summary>
    public TimeSpan RateLimitWindow { get; init; } = TimeSpan.FromHours(1);

    /// <summary>
    /// The maximum number of reset requests accepted for a single Password identity within
    /// <see cref="RateLimitWindow"/>; further requests are silently suppressed behind the
    /// uniform response (Requirement 5.8). Defaults to 5.
    /// </summary>
    public int MaxRequestsPerWindow { get; init; } = 5;
}
