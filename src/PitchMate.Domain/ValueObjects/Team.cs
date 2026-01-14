namespace PitchMate.Domain.ValueObjects;

/// <summary>
/// Represents a team in a match with its players and total rating.
/// Used for team balancing and ELO calculations.
/// </summary>
public record Team
{
    public IReadOnlyList<MatchPlayer> Players { get; init; }
    public int TotalRating { get; init; }

    private Team(IReadOnlyList<MatchPlayer> players, int totalRating)
    {
        Players = players ?? throw new ArgumentNullException(nameof(players));
        TotalRating = totalRating;
    }

    public static Team Create(IEnumerable<MatchPlayer> players)
    {
        if (players == null)
            throw new ArgumentNullException(nameof(players));

        var playerList = players.ToList();

        if (playerList.Count == 0)
            throw new ArgumentException("Team must have at least one player.", nameof(players));

        var totalRating = playerList.Sum(p => p.RatingAtMatchTime.Value);

        return new Team(playerList.AsReadOnly(), totalRating);
    }

    /// <summary>
    /// Gets the average rating of the team.
    /// </summary>
    public double AverageRating => Players.Count > 0 
        ? (double)TotalRating / Players.Count 
        : 0;
}
