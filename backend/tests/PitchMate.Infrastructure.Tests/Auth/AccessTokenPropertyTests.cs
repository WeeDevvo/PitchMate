using FsCheck;
using FsCheck.Xunit;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;
using Microsoft.IdentityModel.JsonWebTokens;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Domain.Auth;
using PitchMate.Infrastructure.Auth;

namespace PitchMate.Infrastructure.Tests.Auth;

/// <summary>
/// Property-based tests for <see cref="JwtTokenService"/> (the Infrastructure <see cref="ITokenService"/>),
/// covering the access-token half of design Properties 16–19. All four properties share the same
/// subject-under-test, the same options/user/clock generators, and a controllable
/// <see cref="FakeTimeProvider"/> so issuance and verification instants are deterministic and the
/// zero-clock-skew boundary can be hit exactly.
///
/// <para>
/// Generators produce only valid <see cref="AuthTokenOptions"/>: a signing key of at least 32 bytes
/// (256 bits, the HMAC-SHA256 minimum), a non-empty issuer and audience, and a strictly positive
/// access-token lifetime. Clock instants are whole-second UTC instants so the JWT's second-resolution
/// <c>iat</c>/<c>exp</c> claims line up exactly with the controlled clock and the
/// <see cref="AccessTokenResult.ExpiresAt"/> value.
/// </para>
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class AccessTokenPropertyTests
{
    /// <summary>Maximum generated access-token lifetime: 30 days in seconds.</summary>
    private const int MaxLifetimeSeconds = 2_592_000;

    /// <summary>Whole-second UTC anchor the clock generator offsets from (2000-01-01).</summary>
    private static readonly DateTimeOffset Epoch = new(2000, 1, 1, 0, 0, 0, TimeSpan.Zero);

    // Feature: auth-and-identity, Property 16: Access-token issue-then-verify round trip.
    // For any user, verifying the access token at any instant before its expiry accepts the token and
    // resolves the identical user identity encoded at issuance.
    // **Validates: Requirements 8.3, 8.7**
    [Property(MaxTest = 100)]
    [Trait("Property", "16")]
    public Property IssueThenVerifyBeforeExpiryResolvesTheSameUser()
    {
        return Prop.ForAll(Arb.From(RoundTripCaseGen()), testCase =>
        {
            var (user, options, issuedAtInstant, verifyDeltaSeconds) = testCase;

            var clock = new FakeTimeProvider(issuedAtInstant);
            var service = CreateService(options, clock);

            var issued = service.IssueAccessToken(user);

            // Verify at some instant within [issuedAt, expiry): still valid.
            clock.SetUtcNow(issuedAtInstant.AddSeconds(verifyDeltaSeconds));
            var validation = service.ValidateAccessToken(issued.Token);

            return (validation.Status == AccessTokenStatus.Valid && validation.UserId == user.Id)
                .Classify(verifyDeltaSeconds == 0, "verified at the issue instant");
        });
    }

    // Feature: auth-and-identity, Property 17: Access-token claims are constructed from the clock and configuration.
    // For any user, the issued token carries sub = user id, iss/aud = configuration, iat = clock now, and
    // exp = iat + configured lifetime; AccessTokenResult.ExpiresAt equals iat + lifetime.
    // **Validates: Requirements 8.1, 15.7**
    [Property(MaxTest = 100)]
    [Trait("Property", "17")]
    public Property IssuedTokenClaimsReflectTheClockAndConfiguration()
    {
        return Prop.ForAll(Arb.From(ClaimCaseGen()), testCase =>
        {
            var (user, options, issuedAtInstant) = testCase;

            var clock = new FakeTimeProvider(issuedAtInstant);
            var service = CreateService(options, clock);

            var issued = service.IssueAccessToken(user);
            var jwt = new JsonWebToken(issued.Token);

            var expectedExpiry = issuedAtInstant.Add(options.AccessTokenLifetime);

            var subjectIsUserId = jwt.Subject == user.Id.ToString();
            var issuerMatchesConfig = jwt.Issuer == options.Issuer;
            var audienceMatchesConfig = jwt.Audiences.Contains(options.Audience);
            var issuedAtIsClockNow = jwt.IssuedAt == issuedAtInstant.UtcDateTime;
            var expiryIsIssuedAtPlusLifetime = jwt.ValidTo == expectedExpiry.UtcDateTime;
            var resultExpiresAtIsIssuedAtPlusLifetime = issued.ExpiresAt == expectedExpiry;

            return subjectIsUserId
                && issuerMatchesConfig
                && audienceMatchesConfig
                && issuedAtIsClockNow
                && expiryIsIssuedAtPlusLifetime
                && resultExpiresAtIsIssuedAtPlusLifetime;
        });
    }

    // Feature: auth-and-identity, Property 18: Expired access tokens are rejected with zero clock skew.
    // For any token issued at t0 with lifetime L, validating it at exactly t0+L (zero skew) and at any
    // instant after t0+L yields Expired and resolves no user id.
    // **Validates: Requirements 8.4**
    [Property(MaxTest = 100)]
    [Trait("Property", "18")]
    public Property ExpiredTokensAreRejectedWithZeroClockSkew()
    {
        return Prop.ForAll(Arb.From(ExpiredCaseGen()), testCase =>
        {
            var (user, options, issuedAtInstant, extraSeconds) = testCase;

            var clock = new FakeTimeProvider(issuedAtInstant);
            var service = CreateService(options, clock);

            var issued = service.IssueAccessToken(user);
            var expiry = issuedAtInstant.Add(options.AccessTokenLifetime);

            // Exactly at the expiry instant: with ClockSkew = 0 this is Expired, never Valid.
            clock.SetUtcNow(expiry);
            var atExpiry = service.ValidateAccessToken(issued.Token);

            // Any instant strictly after expiry is likewise Expired.
            clock.SetUtcNow(expiry.AddSeconds(extraSeconds));
            var afterExpiry = service.ValidateAccessToken(issued.Token);

            return IsExpiredWithNoUser(atExpiry) && IsExpiredWithNoUser(afterExpiry);
        });
    }

    // Feature: auth-and-identity, Property 19: Tampered or mis-targeted access tokens are rejected.
    // For any token verified within its lifetime (so it is not merely Expired): a wrong signing key, a
    // mutated token string, a mismatched issuer, and a mismatched audience each yield Invalid and resolve
    // no user id.
    // **Validates: Requirements 8.5**
    [Property(MaxTest = 100)]
    [Trait("Property", "19")]
    public Property TamperedOrMisTargetedTokensAreRejected()
    {
        return Prop.ForAll(Arb.From(TamperCaseGen()), testCase =>
        {
            var (user, signingKey, issuer, audience, lifetimeSeconds, issuedAtInstant) = testCase;

            var lifetime = TimeSpan.FromSeconds(lifetimeSeconds);
            var clock = new FakeTimeProvider(issuedAtInstant);

            // Issue a genuine token; the clock stays at the issue instant so every validation below is
            // well within the token's lifetime and any rejection is Invalid (mis-targeting/tampering),
            // never Expired.
            var issuingService = CreateService(BuildOptions(signingKey, issuer, audience, lifetime), clock);
            var token = issuingService.IssueAccessToken(user).Token;

            // Wrong signing key (same issuer/audience): signature does not validate.
            var wrongKey = CreateService(BuildOptions(signingKey + "ZZ", issuer, audience, lifetime), clock)
                .ValidateAccessToken(token);

            // Mismatched issuer (same key/audience): issuer claim does not match the configured issuer.
            var wrongIssuer = CreateService(BuildOptions(signingKey, issuer + "-alt", audience, lifetime), clock)
                .ValidateAccessToken(token);

            // Mismatched audience (same key/issuer): audience claim does not match the configured audience.
            var wrongAudience = CreateService(BuildOptions(signingKey, issuer, audience + "-alt", lifetime), clock)
                .ValidateAccessToken(token);

            // Mutated token string (signature byte flipped): the genuine service rejects it.
            var mutated = issuingService.ValidateAccessToken(MutateSignature(token));

            return IsInvalidWithNoUser(wrongKey)
                && IsInvalidWithNoUser(wrongIssuer)
                && IsInvalidWithNoUser(wrongAudience)
                && IsInvalidWithNoUser(mutated);
        });
    }

    // --- Verdict helpers ---

    private static bool IsExpiredWithNoUser(AccessTokenValidation validation) =>
        validation.Status == AccessTokenStatus.Expired && validation.UserId is null;

    private static bool IsInvalidWithNoUser(AccessTokenValidation validation) =>
        validation.Status == AccessTokenStatus.Invalid && validation.UserId is null;

    // --- Subject-under-test construction ---

    /// <summary>
    /// Builds a <see cref="JwtTokenService"/> over the supplied options and clock. Refresh-token
    /// generation is irrelevant to these access-token properties, so the real opaque-secret primitives
    /// are supplied to satisfy the constructor.
    /// </summary>
    private static JwtTokenService CreateService(AuthTokenOptions options, TimeProvider clock) =>
        new(Options.Create(options), clock, new RandomSecretTokenGenerator(), new Sha256SecretHasher());

    private static AuthTokenOptions BuildOptions(string signingKey, string issuer, string audience, TimeSpan lifetime) =>
        new()
        {
            SigningKey = signingKey,
            Issuer = issuer,
            Audience = audience,
            AccessTokenLifetime = lifetime,
        };

    /// <summary>
    /// Flips one character of the JWT signature segment, producing a same-shaped token whose signature
    /// no longer validates against the issuing key.
    /// </summary>
    private static string MutateSignature(string token)
    {
        var parts = token.Split('.');
        var signature = parts[2];
        var replacement = signature[0] == 'A' ? 'B' : 'A';
        parts[2] = replacement + signature[1..];
        return string.Join('.', parts);
    }

    // --- Generators ---

    private static Gen<(User User, AuthTokenOptions Options, DateTimeOffset IssuedAt, int VerifyDeltaSeconds)> RoundTripCaseGen() =>
        from user in UserGen()
        from options in OptionsGen()
        from issuedAt in ClockInstantGen()
        // Some instant within [issuedAt, expiry): delta in [0, lifetime - 1] seconds.
        from verifyDelta in Gen.Choose(0, (int)options.AccessTokenLifetime.TotalSeconds - 1)
        select (user, options, issuedAt, verifyDelta);

    private static Gen<(User User, AuthTokenOptions Options, DateTimeOffset IssuedAt)> ClaimCaseGen() =>
        from user in UserGen()
        from options in OptionsGen()
        from issuedAt in ClockInstantGen()
        select (user, options, issuedAt);

    private static Gen<(User User, AuthTokenOptions Options, DateTimeOffset IssuedAt, int ExtraSeconds)> ExpiredCaseGen() =>
        from user in UserGen()
        from options in OptionsGen()
        from issuedAt in ClockInstantGen()
        // Additional seconds past the expiry instant (>= 0; 0 lands exactly on expiry).
        from extra in Gen.Choose(0, MaxLifetimeSeconds)
        select (user, options, issuedAt, extra);

    private static Gen<(User User, string SigningKey, string Issuer, string Audience, int LifetimeSeconds, DateTimeOffset IssuedAt)> TamperCaseGen() =>
        from user in UserGen()
        from signingKey in SigningKeyGen()
        from issuer in LabelGen()
        from audience in LabelGen()
        from lifetimeSeconds in Gen.Choose(1, MaxLifetimeSeconds)
        from issuedAt in ClockInstantGen()
        select (user, signingKey, issuer, audience, lifetimeSeconds, issuedAt);

    /// <summary>Generates valid token options: 256-bit+ key, non-empty issuer/audience, positive lifetime.</summary>
    private static Gen<AuthTokenOptions> OptionsGen() =>
        from signingKey in SigningKeyGen()
        from issuer in LabelGen()
        from audience in LabelGen()
        from lifetimeSeconds in Gen.Choose(1, MaxLifetimeSeconds)
        select BuildOptions(signingKey, issuer, audience, TimeSpan.FromSeconds(lifetimeSeconds));

    /// <summary>Generates a <see cref="User"/> with a valid display name (1–100) and non-empty email.</summary>
    private static Gen<User> UserGen() =>
        from displayName in LabelGen()
        from local in LabelGen()
        from domain in LabelGen()
        select User.Create(Truncate(displayName, 100), $"{Truncate(local, 30)}@{Truncate(domain, 30)}.test");

    /// <summary>
    /// Generates a signing key of at least 32 ASCII bytes (256 bits), the HMAC-SHA256 minimum, padding
    /// shorter random strings up to length so every generated key is a valid HMAC key.
    /// </summary>
    private static Gen<string> SigningKeyGen() =>
        NonEmptyAlnumGen().Select(s => s.Length >= 32 ? s : s.PadRight(32, 'x'));

    /// <summary>Generates a non-empty alphanumeric label for issuer/audience/name fields.</summary>
    private static Gen<string> LabelGen() => NonEmptyAlnumGen();

    private static Gen<string> NonEmptyAlnumGen() =>
        Gen.NonEmptyListOf(AlnumCharGen()).Select(chars => new string(chars.ToArray()));

    private static Gen<char> AlnumCharGen() =>
        Gen.OneOf(
            Gen.Choose('a', 'z').Select(code => (char)code),
            Gen.Choose('A', 'Z').Select(code => (char)code),
            Gen.Choose('0', '9').Select(code => (char)code));

    /// <summary>Generates a whole-second UTC instant spanning roughly 2000–2099.</summary>
    private static Gen<DateTimeOffset> ClockInstantGen() =>
        from days in Gen.Choose(0, 36_500)
        from secondsIntoDay in Gen.Choose(0, 86_399)
        select Epoch.AddDays(days).AddSeconds(secondsIntoDay);

    private static string Truncate(string value, int maxLength) =>
        value.Length <= maxLength ? value : value[..maxLength];
}
