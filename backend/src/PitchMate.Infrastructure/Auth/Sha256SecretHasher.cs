using System.Security.Cryptography;
using System.Text;
using PitchMate.Application.Auth.Abstractions;

namespace PitchMate.Infrastructure.Auth;

/// <summary>
/// SHA-256 implementation of <see cref="ISecretHasher"/> for opaque, high-entropy secrets
/// (refresh tokens, email-verification and password-reset tokens). These secrets carry full
/// cryptographic entropy (see <see cref="RandomSecretTokenGenerator"/>), so a fast one-way hash is
/// the right choice — unlike user-chosen passwords, which require a slow, salted KDF. Only the hash
/// is persisted, so a leaked store cannot reconstruct usable secrets, and verification uses a
/// fixed-time comparison so it leaks no timing information about how much of the value matched
/// (Requirements 4.7, 5.9, 9.6).
/// </summary>
public sealed class Sha256SecretHasher : ISecretHasher
{
    /// <inheritdoc />
    public string Hash(string secret)
    {
        ArgumentNullException.ThrowIfNull(secret);

        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(secret));
        return Convert.ToBase64String(hash);
    }

    /// <inheritdoc />
    public bool Verify(string secret, string storedHash)
    {
        if (secret is null || storedHash is null)
        {
            return false;
        }

        // A malformed stored hash (not valid Base64, or the wrong length) can never match a freshly
        // computed SHA-256 hash. Decode defensively and return false rather than throwing so callers
        // can treat an unrecognised stored value as a non-match (mirrors the password hasher's
        // graceful handling of malformed stored hashes).
        Span<byte> storedBytes = stackalloc byte[SHA256.HashSizeInBytes];
        if (!Convert.TryFromBase64String(storedHash, storedBytes, out var bytesWritten)
            || bytesWritten != SHA256.HashSizeInBytes)
        {
            return false;
        }

        Span<byte> computed = stackalloc byte[SHA256.HashSizeInBytes];
        SHA256.HashData(Encoding.UTF8.GetBytes(secret), computed);

        // Fixed-time comparison so the duration of a comparison does not reveal how much of the value
        // matched (Requirements 4.7, 5.9, 9.6).
        return CryptographicOperations.FixedTimeEquals(computed, storedBytes);
    }
}
