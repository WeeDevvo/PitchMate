namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// A request to add a Password sign-in method to an already-authenticated account that
/// currently owns none (Requirement 10.5). The <paramref name="UserId"/> identifies the
/// requesting, signed-in <c>User</c> resolved from the caller's session; the
/// <paramref name="Password"/> is the raw plaintext password validated against the
/// password-strength policy. The new identity's provider user id is the user's own
/// normalised email.
/// <para>
/// <paramref name="UserId"/> may be <see langword="null"/> or empty so a request lacking an
/// authenticated session is reported as an authentication failure rather than throwing;
/// <paramref name="Password"/> may be <see langword="null"/> so a policy-violating input is
/// reported as a validation failure (Requirement 10.10).
/// </para>
/// </summary>
/// <param name="UserId">The authenticated requesting user's identifier; <see langword="null"/> when no session is present.</param>
/// <param name="Password">The raw plaintext password; validated against the password policy.</param>
public sealed record AddPasswordCredentialCommand(
    Guid? UserId,
    string? Password);
