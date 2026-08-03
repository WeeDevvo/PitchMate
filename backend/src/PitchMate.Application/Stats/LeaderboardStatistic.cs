namespace PitchMate.Application.Stats;

/// <summary>
/// The closed, supported set of statistics a squad <c>Leaderboard</c> can be ranked by. A request that
/// selects a statistic outside this set is rejected with <see cref="StatsErrorCode.UnsupportedStatistic"/>
/// and no leaderboard is returned (Requirement 4.1, 4.7). Every statistic is ranked higher-is-better,
/// with ties broken by ascending membership identity for deterministic ordering.
/// </summary>
public enum LeaderboardStatistic
{
    /// <summary>Count of distinct completed matches in which the membership appeared.</summary>
    Appearances,

    /// <summary>Wins divided by appearances, as a percentage; memberships with no value are excluded.</summary>
    WinPercentage,

    /// <summary>The friendly display rating; memberships without an established display rating are excluded.</summary>
    DisplayRating,

    /// <summary>The longest run of consecutive wins in chronological order.</summary>
    WinStreak,

    /// <summary>The longest run of consecutive non-loss (win or draw) results in chronological order.</summary>
    UnbeatenStreak,

    /// <summary>Count of completed matches in which the membership's kickoff team wore bibs.</summary>
    BibAppearances
}
