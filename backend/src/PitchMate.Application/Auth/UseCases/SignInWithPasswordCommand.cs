namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// A request to sign in with an email address and password (Requirement 6). Both values may
/// be <see langword="null"/> so a missing or malformed email or an empty password is reported
/// as a distinct input-validation failure rather than throwing, and without performing any
/// password-hash verification (Requirement 6.3).
/// </summary>
/// <param name="Email">The raw email address to sign in with; normalised by the handler.</param>
/// <param name="Password">The raw plaintext password to verify.</param>
public sealed record SignInWithPasswordCommand(string? Email, string? Password);
