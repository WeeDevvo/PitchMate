namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// Optional hardening levers for email + password sign-in, bound from the
/// <c>Auth:SignInProtection</c> configuration section. Both gates are <strong>off by
/// default</strong> for the MVP, so sign-in works without either being configured.
/// <para>
/// <see cref="RequireVerifiedEmail"/> enables the verified-email gate (Requirement 6.4):
/// when set, a sign-in for a user whose email is unverified is rejected with a distinct
/// result. <see cref="LockoutEnabled"/> enables the temporary lockout (Requirement 6.7):
/// once the recorded consecutive failures for an address reach
/// <see cref="MaxFailedAttempts"/> within <see cref="LockoutWindow"/>, further attempts are
/// refused with the same generic authentication-failure result.
/// </para>
/// </summary>
public sealed class SignInProtectionOptions
{
    /// <summary>The configuration section these options bind from.</summary>
    public const string SectionName = "Auth:SignInProtection";

    /// <summary>
    /// When <see langword="true"/>, sign-in requires the user's email to be verified first
    /// and otherwise returns a distinct email-not-verified result (Requirement 6.4).
    /// Defaults to <see langword="false"/>.
    /// </summary>
    public bool RequireVerifiedEmail { get; init; }

    /// <summary>
    /// When <see langword="true"/>, the failed-attempt lockout is enforced (Requirement 6.7).
    /// Defaults to <see langword="false"/>.
    /// </summary>
    public bool LockoutEnabled { get; init; }

    /// <summary>
    /// The number of recent consecutive failures for an address that triggers lockout once
    /// reached, evaluated within <see cref="LockoutWindow"/>. Defaults to 10.
    /// </summary>
    public int MaxFailedAttempts { get; init; } = 10;

    /// <summary>
    /// The rolling window over which failed attempts are counted for lockout. Defaults to
    /// 15 minutes.
    /// </summary>
    public TimeSpan LockoutWindow { get; init; } = TimeSpan.FromMinutes(15);
}
