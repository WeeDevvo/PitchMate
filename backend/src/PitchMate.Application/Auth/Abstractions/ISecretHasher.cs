namespace PitchMate.Application.Auth.Abstractions;

/// <summary>
/// Hashes and verifies opaque, high-entropy secrets (refresh tokens, email-verification and
/// password-reset tokens). Only the one-way hash is persisted and comparison is fixed-time, so a leaked
/// store cannot reconstruct usable secrets and verification leaks no timing information (Requirement 9.6).
/// Implemented in Infrastructure (Requirement 12.2).
/// </summary>
public interface ISecretHasher
{
    /// <summary>Produces a one-way hash of <paramref name="secret"/> for storage.</summary>
    string Hash(string secret);

    /// <summary>
    /// Compares <paramref name="secret"/> against <paramref name="storedHash"/> using a fixed-time
    /// comparison, returning whether they match.
    /// </summary>
    bool Verify(string secret, string storedHash);
}
