using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using PitchMate.Application.Auth;
using PitchMate.Infrastructure.Auth;

namespace PitchMate.Api.Auth;

/// <summary>
/// Configures the JWT bearer scheme from the same validated <see cref="AuthTokenOptions"/> the
/// <c>ITokenService</c> uses, so middleware validation and explicit token-service validation agree
/// (Requirement 13.4). The <see cref="TokenValidationParameters"/> pin the issuer, audience, and HMAC
/// signing key, and use <see cref="TimeSpan.Zero"/> clock skew with a lifetime check driven off the
/// injected <see cref="TimeProvider"/> so expiry is judged exactly against the same clock as issuance.
/// <para>
/// The events collapse every failure mode — a missing, expired, malformed, tampered, or wrong-key
/// token — into one uniform <c>401</c> that discloses nothing about which check failed
/// (Requirement 13.5). Because the challenge short-circuits before the protected handler runs, an
/// unauthenticated request changes no state.
/// </para>
/// </summary>
internal sealed class ConfigureJwtBearerOptions : IConfigureNamedOptions<JwtBearerOptions>
{
    private const string SigningAlgorithm = SecurityAlgorithms.HmacSha256;

    private readonly AuthTokenOptions _tokenOptions;
    private readonly TimeProvider _timeProvider;

    /// <summary>
    /// Creates the configurator from the validated token options and the injected clock.
    /// </summary>
    public ConfigureJwtBearerOptions(IOptions<AuthTokenOptions> tokenOptions, TimeProvider timeProvider)
    {
        ArgumentNullException.ThrowIfNull(tokenOptions);
        _tokenOptions = tokenOptions.Value;
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
    }

    /// <inheritdoc />
    public void Configure(JwtBearerOptions options) => Configure(Options.DefaultName, options);

    /// <inheritdoc />
    public void Configure(string? name, JwtBearerOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        // Only the bearer scheme is configured here; ignore any other named options instances.
        if (name != JwtBearerDefaults.AuthenticationScheme)
        {
            return;
        }

        var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_tokenOptions.SigningKey));

        // Never surface the failure reason in the response (defence in depth alongside the uniform
        // challenge below), so missing/expired/tampered tokens are indistinguishable (Requirement 13.5).
        options.IncludeErrorDetails = false;
        options.MapInboundClaims = false;

        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = _tokenOptions.Issuer,
            ValidateAudience = true,
            ValidAudience = _tokenOptions.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = signingKey,
            ValidAlgorithms = [SigningAlgorithm],
            ValidateLifetime = true,
            RequireExpirationTime = true,
            // Zero skew: expiry is judged exactly against the injected clock, matching the token service.
            ClockSkew = TimeSpan.Zero,
            LifetimeValidator = ValidateLifetimeAgainstClock,
        };

        options.Events = new JwtBearerEvents
        {
            // Emit one uniform 401 for every unauthenticated outcome. Handling the response suppresses
            // the default WWW-Authenticate error details so the reason is never disclosed, and the
            // protected handler never runs so no state changes (Requirements 13.4, 13.5).
            OnChallenge = static async context =>
            {
                context.HandleResponse();
                await WriteUnauthenticatedAsync(context.HttpContext);
            },
        };
    }

    private bool ValidateLifetimeAgainstClock(
        DateTime? notBefore,
        DateTime? expires,
        SecurityToken securityToken,
        TokenValidationParameters validationParameters)
    {
        var now = _timeProvider.GetUtcNow().UtcDateTime;

        if (notBefore.HasValue && now < notBefore.Value)
        {
            return false;
        }

        // A token with no expiry, or one at/after the current instant, is not valid (no skew tolerance).
        return expires.HasValue && now < expires.Value;
    }

    /// <summary>
    /// Writes the single "authentication required" problem response shared by the middleware and the
    /// endpoint-level unauthenticated result, so both paths look identical to a client.
    /// </summary>
    private static Task WriteUnauthenticatedAsync(HttpContext httpContext) =>
        Results.Problem(
            detail: "Authentication is required.",
            statusCode: StatusCodes.Status401Unauthorized,
            title: AuthErrorCode.Unauthenticated.ToString(),
            extensions: new Dictionary<string, object?>
            {
                ["code"] = AuthErrorCode.Unauthenticated.ToString(),
            })
        .ExecuteAsync(httpContext);
}
