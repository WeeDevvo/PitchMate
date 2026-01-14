namespace PitchMate.Domain.ValueObjects;

/// <summary>
/// Represents a player in a match with their rating at the time of the match.
/// Captures the player's rating snapshot for accurate ELO calculations.
/// </summary>
public record MatchPlayer
{
    public UserId UserId { get; init; }
    public EloRating RatingAtMatchTime { get; init; }

    private MatchPlayer(UserId userId, EloRating ratingAtMatchTime)
    {
        UserId = userId ?? throw new ArgumentNullException(nameof(userId));
        RatingAtMatchTime = ratingAtMatchTime ?? throw new ArgumentNullException(nameof(ratingAtMatchTime));
    }

    public static MatchPlayer Create(UserId userId, EloRating rating)
    {
        return new MatchPlayer(userId, rating);
    }
}
