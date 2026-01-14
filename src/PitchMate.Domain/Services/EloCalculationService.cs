using PitchMate.Domain.ValueObjects;

namespace PitchMate.Domain.Services;

/// <summary>
/// Implementation of ELO calculation using the team-based formula.
/// Ensures zero-sum rating changes and uniform adjustments for all players on each team.
/// </summary>
public class EloCalculationService : IEloCalculationService
{
    /// <summary>
    /// Calculates rating changes for all players based on match outcome.
    /// Algorithm:
    /// 1. Calculate average rating for each team
    /// 2. Calculate expected score using: E = 1 / (1 + 10^((R_B - R_A) / 400))
    /// 3. Determine actual score: S = 1 (win), 0.5 (draw), 0 (loss)
    /// 4. Calculate rating change: ΔR = K × (S - E)
    /// 5. Apply same change to all players on each team
    /// 6. Ensure zero-sum property (total changes = 0)
    /// </summary>
    public Dictionary<UserId, int> CalculateRatingChanges(
        Team teamA,
        Team teamB,
        TeamDesignation outcome,
        int kFactor)
    {
        if (teamA == null)
            throw new ArgumentNullException(nameof(teamA));

        if (teamB == null)
            throw new ArgumentNullException(nameof(teamB));

        if (kFactor <= 0)
            throw new ArgumentException("K-factor must be positive.", nameof(kFactor));

        // Step 1: Calculate average team ratings
        double avgRatingA = teamA.AverageRating;
        double avgRatingB = teamB.AverageRating;

        // Step 2: Calculate expected scores using ELO formula
        // E_A = 1 / (1 + 10^((R_B - R_A) / 400))
        double expectedScoreA = 1.0 / (1.0 + Math.Pow(10, (avgRatingB - avgRatingA) / 400.0));
        double expectedScoreB = 1.0 - expectedScoreA; // E_B = 1 - E_A

        // Step 3: Determine actual scores based on outcome
        double actualScoreA;
        double actualScoreB;

        switch (outcome)
        {
            case TeamDesignation.TeamA:
                actualScoreA = 1.0;
                actualScoreB = 0.0;
                break;
            case TeamDesignation.TeamB:
                actualScoreA = 0.0;
                actualScoreB = 1.0;
                break;
            case TeamDesignation.Draw:
                actualScoreA = 0.5;
                actualScoreB = 0.5;
                break;
            default:
                throw new ArgumentException($"Invalid outcome: {outcome}", nameof(outcome));
        }

        // Step 4: Calculate rating changes
        // ΔR = K × (S - E)
        double changeA = kFactor * (actualScoreA - expectedScoreA);
        double changeB = kFactor * (actualScoreB - expectedScoreB);

        // Round to nearest integer
        int ratingChangeA = (int)Math.Round(changeA);
        int ratingChangeB = (int)Math.Round(changeB);

        // Step 5: Ensure zero-sum property
        // Due to rounding, we may need to adjust one team's change
        int totalChange = ratingChangeA * teamA.Players.Count + ratingChangeB * teamB.Players.Count;
        
        if (totalChange != 0)
        {
            // Adjust the team with more players (or teamB if equal) to maintain zero-sum
            if (teamA.Players.Count >= teamB.Players.Count)
            {
                ratingChangeA -= totalChange / teamA.Players.Count;
            }
            else
            {
                ratingChangeB -= totalChange / teamB.Players.Count;
            }
        }

        // Step 6: Apply same change to all players on each team
        var ratingChanges = new Dictionary<UserId, int>();

        foreach (var player in teamA.Players)
        {
            ratingChanges[player.UserId] = ratingChangeA;
        }

        foreach (var player in teamB.Players)
        {
            ratingChanges[player.UserId] = ratingChangeB;
        }

        return ratingChanges;
    }
}
