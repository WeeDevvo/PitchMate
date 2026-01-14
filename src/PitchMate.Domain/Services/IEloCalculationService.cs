using PitchMate.Domain.ValueObjects;

namespace PitchMate.Domain.Services;

/// <summary>
/// Domain service responsible for calculating ELO rating changes based on match results.
/// Implements the team-based ELO formula to ensure fair rating adjustments.
/// </summary>
public interface IEloCalculationService
{
    /// <summary>
    /// Calculates rating changes for all players in a match based on the outcome.
    /// Uses the team-based ELO formula: ΔR = K × (S - E)
    /// where E = 1 / (1 + 10^((R_opponent - R_team) / 400))
    /// </summary>
    /// <param name="teamA">The first team with players and ratings</param>
    /// <param name="teamB">The second team with players and ratings</param>
    /// <param name="outcome">The match outcome (TeamA win, TeamB win, or Draw)</param>
    /// <param name="kFactor">The K-factor determining magnitude of rating changes</param>
    /// <returns>Dictionary mapping each player's UserId to their rating change (positive or negative)</returns>
    /// <exception cref="ArgumentNullException">Thrown when teamA or teamB is null</exception>
    /// <exception cref="ArgumentException">Thrown when kFactor is not positive</exception>
    Dictionary<UserId, int> CalculateRatingChanges(
        Team teamA,
        Team teamB,
        TeamDesignation outcome,
        int kFactor);
}
