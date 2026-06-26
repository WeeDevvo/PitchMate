using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Domain.Auth;

namespace PitchMate.Infrastructure.Auth;

/// <summary>
/// <see cref="ITokenService"/> implementation that issues and verifies access tokens as signed JWTs
/// (HMAC-SHA256) and produces opaque refresh-token secrets. It uses
/// <see cref="JsonWebTokenHandler"/> configured with <see cref="TimeSpan.Zero"/> clock skew so expiry
/// is judged against the injected <see cref="TimeProvider"/> with no hidden tolerance
/// (Requirements 8.1–8.7, 15.7). Token formats and signing concerns live entirely here in
/// Infrastructure, behind the Application abstraction (Requirements 8.8, 12.3).
/// </summary>
/// <remarks>
/// Refresh-token generation reuses the shared <see cref="ISecretTokenGenerator"/> and
/// <see cref="ISecretHasher"/> primitives so the entropy source and one-way hashing of opaque
/// secrets are defined once (Requirements 9.1, 9.6).
/// </remarks>
public sealed class JwtTokenService : ITokenService
{
    private const string SigningAlgorithm = SecurityAlgorithms.HmacSha256;

    private readonly AuthTokenOptions _options;
    private readonly TimeProvider _timeProvider;
    private readonly ISecretTokenGenerator _tokenGenerator;
    private readonly ISecretHasher _secretHasher;
    private readonly SymmetricSecurityKey _signingKey;
    private readonly SigningCredentials _signingCredentials;
    private readonly JsonWebTokenHandler _handler = new();

    /// <summary>
    /// Creates the token service from the validated <paramref name="options"/>, the injected
    /// <paramref name="timeProvider"/> clock, and the shared opaque-secret primitives.
    /// </summary>
    public JwtTokenService(
        IOptions<AuthTokenOptions> options,
        TimeProvider timeProvider,
        ISecretTokenGenerator tokenGenerator,
        ISecretHasher secretHasher)
    {
        ArgumentNullException.ThrowIfNull(options);
        _options = options.Value;
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _tokenGenerator = tokenGenerator ?? throw new ArgumentNullException(nameof(tokenGenerator));
        _secretHasher = secretHasher ?? throw new ArgumentNullException(nameof(secretHasher));

        _signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.SigningKey));
        _signingCredentials = new SigningCredentials(_signingKey, SigningAlgorithm);
    }

    /// <inheritdoc />
    public AccessTokenResult IssueAccessToken(User user)
    {
        ArgumentNullException.ThrowIfNull(user);

        var issuedAt = _timeProvider.GetUtcNow();
        var expiresAt = issuedAt + _options.AccessTokenLifetime;

        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = _options.Issuer,
            Audience = _options.Audience,
            IssuedAt = issuedAt.UtcDateTime,
            NotBefore = issuedAt.UtcDateTime,
            Expires = expiresAt.UtcDateTime,
            SigningCredentials = _signingCredentials,
            Claims = new Dictionary<string, object>
            {
                [JwtRegisteredClaimNames.Sub] = user.Id.ToString(),
            },
        };

        var token = _handler.CreateToken(descriptor);
        return new AccessTokenResult(token, expiresAt);
    }

    /// <inheritdoc />
    public AccessTokenValidation ValidateAccessToken(string? token)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return new AccessTokenValidation(AccessTokenStatus.Invalid, UserId: null);
        }

        var parameters = BuildValidationParameters();

        // JsonWebTokenHandler exposes only the async validation API. Validating an HMAC-signed token
        // is pure CPU work with no I/O, so it completes synchronously; blocking here cannot deadlock
        // (there is no synchronization context in this layer) and keeps the synchronous ITokenService
        // contract. The handler captures any validation failure on the result rather than throwing.
        TokenValidationResult result = _handler
            .ValidateTokenAsync(token, parameters)
            .GetAwaiter()
            .GetResult();

        if (result.IsValid)
        {
            return new AccessTokenValidation(AccessTokenStatus.Valid, ResolveUserId(result));
        }

        // The custom lifetime validator throws SecurityTokenExpiredException for an in-format,
        // correctly signed token that is past expiry, letting us distinguish Expired from every
        // other (malformed, tampered, wrong key/issuer/audience) Invalid outcome (Requirements 8.4, 8.5).
        var status = result.Exception is SecurityTokenExpiredException
            ? AccessTokenStatus.Expired
            : AccessTokenStatus.Invalid;

        return new AccessTokenValidation(status, UserId: null);
    }

    /// <inheritdoc />
    public RefreshTokenSecret GenerateRefreshToken()
    {
        var plaintext = _tokenGenerator.Generate();
        var hash = _secretHasher.Hash(plaintext);
        return new RefreshTokenSecret(plaintext, hash);
    }

    private TokenValidationParameters BuildValidationParameters() => new()
    {
        ValidateIssuer = true,
        ValidIssuer = _options.Issuer,
        ValidateAudience = true,
        ValidAudience = _options.Audience,
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = _signingKey,
        ValidAlgorithms = [SigningAlgorithm],
        ValidateLifetime = true,
        RequireExpirationTime = true,
        // Zero skew: expiry is judged exactly against the injected clock (Requirement 8.4).
        ClockSkew = TimeSpan.Zero,
        // Drive lifetime validation off the injected TimeProvider rather than DateTime.UtcNow so the
        // clock is controllable and consistent with issuance. Throwing the expired exception (rather
        // than returning false) preserves the Expired-vs-Invalid distinction in the result.
        LifetimeValidator = ValidateLifetimeAgainstClock,
    };

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

        if (!expires.HasValue)
        {
            return false;
        }

        // Expiry at or before the current instant is expired, with no skew tolerance (Requirement 8.4).
        if (now >= expires.Value)
        {
            throw new SecurityTokenExpiredException("The access token has expired.");
        }

        return true;
    }

    private static Guid? ResolveUserId(TokenValidationResult result)
    {
        if (result.Claims is not null
            && result.Claims.TryGetValue(JwtRegisteredClaimNames.Sub, out var value)
            && value is string subject
            && Guid.TryParse(subject, out var userId))
        {
            return userId;
        }

        return null;
    }
}
