using PitchMate.Application.Auth.Gdpr;
using PitchMate.Application.Squads.UseCases;

namespace PitchMate.Api;

/// <summary>
/// Scheduled background service executing PitchMate's automated UK GDPR storage-limitation purges:
/// permanently deleting expired/spent auth tokens older than 48 hours and soft-deleted squads past
/// their 30-day recovery window.
/// </summary>
internal sealed class DataRetentionPurgeHostedService(
    IServiceScopeFactory scopeFactory,
    TimeProvider clock,
    ILogger<DataRetentionPurgeHostedService> logger) : BackgroundService
{
    private static readonly TimeSpan InitialDelay = TimeSpan.FromMinutes(1);
    private static readonly TimeSpan Interval = TimeSpan.FromHours(1);

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(InitialDelay, clock, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            await RunPurgeCycleAsync(stoppingToken);

            try
            {
                await Task.Delay(Interval, clock, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
        }
    }

    internal async Task RunPurgeCycleAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using AsyncServiceScope scope = scopeFactory.CreateAsyncScope();

            var tokenPurge = scope.ServiceProvider.GetRequiredService<PurgeExpiredTokensHandler>();
            var tokenResult = await tokenPurge.HandleAsync(cancellationToken);
            if (!tokenResult.IsSuccess)
            {
                logger.LogWarning(
                    "Scheduled expired-token purge returned failure. Reason={Reason}",
                    tokenResult.Error?.Code);
            }

            var squadPurge = scope.ServiceProvider.GetRequiredService<PurgeSquadHandler>();
            var squadResult = await squadPurge.HandleAsync(cancellationToken);
            if (!squadResult.IsSuccess)
            {
                logger.LogWarning(
                    "Scheduled due-squad purge returned failure. Reason={Reason}",
                    squadResult.Error?.Code);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Normal host shutdown.
        }
        catch (Exception ex) when (ex is not OutOfMemoryException and not StackOverflowException)
        {
            logger.LogWarning(ex, "Scheduled GDPR data-retention purge cycle failed; will retry next interval.");
        }
    }
}
