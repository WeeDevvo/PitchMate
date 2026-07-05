namespace PitchMate.Application.Auth.Abstractions;

/// <summary>
/// Hashes and verifies user passwords with a per-credential salt and a tunable work factor. Implemented
/// in Infrastructure over the framework password hasher; the Application layer depends only on this
/// abstraction (Requirements 3.4, 12.2).
/// </summary>
public interface IPasswordHasher
{
    /// <summary>Produces a salted, one-way hash of <paramref name="plaintext"/> (Requirement 3.x).</summary>
    string Hash(string plaintext);

    /// <summary>
    /// Verifies <paramref name="plaintext"/> against <paramref name="storedHash"/> in fixed time,
    /// signalling whether the stored hash should be upgraded to current parameters. A null or malformed
    /// stored hash yields <see cref="PasswordVerification.Failure"/> (Requirements 3.5, 3.6).
    /// </summary>
    PasswordVerification Verify(string? storedHash, string plaintext);
}
