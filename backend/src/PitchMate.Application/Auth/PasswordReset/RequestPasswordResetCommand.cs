namespace PitchMate.Application.Auth.PasswordReset;

/// <summary>
/// A request to begin a password reset for the supplied <paramref name="Email"/>. The
/// email is the raw value as entered by the caller; the handler normalises it before
/// resolving a Password identity. The outcome is deliberately uniform regardless of
/// whether the email maps to an account (Requirement 5.2).
/// </summary>
/// <param name="Email">The raw email address the reset was requested for.</param>
public sealed record RequestPasswordResetCommand(string Email);
