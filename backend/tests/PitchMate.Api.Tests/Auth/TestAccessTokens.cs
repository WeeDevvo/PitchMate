using System.Text;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace PitchMate.Api.Tests.Auth;

/// <summary>
/// Forges access tokens for each rejection cause the uniform-401 property exercises. Tokens are built
/// with the same <see cref="JsonWebTokenHandler"/>, HMAC-SHA256 algorithm, and claim shape the real
/// <c>JwtTokenService</c> uses, so a "correctly signed but expired" token differs from the accepted
/// case only in its <c>exp</c>, and a "wrong key" / "tampered" token only in its signature.
/// </summary>
internal static class TestAccessTokens
{
    private const string SigningAlgorithm = SecurityAlgorithms.HmacSha256;
    private static readonly JsonWebTokenHandler Handler = new();

    /// <summary>
    /// A well-formed, correctly-signed token whose lifetime is valid at <see cref="AuthApiTestConfig.FixedNow"/>.
    /// Used as the basis for the tampered-signature case (a valid token with its signature mutated).
    /// </summary>
    public static string ValidToken(Guid subject) =>
        CreateToken(subject, AuthApiTestConfig.SigningKey, notBeforeOffset: TimeSpan.FromMinutes(-1), expiresOffset: TimeSpan.FromMinutes(15));

    /// <summary>
    /// A correctly-signed token whose <c>exp</c> is one minute before the pinned clock, so the
    /// zero-skew lifetime check rejects it as expired.
    /// </summary>
    public static string ExpiredToken(Guid subject) =>
        CreateToken(subject, AuthApiTestConfig.SigningKey, notBeforeOffset: TimeSpan.FromMinutes(-30), expiresOffset: TimeSpan.FromMinutes(-1));

    /// <summary>
    /// A token with valid claims and lifetime but signed with a different key, so signature validation
    /// against the configured key fails.
    /// </summary>
    public static string WrongKeyToken(Guid subject) =>
        CreateToken(subject, AuthApiTestConfig.WrongSigningKey, notBeforeOffset: TimeSpan.FromMinutes(-1), expiresOffset: TimeSpan.FromMinutes(15));

    /// <summary>
    /// A valid token whose signature segment has been mutated, so it is well-formed and unexpired but
    /// its signature no longer verifies.
    /// </summary>
    public static string TamperedToken(Guid subject) => Tamper(ValidToken(subject));

    private static string CreateToken(Guid subject, string signingKey, TimeSpan notBeforeOffset, TimeSpan expiresOffset)
    {
        DateTimeOffset now = AuthApiTestConfig.FixedNow;
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey));

        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = AuthApiTestConfig.Issuer,
            Audience = AuthApiTestConfig.Audience,
            IssuedAt = now.UtcDateTime,
            NotBefore = now.Add(notBeforeOffset).UtcDateTime,
            Expires = now.Add(expiresOffset).UtcDateTime,
            SigningCredentials = new SigningCredentials(key, SigningAlgorithm),
            Claims = new Dictionary<string, object>
            {
                [JwtRegisteredClaimNames.Sub] = subject.ToString(),
            },
        };

        return Handler.CreateToken(descriptor);
    }

    /// <summary>
    /// Mutates the signature segment of a compact JWS so its signature no longer verifies while it
    /// stays well-formed (three dot-separated segments). Flipping the first signature character
    /// changes the top bits of the first signature byte, guaranteeing a different signature.
    /// </summary>
    private static string Tamper(string token)
    {
        string[] parts = token.Split('.');
        string signature = parts[2];
        char first = signature[0];
        char replacement = first == 'A' ? 'B' : 'A';
        parts[2] = replacement + signature[1..];
        return string.Join('.', parts);
    }
}
