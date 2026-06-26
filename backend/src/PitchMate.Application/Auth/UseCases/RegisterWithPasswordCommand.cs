namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// A request to register a new account with an email address and password
/// (Requirement 2). The <paramref name="Email"/> is normalised and validated and the
/// <paramref name="Password"/> is checked against the password-strength policy by the
/// handler; both may be <see langword="null"/> so malformed input is reported as a
/// validation failure rather than throwing.
/// </summary>
/// <param name="Email">The raw email address to register; normalised by the handler.</param>
/// <param name="Password">The raw plaintext password; validated against the password policy.</param>
/// <param name="DisplayName">
/// An optional squad-facing display name. When absent or blank, the handler derives one
/// from the email's local part so a registration can succeed from email and password
/// alone.
/// </param>
public sealed record RegisterWithPasswordCommand(
    string? Email,
    string? Password,
    string? DisplayName = null);
