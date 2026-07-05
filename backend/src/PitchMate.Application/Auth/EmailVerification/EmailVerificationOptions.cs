namespace PitchMate.Application.Auth.EmailVerification;

/// <summary>
/// Configuration for email-verification token issuance, bound from the
/// <c>Auth:EmailVerification</c> configuration section. The single setting is the token
/// validity period, which the Auth_System requires be configurable between 1 hour and
/// 7 days with a default of 24 hours (Requirement 4.1). The Api binds and validates these
/// at startup so a lifetime outside the permitted range fails fast (task 14.1, Requirement 15.4);
/// the <see cref="MinTokenLifetime"/>/<see cref="MaxTokenLifetime"/> bounds define that range.
/// </summary>
public sealed class EmailVerificationOptions
{
    /// <summary>The configuration section these options bind from.</summary>
    public const string SectionName = "Auth:EmailVerification";

    /// <summary>The smallest permitted verification-token lifetime (1 hour).</summary>
    public static readonly TimeSpan MinTokenLifetime = TimeSpan.FromHours(1);

    /// <summary>The largest permitted verification-token lifetime (7 days).</summary>
    public static readonly TimeSpan MaxTokenLifetime = TimeSpan.FromDays(7);

    /// <summary>
    /// The validity period applied to an issued <c>EmailVerificationToken</c>; the token's
    /// expiry is the issue instant read from the Clock plus this value. Configurable within
    /// <see cref="MinTokenLifetime"/>..<see cref="MaxTokenLifetime"/>, defaulting to 24 hours
    /// (Requirement 4.1).
    /// </summary>
    public TimeSpan TokenLifetime { get; init; } = TimeSpan.FromHours(24);
}
