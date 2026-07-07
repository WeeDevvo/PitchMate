namespace PitchMate.Application.Squads.Abstractions;

/// <summary>
/// Generates and verifies squad invite secrets. Declared in Application so use cases depend only on
/// Domain-facing abstractions; the cryptographic implementation lives entirely in Infrastructure
/// (Requirement 10.7, 19.2, 19.3). Generation returns the redeemable secret to the caller once and
/// yields only a one-way hash to persist; verification re-hashes a presented secret so callers can
/// compare it to the stored hash in fixed time (Requirement 10.1, 10.4).
/// </summary>
public interface IInviteSecretService
{
    /// <summary>
    /// Produces a fresh invite secret: a one-time redeemable link and short code (8..12 characters)
    /// plus the one-way <see cref="InviteSecret.TokenHash"/> to persist. The redeemable secret is
    /// returned only here and is never stored (Requirement 10.1, 10.4).
    /// </summary>
    /// <returns>The generated <see cref="InviteSecret"/>.</returns>
    InviteSecret Generate();

    /// <summary>
    /// Hashes a presented invite secret with the same one-way digest used at generation so the result
    /// can be matched against a stored <see cref="InviteSecret.TokenHash"/>. Comparison is performed by
    /// the caller in fixed time to avoid timing side-channels (Requirement 10.4).
    /// </summary>
    /// <param name="presentedSecret">The invite secret presented at redemption.</param>
    /// <returns>The one-way hash of <paramref name="presentedSecret"/>.</returns>
    string Hash(string presentedSecret);
}
