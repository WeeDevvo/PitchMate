namespace PitchMate.Application.Auth.Abstractions;

/// <summary>
/// Persistence operations for purging expired and spent ephemeral tokens (UK GDPR data minimisation).
/// </summary>
public interface ITokenPurgeRepository
{
    /// <summary>
    /// Permanently removes expired or spent verification tokens, reset tokens, and revoked refresh tokens older than <paramref name="threshold"/>.
    /// </summary>
    /// <param name="threshold">The cutoff instant; tokens expired or redeemed before this are purged.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    /// <returns>The total count of tokens removed.</returns>
    Task<int> PurgeExpiredTokensAsync(DateTimeOffset threshold, CancellationToken ct);
}
