using Microsoft.Extensions.Options;
using PitchMate.Api.Auth.Configuration;
using PitchMate.Application.Auth.EmailVerification;
using PitchMate.Application.Auth.PasswordReset;
using PitchMate.Infrastructure.Auth;

namespace PitchMate.Api.Tests.Auth.Startup;

/// <summary>
/// Smoke tests for the fail-fast configuration validators wired by <c>AddAuth</c> (task 14.1). Each
/// validator is exercised directly as an <see cref="IValidateOptions{T}"/>, asserting that a fully
/// valid configuration passes and that an empty signing key, a missing required setting, or a
/// non-positive/out-of-range lifetime yields a <see cref="ValidateOptionsResult.Failed"/> result
/// whose message names the offending configuration key — the same failure that aborts host startup
/// before any request is served.
/// <para>Validates: Requirements 15.2, 15.3, 15.4.</para>
/// </summary>
public sealed class StartupOptionValidatorSmokeTests
{
    // A fully valid AuthTokenOptions the negative cases mutate one field at a time.
    private static AuthTokenOptions ValidTokenOptions(
        string signingKey = "a-signing-key-that-is-at-least-32-bytes-long-000000",
        string issuer = "https://api.pitch-mate.local",
        string audience = "pitchmate-web",
        TimeSpan? accessLifetime = null,
        TimeSpan? refreshLifetime = null) => new()
    {
        SigningKey = signingKey,
        Issuer = issuer,
        Audience = audience,
        AccessTokenLifetime = accessLifetime ?? TimeSpan.FromMinutes(15),
        RefreshTokenLifetime = refreshLifetime ?? TimeSpan.FromDays(30),
    };

    // A fully valid configuration is accepted (guards against the validators being over-eager).
    [Fact]
    public void ValidTokenOptionsSucceed()
    {
        var result = new AuthTokenOptionsValidator().Validate(name: null, ValidTokenOptions());

        Assert.True(result.Succeeded);
    }

    // Requirement 15.2 — an absent or empty signing key aborts startup naming the signing-key setting.
    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void EmptySigningKeyFailsNamingSigningKey(string signingKey)
    {
        var options = ValidTokenOptions(signingKey: signingKey);

        var result = new AuthTokenOptionsValidator().Validate(name: null, options);

        Assert.True(result.Failed);
        Assert.Contains("SigningKey", result.FailureMessage);
    }

    // Requirement 15.3 — a missing issuer aborts startup naming the issuer setting.
    [Fact]
    public void MissingIssuerFailsNamingIssuer()
    {
        var options = ValidTokenOptions(issuer: "");

        var result = new AuthTokenOptionsValidator().Validate(name: null, options);

        Assert.True(result.Failed);
        Assert.Contains("Issuer", result.FailureMessage);
    }

    // Requirement 15.3 — a missing audience aborts startup naming the audience setting.
    [Fact]
    public void MissingAudienceFailsNamingAudience()
    {
        var options = ValidTokenOptions(audience: "");

        var result = new AuthTokenOptionsValidator().Validate(name: null, options);

        Assert.True(result.Failed);
        Assert.Contains("Audience", result.FailureMessage);
    }

    // Requirement 15.3 — the required Google client id aborts startup naming the offending key.
    [Fact]
    public void MissingGoogleClientIdFailsNamingClientId()
    {
        var options = new GoogleOptions { ClientId = "" };

        var result = new GoogleOptionsValidator().Validate(name: null, options);

        Assert.True(result.Failed);
        Assert.Contains("ClientId", result.FailureMessage);
    }

    // Requirement 15.4 — a non-positive access-token lifetime aborts startup naming the offending key.
    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void NonPositiveAccessTokenLifetimeFailsNamingLifetime(int minutes)
    {
        var options = ValidTokenOptions(accessLifetime: TimeSpan.FromMinutes(minutes));

        var result = new AuthTokenOptionsValidator().Validate(name: null, options);

        Assert.True(result.Failed);
        Assert.Contains("AccessTokenLifetime", result.FailureMessage);
    }

    // Requirement 15.4 — a non-positive refresh-token lifetime aborts startup naming the offending key.
    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void NonPositiveRefreshTokenLifetimeFailsNamingLifetime(int minutes)
    {
        var options = ValidTokenOptions(refreshLifetime: TimeSpan.FromMinutes(minutes));

        var result = new AuthTokenOptionsValidator().Validate(name: null, options);

        Assert.True(result.Failed);
        Assert.Contains("RefreshTokenLifetime", result.FailureMessage);
    }

    // Requirement 15.4 — an out-of-range email-verification lifetime aborts startup naming the key.
    [Fact]
    public void OutOfRangeEmailVerificationLifetimeFailsNamingLifetime()
    {
        // Below the permitted one-hour floor.
        var options = new EmailVerificationOptions { TokenLifetime = TimeSpan.FromMinutes(1) };

        var result = new EmailVerificationOptionsValidator().Validate(name: null, options);

        Assert.True(result.Failed);
        Assert.Contains("TokenLifetime", result.FailureMessage);
    }

    // Requirement 15.4 — a non-positive password-reset lifetime aborts startup naming the key.
    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public void NonPositivePasswordResetLifetimeFailsNamingLifetime(int minutes)
    {
        var options = new PasswordResetOptions { TokenLifetime = TimeSpan.FromMinutes(minutes) };

        var result = new PasswordResetOptionsValidator().Validate(name: null, options);

        Assert.True(result.Failed);
        Assert.Contains("TokenLifetime", result.FailureMessage);
    }
}
