namespace PitchMate.Domain.ValueObjects;

/// <summary>
/// Represents the result of a completed match.
/// </summary>
public record MatchResult
{
    public TeamDesignation Winner { get; init; }
    public string? BalanceFeedback { get; init; }
    public DateTime RecordedAt { get; init; }

    private MatchResult(TeamDesignation winner, string? balanceFeedback, DateTime recordedAt)
    {
        Winner = winner;
        BalanceFeedback = balanceFeedback;
        RecordedAt = recordedAt;
    }

    public static MatchResult Create(TeamDesignation winner, string? balanceFeedback = null)
    {
        return new MatchResult(winner, balanceFeedback, DateTime.UtcNow);
    }
}

/// <summary>
/// Designates which team won or if the match was a draw.
/// </summary>
public enum TeamDesignation
{
    TeamA,
    TeamB,
    Draw
}

/// <summary>
/// Represents the status of a match.
/// </summary>
public enum MatchStatus
{
    Pending,
    Completed
}
