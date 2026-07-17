using System.Security.Cryptography;
using System.Text;
using FsCheck.Xunit;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Infrastructure.Squads;

namespace PitchMate.Infrastructure.Tests.Squads;

// Feature: squads-and-membership, Property 23: Invite secret hashing round-trips under fixed-time comparison

/// <summary>
/// Property tests for <see cref="InviteSecretService"/>, covering design Property 23: for any
/// generated invite secret, hashing the presented redeemable token matches the persisted
/// <see cref="InviteSecret.TokenHash"/> under a fixed-time comparison, hashing any different secret
/// does not match, and the persisted hash never equals the plaintext secret.
///
/// The implementation choices these tests assert against (read from source):
///   * <see cref="InviteSecretService.Generate"/> embeds the redeemable token in the link after
///     <c>/join/</c>; the token is the value that hashes to <see cref="InviteSecret.TokenHash"/>.
///   * <see cref="InviteSecretService.Hash"/> returns the SHA-256 digest as standard (padded)
///     Base64, which is always 44 characters for a 32-byte digest.
///   * The <see cref="InviteSecret.Code"/> is 8..12 Crockford base32 characters.
///
/// **Validates: Requirements 10.4**
/// </summary>
public class InviteSecretServiceProperties
{
    /// <summary>Base64 length of a 32-byte SHA-256 digest (ceil(32/3)*4 = 44, including padding).</summary>
    private const int Base64DigestLength = 44;

    private const int Sha256ByteLength = 32;

    private const string JoinLinkPrefix = "https://pitch-mate.co.uk/join/";

    /// <summary>Crockford base32 alphabet (excludes I, L, O, U).</summary>
    private const string CrockfordAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

    private static readonly IInviteSecretService Service = new InviteSecretService();

    /// <summary>
    /// Extracts the redeemable token embedded in the link (the segment after <c>/join/</c>), which is
    /// the real value a redeem handler would hash. Exercising this path keeps the round-trip honest.
    /// </summary>
    private static string ExtractToken(string redeemableLink)
    {
        var idx = redeemableLink.LastIndexOf("/join/", StringComparison.Ordinal);
        return idx < 0 ? redeemableLink : redeemableLink[(idx + "/join/".Length)..];
    }

    // --- Property 23: round-trip under fixed-time comparison ---

    /// <summary>
    /// For a freshly generated invite secret, hashing the redeemable token reproduces the persisted
    /// <see cref="InviteSecret.TokenHash"/>, and a fixed-time comparison over the UTF-8 digest bytes
    /// returns true. The unused driver parameter forces FsCheck to run the body across many (≥100)
    /// independently generated secrets, since <see cref="IInviteSecretService.Generate"/> takes no input.
    /// </summary>
    [Property(MaxTest = 200)]
    public bool HashingTheRedeemableTokenReproducesTheStoredHashUnderFixedTimeCompare(int _)
    {
        var secret = Service.Generate();
        var token = ExtractToken(secret.RedeemableLink);

        var rehash = Service.Hash(token);

        return string.Equals(rehash, secret.TokenHash, StringComparison.Ordinal)
            && CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(rehash),
                Encoding.UTF8.GetBytes(secret.TokenHash));
    }

    /// <summary>
    /// One-way: the persisted hash is never the plaintext token, and is a fixed-length Base64 SHA-256
    /// digest (44 chars, decoding to exactly 32 bytes).
    /// </summary>
    [Property(MaxTest = 200)]
    public bool StoredHashIsAFixedLengthDigestAndNotThePlaintextToken(int _)
    {
        var secret = Service.Generate();
        var token = ExtractToken(secret.RedeemableLink);

        var isFixedLength = secret.TokenHash.Length == Base64DigestLength;
        var decodesTo32Bytes = Convert.TryFromBase64String(
                secret.TokenHash, new byte[Sha256ByteLength], out var written)
            && written == Sha256ByteLength;
        var isNotPlaintext = !string.Equals(secret.TokenHash, token, StringComparison.Ordinal);

        return isFixedLength && decodesTo32Bytes && isNotPlaintext;
    }

    /// <summary>
    /// The <see cref="InviteSecret.Code"/> is 8..12 characters and uses only the Crockford base32
    /// alphabet (excludes I, L, O, U).
    /// </summary>
    [Property(MaxTest = 200)]
    public bool CodeIsWithinLengthBoundsAndUsesOnlyCrockfordAlphabet(int _)
    {
        var secret = Service.Generate();

        var withinBounds = secret.Code.Length is >= 8 and <= 12;
        var validAlphabet = secret.Code.All(c => CrockfordAlphabet.Contains(c, StringComparison.Ordinal));

        return withinBounds && validAlphabet;
    }

    /// <summary>
    /// Hashing a DIFFERENT presented secret does not reproduce a given <see cref="InviteSecret.TokenHash"/>;
    /// the fixed-time comparison returns false. SHA-256 collisions are computationally infeasible, so
    /// distinct tokens never cross-verify.
    /// </summary>
    [Property(MaxTest = 200)]
    public bool HashingADifferentSecretDoesNotReproduceTheStoredHash(int _)
    {
        var first = Service.Generate();
        var second = Service.Generate();

        var otherHash = Service.Hash(ExtractToken(second.RedeemableLink));

        // The two generations are distinct with overwhelming probability, so the other token's hash
        // must not match the first's stored hash under fixed-time comparison.
        return !CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(otherHash),
            Encoding.UTF8.GetBytes(first.TokenHash));
    }

    // --- Entropy / uniqueness across a large sample ---

    /// <summary>
    /// Distinct generations produce distinct links, codes, and token hashes across a large sample
    /// (a collision in 256-bit random values is infeasible), confirming high entropy.
    /// </summary>
    [Fact]
    public void DistinctGenerationsProduceDistinctLinksCodesAndHashes()
    {
        const int sampleCount = 1_000;
        var links = new HashSet<string>(sampleCount, StringComparer.Ordinal);
        var codes = new HashSet<string>(sampleCount, StringComparer.Ordinal);
        var hashes = new HashSet<string>(sampleCount, StringComparer.Ordinal);

        for (var i = 0; i < sampleCount; i++)
        {
            var secret = Service.Generate();

            Assert.StartsWith(JoinLinkPrefix, secret.RedeemableLink, StringComparison.Ordinal);
            Assert.True(links.Add(secret.RedeemableLink), "Generator produced a duplicate redeemable link.");
            Assert.True(codes.Add(secret.Code), "Generator produced a duplicate invite code.");
            Assert.True(hashes.Add(secret.TokenHash), "Generator produced a duplicate token hash.");
        }
    }
}
