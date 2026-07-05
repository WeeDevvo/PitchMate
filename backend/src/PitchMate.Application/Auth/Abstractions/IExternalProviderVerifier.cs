using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.Abstractions;

/// <summary>
/// Verifies a federated sign-in assertion (e.g. a Google ID token) for a given
/// <see cref="AuthProvider"/> and, on success, projects it to a trusted <see cref="ExternalIdentity"/>.
/// Implemented in Infrastructure where provider SDKs and network calls live, keeping external-provider
/// logic out of the Application and Api layers (Requirements 7.10, 12.2).
/// </summary>
public interface IExternalProviderVerifier
{
    /// <summary>
    /// Validates <paramref name="assertion"/> against <paramref name="provider"/>, returning the
    /// resolved external identity on success or an <see cref="AuthError"/> when the assertion fails
    /// signature/issuer/audience/expiry checks or carries no subject (Requirements 7.1, 7.3, 7.7).
    /// </summary>
    Task<Result<ExternalIdentity>> ValidateAsync(
        AuthProvider provider, string assertion, CancellationToken cancellationToken);
}
