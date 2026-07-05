using Microsoft.AspNetCore.Identity;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Domain.Auth;

namespace PitchMate.Infrastructure.Auth;

/// <summary>
/// <see cref="IPasswordHasher"/> implementation that wraps the framework
/// <see cref="PasswordHasher{TUser}"/> from <c>Microsoft.Extensions.Identity.Core</c>.
/// The framework hasher applies PBKDF2 with a per-hash cryptographically random salt and an
/// embedded format/version byte, so two equal plaintexts produce different hashes
/// (Requirements 2.2, 3.1), verification reports success or failure in fixed time
/// (Requirements 3.2, 3.3, 3.6), and a hash produced with weaker-than-current parameters is
/// flagged for re-hashing on a successful verify (Requirement 3.5).
/// </summary>
/// <remarks>
/// The wrapped <see cref="PasswordHasher{TUser}"/> is stateless and thread-safe, so a single
/// shared instance is safe to register as a singleton. The generic <see cref="User"/> argument
/// is required by the framework API but unused by the PBKDF2 implementation; a single throwaway
/// <see cref="User"/> instance is passed to satisfy the non-null parameter without leaking any
/// per-call state.
/// </remarks>
public sealed class IdentityPasswordHasher : IPasswordHasher
{
    // The framework hasher ignores the user argument for PBKDF2, but the API requires a non-null
    // instance. A single shared sentinel avoids allocating one per call.
    private static readonly User Sentinel = User.Create("hash-sentinel", "sentinel@users.invalid");

    private readonly PasswordHasher<User> _hasher = new();

    /// <inheritdoc />
    public string Hash(string plaintext)
    {
        ArgumentNullException.ThrowIfNull(plaintext);

        return _hasher.HashPassword(Sentinel, plaintext);
    }

    /// <inheritdoc />
    public PasswordVerification Verify(string? storedHash, string plaintext)
    {
        ArgumentNullException.ThrowIfNull(plaintext);

        // A null, empty, or malformed stored hash can never be a valid verification target; the
        // framework throws on malformed input, so we treat any such case as a plain failure rather
        // than surfacing an exception (Requirement 3.7).
        if (string.IsNullOrEmpty(storedHash))
        {
            return PasswordVerification.Failure;
        }

        PasswordVerificationResult result;
        try
        {
            result = _hasher.VerifyHashedPassword(Sentinel, storedHash, plaintext);
        }
        catch (FormatException)
        {
            // Base64/format decoding of an unrecognised stored hash failed.
            return PasswordVerification.Failure;
        }

        return result switch
        {
            PasswordVerificationResult.Success => PasswordVerification.Success,
            PasswordVerificationResult.SuccessRehashNeeded => PasswordVerification.SuccessRehashNeeded,
            _ => PasswordVerification.Failure,
        };
    }
}
