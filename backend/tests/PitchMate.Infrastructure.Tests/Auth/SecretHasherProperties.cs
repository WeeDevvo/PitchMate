using System.Buffers.Text;
using FsCheck;
using FsCheck.Xunit;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Infrastructure.Auth;

namespace PitchMate.Infrastructure.Tests.Auth;

/// <summary>
/// Property tests for the opaque-secret primitives <see cref="Sha256SecretHasher"/> and
/// <see cref="RandomSecretTokenGenerator"/>, covering design Property 6: opaque tokens
/// (email-verification, password-reset, refresh) are stored only as one-way hashes and matched
/// in fixed time.
///
/// The implementation choices these tests assert against (read from source):
///   * <see cref="RandomSecretTokenGenerator.Generate"/> returns 32 bytes (256 bits) of entropy
///     encoded with <see cref="Base64Url"/> (URL-safe, no padding — so no '+', '/', or '=').
///   * <see cref="Sha256SecretHasher.Hash"/> returns the SHA-256 digest as standard (padded) Base64,
///     which is always 44 characters for a 32-byte digest.
///   * <see cref="Sha256SecretHasher.Verify"/> compares via CryptographicOperations.FixedTimeEquals
///     and returns false (never throws) for null or malformed stored hashes.
///
/// **Validates: Requirements 4.7, 5.9, 9.6**
/// </summary>
public class SecretHasherProperties
{
    /// <summary>Base64 length of a 32-byte SHA-256 digest (ceil(32/3)*4 = 44, including padding).</summary>
    private const int Base64DigestLength = 44;

    private const int SecretByteLength = 32;

    private static readonly ISecretHasher Hasher = new Sha256SecretHasher();
    private static readonly ISecretTokenGenerator Generator = new RandomSecretTokenGenerator();

    // --- One-way / round-trip ---

    /// <summary>
    /// Round-trip: for any non-empty string secret, verifying it against its own stored hash succeeds.
    /// </summary>
    [Property(MaxTest = 100)]
    public bool VerifyingASecretAgainstItsOwnHashSucceeds(NonEmptyString secret)
    {
        var storedHash = Hasher.Hash(secret.Get);
        return Hasher.Verify(secret.Get, storedHash);
    }

    /// <summary>
    /// Round-trip for secrets produced by the real generator: every freshly generated secret verifies
    /// against its own stored hash. The unused driver parameter exists only so FsCheck runs the body
    /// across many (≥100) independently generated secrets.
    /// </summary>
    [Property(MaxTest = 100)]
    public bool VerifyingAGeneratedSecretAgainstItsOwnHashSucceeds(int _)
    {
        var secret = Generator.Generate();
        var storedHash = Hasher.Hash(secret);
        return Hasher.Verify(secret, storedHash);
    }

    // --- The stored hash is not the plaintext ---

    /// <summary>
    /// The stored value is a fixed-length one-way digest, never the plaintext: it is exactly the
    /// Base64 of a 32-byte SHA-256 digest, decodes back to 32 bytes, and is not equal to the secret.
    /// </summary>
    [Property(MaxTest = 100)]
    public bool StoredHashIsAFixedLengthDigestAndNotThePlaintext(NonEmptyString secret)
    {
        var storedHash = Hasher.Hash(secret.Get);

        var isFixedLength = storedHash.Length == Base64DigestLength;
        var decodesTo32Bytes = Convert.TryFromBase64String(storedHash, new byte[SecretByteLength], out var written)
            && written == SecretByteLength;
        var isNotPlaintext = !string.Equals(storedHash, secret.Get, StringComparison.Ordinal);

        return isFixedLength && decodesTo32Bytes && isNotPlaintext;
    }

    /// <summary>
    /// For generated (long, high-entropy) secrets the stored hash neither equals nor contains the
    /// plaintext — it is a fixed-length digest, not a transformation that leaks the value.
    /// </summary>
    [Property(MaxTest = 100)]
    public bool StoredHashOfAGeneratedSecretDoesNotContainThePlaintext(int _)
    {
        var secret = Generator.Generate();
        var storedHash = Hasher.Hash(secret);

        return !string.Equals(storedHash, secret, StringComparison.Ordinal)
            && !storedHash.Contains(secret, StringComparison.Ordinal);
    }

