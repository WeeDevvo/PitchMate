using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using PitchMate.Application.Services;
using PitchMate.Infrastructure.Data;

namespace PitchMate.Infrastructure.Services;

/// <summary>
/// Implementation of IConfigurationService that reads from the system_configuration table.
/// Caches configuration values in memory for performance.
/// </summary>
public class ConfigurationService : IConfigurationService
{
    private readonly PitchMateDbContext _context;
    private readonly IMemoryCache _cache;
    private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(5);
    
    // Configuration keys
    private const string DefaultEloRatingKey = "default_elo_rating";
    private const string KFactorKey = "k_factor";
    private const string DefaultTeamSizeKey = "default_team_size";
    
    // Default values (fallback if not configured)
    private const int DefaultEloRatingValue = 1000;
    private const int DefaultKFactorValue = 32;
    private const int DefaultTeamSizeValue = 5;
    
    // Validation ranges
    private const int MinEloRating = 400;
    private const int MaxEloRating = 2400;
    private const int MinKFactor = 1;
    private const int MaxKFactor = 100;
    private const int MinTeamSize = 1;
    private const int MaxTeamSize = 50;

    public ConfigurationService(PitchMateDbContext context, IMemoryCache cache)
    {
        _context = context;
        _cache = cache;
    }

    public async Task<int> GetDefaultEloRatingAsync(CancellationToken ct = default)
    {
        return await GetConfigurationValueAsync(
            DefaultEloRatingKey,
            DefaultEloRatingValue,
            MinEloRating,
            MaxEloRating,
            ct);
    }

    public async Task<int> GetKFactorAsync(CancellationToken ct = default)
    {
        return await GetConfigurationValueAsync(
            KFactorKey,
            DefaultKFactorValue,
            MinKFactor,
            MaxKFactor,
            ct);
    }

    public async Task<int> GetDefaultTeamSizeAsync(CancellationToken ct = default)
    {
        return await GetConfigurationValueAsync(
            DefaultTeamSizeKey,
            DefaultTeamSizeValue,
            MinTeamSize,
            MaxTeamSize,
            ct);
    }

    private async Task<int> GetConfigurationValueAsync(
        string key,
        int defaultValue,
        int minValue,
        int maxValue,
        CancellationToken ct)
    {
        // Try to get from cache first
        if (_cache.TryGetValue(key, out int cachedValue))
        {
            return cachedValue;
        }

        // Read from database
        var config = await _context.SystemConfigurations
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.Key == key, ct);

        int value;
        if (config == null)
        {
            // Use default if not configured
            value = defaultValue;
        }
        else
        {
            // Parse and validate the value
            if (!int.TryParse(config.Value, out value))
            {
                // Invalid format, use default
                value = defaultValue;
            }
            else if (value < minValue || value > maxValue)
            {
                // Out of range, use default
                value = defaultValue;
            }
        }

        // Cache the value
        _cache.Set(key, value, CacheDuration);

        return value;
    }
}
