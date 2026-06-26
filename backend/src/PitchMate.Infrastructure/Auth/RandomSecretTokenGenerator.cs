using System.Buffers.Text;
using System.Security.Cryptography;
using PitchMate.Application.Auth.Abstractions;

namespace PitchMate.Infrastructure.Auth;

/// <summary>
/// Generates opaque, single-use secret tokens for email verification, password reset, and refresh
/// tokens. Each token carries 256 bits (32 bytes) of cryptographically secure entropy from
/// <see cref="RandomNumberGenerator"/>, encoded URL-safe (Base64Url, no padding) so it can travel in
/// a link or header without escaping. The plaintext is returned to the caller once; only its one-way
/// hash is ever persisted (see <see cref="Sha256SecretHasher"/>) (Requirements 4.7, 5.9, 9.6).
/// </summary>
public sealed class RandomSecretTokenGenerator : ISecretTokenGenerator
{
    /// <summary>256 bits of entropy, the configured strength for every opaque token secret.</summary>
    private const int SecretByteLength = 32;

    /// <inheritdoc />
    public string Generate()
    {
        Span<byte> bytes = stackalloc byte[SecretByteLength];
        RandomNumberGenerator.Fill(bytes);
        return Base64Url.EncodeToString(bytes);
    }
}
