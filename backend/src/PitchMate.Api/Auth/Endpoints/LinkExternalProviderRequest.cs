using PitchMate.Domain.Auth;

namespace PitchMate.Api.Auth.Endpoints;

/// <summary>
/// The request body for linking an additional external sign-in method to the authenticated account
/// (Requirement 10.1). The owning user is resolved from the caller's access token, never from the
/// body, so only the external <paramref name="Provider"/> and its raw <paramref name="Assertion"/>
/// are accepted here.
/// </summary>
/// <param name="Provider">The external provider whose assertion is being linked.</param>
/// <param name="Assertion">The raw provider assertion (for example a Google OIDC ID token) to validate.</param>
public sealed record LinkExternalProviderRequest(AuthProvider Provider, string? Assertion);
