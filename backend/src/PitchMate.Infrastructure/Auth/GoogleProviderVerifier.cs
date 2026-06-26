using Google.Apis.Auth;
using Microsoft.Extensions.Options;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Domain.Auth;

namespace PitchMate.Infrastructure.Auth;

/// <summary>
/// <see cref="IExternalProviderVerifier"/> implementation for Google (OIDC) sign-in. It validates a
/// Google ID-token assertion with <see cref="GoogleJsonWebSignature.ValidateAsync(string, GoogleJsonWebSignature.ValidationSettings)"/>,
/// which checks the signature, issuer, and expiry against Google's published keys and enforces the
/// configured client id as the required audience, then projects the verified claims to an
/// <see cref="ExternalIdentity"/> keyed on the stable subject (<c>sub</c>). External-provider validation
/// lives here in Infrastructure behind the Application abstraction (Requirements 7.1, 7.2, 7.3, 7.7, 7.10).
/// </summary>
/// <remarks>
/// The verifier never throws on a bad assertion: a failed signature/issuer/audience/expiry check
/// (surfaced by the library as <see cref="InvalidJwtException"/>), a structurally malformed token the
/// library rejects while parsing (surfaced as <see cref="ArgumentException"/> or a JSON parse error),
/// and a validated assertion that carries no subject all yield an
/// <see cref="AuthErrorCode.AuthenticationFailed"/> failure result, never a thrown exception
/// (Requirements 7.3, 7.7).
/// </remarks>
public sealed class GoogleProviderVerifier : IExternalProviderVerifier
{
    private readonly GoogleOptions _options;

    /// <summary>Creates the verifier from the validated <paramref name="options"/>.</summary>
    public GoogleProviderVerifier(IOptions<GoogleOptions> options)
    {
        ArgumentNullException.ThrowIfNull(options);
        _options = options.Value;
    }

    /// <inheritdoc />
    public async Task<Result<ExternalIdentity>> ValidateAsync(
        AuthProvider provider, string assertion, CancellationToken cancellationToken)
    {
        if (provider != AuthProvider.Google)
        {
            return Result<ExternalIdentity>.Fail(new AuthError(
                AuthErrorCode.AuthenticationFailed,
                $"The Google verifier cannot validate assertions for provider '{provider}'."));
        }

        if (string.IsNullOrWhiteSpace(assertion))
        {
            return Result<ExternalIdentity>.Fail(new AuthError(
                AuthErrorCode.AuthenticationFailed, "The Google assertion was empty."));
        }

        cancellationToken.ThrowIfCancellationRequested();

        var settings = new GoogleJsonWebSignature.ValidationSettings
        {
            // Enforce the configured client id as the required audience so an assertion minted for a
            // different client is rejected (Requirement 7.7). The library validates signature, issuer,
            // and expiry against Google's published keys.
            Audience = [_options.ClientId],
        };

        GoogleJsonWebSignature.Payload payload;
        try
        {
            payload = await GoogleJsonWebSignature.ValidateAsync(assertion, settings)
                .ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Any failure to parse or validate the assertion is an authentication failure, never a
            // thrown exception (Requirements 7.1, 7.7). This covers a failed signature/issuer/audience/
            // expiry check (surfaced by the library as InvalidJwtException) as well as a structurally
            // malformed token the library rejects while parsing — for example a 3-segment token with an
            // empty or non-JSON header, which surfaces as ArgumentException or a JSON parse error rather
            // than InvalidJwtException. Genuine cancellation is allowed to propagate.
            return Result<ExternalIdentity>.Fail(new AuthError(
                AuthErrorCode.AuthenticationFailed, "The Google assertion failed validation."));
        }

        if (string.IsNullOrEmpty(payload.Subject))
        {
            // A validated assertion with no subject cannot resolve a principal (Requirement 7.3).
            return Result<ExternalIdentity>.Fail(new AuthError(
                AuthErrorCode.AuthenticationFailed, "The Google assertion contained no subject."));
        }

        var identity = new ExternalIdentity(
            AuthProvider.Google,
            payload.Subject,
            payload.Email,
            payload.EmailVerified);

        return Result<ExternalIdentity>.Ok(identity);
    }
}
