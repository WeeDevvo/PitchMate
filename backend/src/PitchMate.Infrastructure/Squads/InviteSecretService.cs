using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using PitchMate.Application.Squads.Abstractions;

namespace PitchMate.Infrastructure.Squads;

/// <summary>
/// Cryptographic implementation of <see cref="IInviteSecretService"/> for squad invites. The
/// abstraction is declared in Application so use cases stay framework-free; the entropy, encoding,
/// and hashing all live here in Infrastructure (Requirement 10.7, 19.3).
///
/// <para>
/// <b>Canonical hashable secret.</b> An invite has a single opaque high-entropy <i>token</i> — the
/// URL-safe secret embedded in the <see cref="InviteSecret.RedeemableLink"/> after
/// <c>/join/</c>. Everything else derives from it: the <see cref="InviteSecret.Code"/> is a short,
/// human-typeable Crockford base32 rendering of the same entropy, and the
/// <see cref="InviteSecret.TokenHash"/> is the SHA-256 digest of that token. Only the digest is
/// persisted; the redeemable token is returned to the creating client once and never stored in
/// recoverable form (Requirement 10.1, 10.4).
/// </para>
/// <para>
/// <b>Round-trip contract.</b> At redemption the caller extracts the token from the presented link
/// (the segment after <c>/join/</c>) and passes it to <see cref="Hash"/>; the result reproduces the
/// stored <see cref="InviteSecret.TokenHash"/>, so a match can be confirmed with
/// <see cref="CryptographicOperations.FixedTimeEquals"/> over the digests. The token — not the
/// derived code — is the value that hashes to <c>TokenHash</c> (Requirement 10.4).
/// </para>
/// </summary>
public sealed class InviteSecretService : IInviteSecretService
{
    /// <summary>256 bits of entropy — the configured strength for every invite secret.</summary>
    private const int SecretByteLength = 32;

    /// <summary>
    /// Crockford base32 alphabet (excludes I, L, O, U to avoid transcription ambiguity). Each
    /// character encodes 5 bits, so N source bytes yield ceil(N*8/5) characters.
    /// </summary>
    private const string CrockfordAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

    /// <summary>
    /// Number of entropy bytes fed into the human-typeable code. Six bytes (48 bits) render to
    /// ceil(48/5) = 10 Crockford base32 characters, which sits inside the required 8..12 range.
    /// </summary>
    private const int CodeSourceByteLength = 6;

    /// <summary>Base path the redeemable link is built on, per product domain <c>pitch-mate.co.uk</c>.</summary>
    private const string JoinLinkPrefix = "https://pitch-mate.co.uk/join/";

    /// <inheritdoc />
    public InviteSecret Generate()
    {
        Span<byte> entropy = stackalloc byte[SecretByteLength];
        RandomNumberGenerator.Fill(entropy);

        // The token is the URL-safe encoding of the full 256 bits: opaque, safe in a link or header
        // without escaping, and the single value we hash (Requirement 10.1).
        var token = Base64Url.EncodeToString(entropy);
        var redeemableLink = JoinLinkPrefix + token;

        // The short code is derived from the same entropy so it resolves to the same invite, rendered
        // in Crockford base32 for human transcription (Requirement 10.1).
        var code = EncodeCrockfordBase32(entropy[..CodeSourceByteLength]);

        // Persist only the one-way digest of the token; comparison at redemption is fixed-time
        // (Requirement 10.4).
        var tokenHash = Hash(token);

        return new InviteSecret(redeemableLink, code, tokenHash);
    }

    /// <inheritdoc />
    public string Hash(string presentedSecret)
    {
        ArgumentNullException.ThrowIfNull(presentedSecret);

        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(presentedSecret));
        return Convert.ToBase64String(digest);
    }

    /// <summary>
    /// Encodes bytes as Crockford base32 (5 bits per character), big-endian. Produces
    /// ceil(bytes*8/5) characters; the final character is left-padded with zero bits when the input
    /// is not a whole multiple of 5 bits.
    /// </summary>
    private static string EncodeCrockfordBase32(ReadOnlySpan<byte> bytes)
    {
        var charCount = (bytes.Length * 8 + 4) / 5;
        var result = new char[charCount];

        var buffer = 0;
        var bitsInBuffer = 0;
        var index = 0;

        foreach (var b in bytes)
        {
            buffer = (buffer << 8) | b;
            bitsInBuffer += 8;

            while (bitsInBuffer >= 5)
            {
                bitsInBuffer -= 5;
                var symbol = (buffer >> bitsInBuffer) & 0b11111;
                result[index++] = CrockfordAlphabet[symbol];
            }
        }

        if (bitsInBuffer > 0)
        {
            // Left-pad the remaining bits to a full 5-bit symbol.
            var symbol = (buffer << (5 - bitsInBuffer)) & 0b11111;
            result[index++] = CrockfordAlphabet[symbol];
        }

        return new string(result);
    }
}
