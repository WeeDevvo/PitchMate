namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// A request to sign in with Google (Requirement 7): the raw Google assertion (an OIDC ID token)
/// that the <c>IExternalProviderVerifier</c> validates. The value may be <see langword="null"/> or
/// blank so a malformed request is reported as an authentication failure rather than throwing.
/// </summary>
/// <param name="Assertion">The raw Google ID-token assertion to validate.</param>
public sealed record SignInWithGoogleCommand(string? Assertion);
