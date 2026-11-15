using Microsoft.Extensions.Logging;
using PitchMate.Application.Auth.Abstractions;

namespace PitchMate.Application.Auth.Gdpr;

/// <summary>
/// Purges expired and redeemed ephemeral tokens (verification, reset, refresh) older than 48 hours,
/// upholding the data minimisation and storage limitation principles (Article 5(1)(e) UK GDPR).
/// </summary>
public sealed class PurgeExpiredTokensHandler(
    ITokenPurgeRepository tokenPurgeRepository,
    TimeProvider clock,
    ILogger<PurgeExpiredTokensHandler>? logger = null)
{
    private static readonly TimeSpan DefaultRetentionWindow = TimeSpan.FromHours(48);

    /// <summary>
    /// Executes the purge using the injected clock and retention threshold.
    /// </summary>
    public async Task<Result<int>> HandleAsync(CancellationToken ct = default)
    {
        DateTimeOffset now = clock.GetUtcNow();
        DateTimeOffset threshold = now - DefaultRetentionWindow;

        int count = await tokenPurgeRepository.PurgeExpiredTokensAsync(threshold, ct);

        logger?.LogInformation(
            "Purged {Count} expired/spent ephemeral tokens older than {Threshold} (UK GDPR Data Minimisation).",
            count, threshold);

        return Result<int>.Ok(count);
    }
}
