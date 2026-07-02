using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// A request to link an additional external (non-Password) sign-in method to an
/// already-authenticated account (Requirement 10). Account_Linking is a deliberate,
/// authenticated action: the <paramref name="UserId"/> identifies the requesting,
/// signed-in <c>User</c> resolved from the caller's session, and the
/// <paramref name="Assertion"/> is the raw provider assertion (e.g. a Google OIDC ID
/// token) validated through the <c>IExternalProviderVerifier</c>.
/// <para>
/// <paramref name="UserId"/> may be <see langword="null"/> or empty so a request lacking
/// an authenticated session is reported as an authentication failure rather than throwing
/// (Requirement 10.2); <paramref name="Assertion"/> may be <see langword="null"/> or blank
/// so a malformed assertion is reported as a validation failure (Requirement 10.8).
/// </para>
/// </summary>
/// <param name="UserId">The authenticated requesting user's identifier; <see langword="null"/> when no session is present.</param>
/// <param name="Provider">The external provider whose assertion is being linked; must not be <see cref="AuthProvider.Password"/>.</param>
/// <param name="Assertion">The raw provider assertion to validate.</param>
public sealed record LinkExternalProviderCommand(
    Guid? UserId,
    AuthProvider Provider,
    string? Assertion);
