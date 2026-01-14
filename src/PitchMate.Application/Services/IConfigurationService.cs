namespace PitchMate.Application.Services;

/// <summary>
/// Service interface for retrieving system configuration values.
/// Abstracts configuration management from command handlers.
/// </summary>
public interface IConfigurationService
{
    /// <summary>
    /// Gets the default ELO rating for new players joining a squad.
    /// </summary>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The default ELO rating value.</returns>
    Task<int> GetDefaultEloRatingAsync(CancellationToken ct = default);
    
    /// <summary>
    /// Gets the K-Factor used in ELO rating calculations.
    /// </summary>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The K-Factor value.</returns>
    Task<int> GetKFactorAsync(CancellationToken ct = default);
    
    /// <summary>
    /// Gets the default team size for matches.
    /// </summary>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The default team size value.</returns>
    Task<int> GetDefaultTeamSizeAsync(CancellationToken ct = default);
}