    /// <summary>
    /// Verifying a DIFFERENT secret against a stored hash fails. SHA-256 collisions are
    /// computationally infeasible, so distinct secrets never cross-verify.
    /// </summary>
    [Property(MaxTest = 100)]
    public bool VerifyingADifferentSecretAgainstAStoredHashFails(NonEmptyString secret, NonEmptyString other)
    {
        if (string.Equals(secret.Get, other.Get, StringComparison.Ordinal))
        {
            // Same value is the round-trip case, covered elsewhere; nothing to assert here.
            return true;
        }

        var storedHash = Hasher.Hash(secret.Get);
        return !Hasher.Verify(other.Get, storedHash);
    }

    // --- Determinism / no collisions across samples ---

    /// <summary>
    /// Determinism: hashing the same secret twice yields the same stored hash, so a stored hash can be
    /// used as a stable lookup key.
    /// </summary>
    [Property(MaxTest = 100)]
    public bool HashingTheSameSecretTwiceIsDeterministic(NonEmptyString secret)
    {
        return string.Equals(Hasher.Hash(secret.Get), Hasher.Hash(secret.Get), StringComparison.Ordinal);
    }

    /// <summary>
    /// Different secrets yield different stored hashes (no collisions across distinct inputs), so
    /// hash-keyed lookups do not conflate tokens.
    /// </summary>
    [Property(MaxTest = 100)]
    public bool DifferentSecretsYieldDifferentHashes(NonEmptyString secret, NonEmptyString other)
    {
        if (string.Equals(secret.Get, other.Get, StringComparison.Ordinal))
        {
            return true;
        }

        return !string.Equals(Hasher.Hash(secret.Get), Hasher.Hash(other.Get), StringComparison.Ordinal);
    }

    // --- Malformed stored-hash handling ---

    /// <summary>
    /// Verifying against an arbitrary (typically malformed) stored hash never throws and returns false
    /// unless the stored value happens to be the genuine hash (which random strings cannot reach). This
    /// covers null and non-Base64 stored values via FsCheck's default string arbitrary.
    /// </summary>
    [Property(MaxTest = 100)]
    public bool VerifyAgainstArbitraryStoredHashNeverThrowsAndRejectsNonMatches(NonEmptyString secret, string? storedHash)
    {
        var genuineHash = Hasher.Hash(secret.Get);
        var result = Hasher.Verify(secret.Get, storedHash!);

        // The only stored value that may legitimately match is the genuine hash; everything else
        // (null, empty, non-Base64, wrong-length, or a 32-byte digest of a different value) is a
        // non-match. Random generation cannot produce the genuine hash, so this branch holds.
        return string.Equals(storedHash, genuineHash, StringComparison.Ordinal) ? result : !result;
    }

    // --- Generator quality: entropy, 256-bit length, URL-safe encoding ---

    /// <summary>
    /// The generator produces distinct, high-entropy secrets across many calls (a collision in 256-bit
    /// random values is infeasible), and every secret decodes to exactly 32 bytes (256 bits) and uses
    /// URL-safe Base64Url with no padding — so it never contains '+', '/', or '='.
    /// </summary>
    [Fact]
    public void GeneratorProducesDistinctUrlSafe256BitSecrets()
    {
        const int sampleCount = 1_000;
        var seen = new HashSet<string>(sampleCount, StringComparer.Ordinal);

        for (var i = 0; i < sampleCount; i++)
        {
            var secret = Generator.Generate();

            Assert.True(seen.Add(secret), "Generator produced a duplicate secret, indicating low entropy.");

            // URL-safe, unpadded encoding: none of the Base64-only characters appear.
            Assert.DoesNotContain('+', secret);
            Assert.DoesNotContain('/', secret);
            Assert.DoesNotContain('=', secret);

            // Decodes to exactly 256 bits (32 bytes) via the same URL-safe codec the generator uses.
            var decoded = Base64Url.DecodeFromChars(secret);
            Assert.Equal(SecretByteLength, decoded.Length);
        }
    }

    /// <summary>
    /// Explicit malformed / empty stored-hash examples: each is rejected (returns false) without
    /// throwing, complementing the randomised property above.
    /// </summary>
    [Theory]
    [InlineData("")]
    [InlineData("not-base64!!!")]
    [InlineData("AAAA")] // valid Base64 but decodes to 3 bytes, not a 32-byte digest
    [InlineData("////")] // valid Base64 of 3 bytes, wrong length
    public void VerifyWithMalformedStoredHashReturnsFalseWithoutThrowing(string storedHash)
    {
        var secret = Generator.Generate();

        var result = Hasher.Verify(secret, storedHash);

        Assert.False(result);
    }
}
