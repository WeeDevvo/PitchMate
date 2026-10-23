using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using PitchMate.Application.Squads.Abstractions;

namespace PitchMate.Infrastructure.Squads;

/// <summary>
/// Cryptographic implementation of <see cref="IClaimSecretService"/> for guest-claim links, on the same
/// scheme as <see cref="InviteSecretService"/>: 256 bits of entropy rendered as a URL-safe token in the
/// link's path after <c>/claim/</c>, persisted only as the SHA-256 digest of that token. A claim link has
/// no short code, because it is shared as a link and never typed.
/// </summary>
public sealed class ClaimSecretService : IClaimSecretService
{
    /// <summary>256 bits of entropy, the same strength as an invite secret.</summary>
    private const int SecretByteLength = 32;

    /// <summary>Base path the claim link is built on, per product domain <c>pitch-mate.co.uk</c>.</summary>
    private const string ClaimLinkPrefix = "https://pitch-mate.co.uk/claim/";

    /// <inheritdoc />
    public ClaimSecret Generate()
    {
        Span<byte> entropy = stackalloc byte[SecretByteLength];
        RandomNumberGenerator.Fill(entropy);

        var token = Base64Url.EncodeToString(entropy);
        return new ClaimSecret(ClaimLinkPrefix + token, Hash(token));
    }

    /// <inheritdoc />
    public string Hash(string presentedSecret)
    {
        ArgumentNullException.ThrowIfNull(presentedSecret);

        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(presentedSecret));
        return Convert.ToBase64String(digest);
    }
}
