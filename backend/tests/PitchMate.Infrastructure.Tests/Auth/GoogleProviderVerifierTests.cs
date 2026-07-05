using Microsoft.Extensions.Options;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Domain.Auth;
using PitchMate.Infrastructure.Auth;

namespace PitchMate.Infrastructure.Tests.Auth;

/// <summary>
/// Example (fact/theory) tests for <see cref="GoogleProviderVerifier"/> exercising the rejection paths
/// of the Google (OIDC) assertion verifier (auth-and-identity tasks 5.1/5.2). They assert the verifier's
/// contract that bad input is always reported as a <see cref="AuthErrorCode.AuthenticationFailed"/>
/// failure result and never escapes as a thrown exception.
///
/// <para>
/// <b>Scope and a deliberate limitation.</b> A successful <see cref="Google.Apis.Auth.GoogleJsonWebSignature"/>
/// validation requires a genuinely Google-signed assertion verified against Google's published signing
/// keys, which needs network access and live keys — not something a deterministic unit test can produce.
/// These example tests therefore cover only the rejection paths that are reachable <em>without</em> a
/// valid Google signature:
/// </para>
/// <list type="bullet">
/// <item>an empty/whitespace assertion, rejected before any validation call (Requirement 7.7);</item>
/// <item>a structurally malformed assertion that makes the library raise
/// <see cref="Google.Apis.Auth.InvalidJwtException"/>, which the verifier catches and converts to a
/// failure (Requirements 7.1, 7.7);</item>
/// <item>an assertion handed to the wrong provider, rejected up front (Requirement 7.1).</item>
/// </list>
/// <para>
/// <b>Missing-subject path (Requirement 7.3).</b> The verifier's "validated assertion carries no
/// subject" branch sits <em>after</em> a successful signature/issuer/audience/expiry validation, so it
/// can only be hit with a real Google-signed-but-subjectless token. That is infeasible deterministically
/// here without Google's signing keys (it would require either contacting Google or smuggling in test
/// signing keys, neither of which this layer should do). The branch is exercised by the use-case tests in
/// task 11.x against a fake <see cref="IExternalProviderVerifier"/>. What these example tests pin down is
/// the verifier's invariant that every unverifiable assertion — the only kind reachable offline, and the
/// same failure contract the missing-subject branch returns — yields an
/// <see cref="AuthErrorCode.AuthenticationFailed"/> result and creates no identity.
/// </para>
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class GoogleProviderVerifierTests
{
    private const string TestClientId = "test-client-id.apps.googleusercontent.com";

    private static GoogleProviderVerifier CreateVerifier() =>
        new(Options.Create(new GoogleOptions { ClientId = TestClientId }));

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("   \t  ")]
    public async Task EmptyOrWhitespaceAssertion_IsRejectedAsAuthenticationFailed(string assertion)
    {
        var verifier = CreateVerifier();

        var result = await verifier.ValidateAsync(AuthProvider.Google, assertion, CancellationToken.None);

        AssertAuthenticationFailed(result);
    }

    [Fact]
    public async Task NullAssertion_IsRejectedAsAuthenticationFailed()
    {
        var verifier = CreateVerifier();

        var result = await verifier.ValidateAsync(AuthProvider.Google, null!, CancellationToken.None);

        AssertAuthenticationFailed(result);
    }

    // Each value is a structurally invalid JWT: the wrong number of dot-separated segments makes
    // GoogleJsonWebSignature.ValidateAsync raise InvalidJwtException before any network/key lookup, so the
    // rejection is deterministic and offline. The verifier must catch it and report a failure, not throw
    // (Requirements 7.1, 7.7).
    [Theory]
    [InlineData("not-a-jwt-at-all")]
    [InlineData("only.two")]
    [InlineData("has.four.segments.here")]
    [InlineData(".")]
    [InlineData("..")]
    public async Task MalformedAssertion_IsRejectedAsAuthenticationFailed(string assertion)
    {
        var verifier = CreateVerifier();

        var result = await verifier.ValidateAsync(AuthProvider.Google, assertion, CancellationToken.None);

        AssertAuthenticationFailed(result);
    }

    [Fact]
    public async Task MalformedAssertion_DoesNotThrow()
    {
        var verifier = CreateVerifier();

        // The verifier's contract is that it never throws on a bad assertion; the call below returning a
        // result (rather than raising) is the assertion.
        var result = await verifier.ValidateAsync(
            AuthProvider.Google, "garbage.token.value", CancellationToken.None);

        Assert.False(result.IsSuccess);
    }

    [Theory]
    [InlineData(AuthProvider.Password)]
    [InlineData(AuthProvider.Apple)]
    public async Task AssertionForNonGoogleProvider_IsRejectedAsAuthenticationFailed(AuthProvider provider)
    {
        var verifier = CreateVerifier();

        // Even a non-empty, plausibly-shaped assertion is rejected when the requested provider is not
        // Google — the Google verifier only validates Google assertions (Requirement 7.1).
        var result = await verifier.ValidateAsync(provider, "header.payload.signature", CancellationToken.None);

        AssertAuthenticationFailed(result);
    }

    /// <summary>
    /// Asserts the shared rejection contract: the result is a failure carrying
    /// <see cref="AuthErrorCode.AuthenticationFailed"/> and no <see cref="ExternalIdentity"/> value, so no
    /// identity can be resolved or created from an unverifiable assertion (Requirements 7.1, 7.3, 7.7).
    /// </summary>
    private static void AssertAuthenticationFailed(Result<ExternalIdentity> result)
    {
        Assert.False(result.IsSuccess);
        Assert.Null(result.Value);
        Assert.NotNull(result.Error);
        Assert.Equal(AuthErrorCode.AuthenticationFailed, result.Error!.Code);
    }
}
