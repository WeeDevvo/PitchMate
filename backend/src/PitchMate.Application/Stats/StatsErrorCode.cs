namespace PitchMate.Application.Stats;

/// <summary>
/// Stable, closed enumeration of every failure a stats read use case (Leaderboard or Profile) can
/// report. The accompanying <see cref="StatsError.Message"/> is for diagnostics only and is never
/// parsed by callers. Codes map to HTTP results at the Api edge, where <see cref="Unauthorized"/> and
/// <see cref="NotFound"/> deliberately map to a byte-for-byte identical response so existence is
/// concealed (Requirements 1.2, 1.6, 3.6).
/// </summary>
public enum StatsErrorCode
{
    /// <summary>
    /// The requester does not hold an <c>Active</c> membership in the target squad. Returned uniformly
    /// so a rejection never discloses whether the squad or membership exists (Requirement 1.2, 1.6).
    /// </summary>
    Unauthorized,

    /// <summary>
    /// The target squad or subject membership does not exist, or the subject membership does not belong
    /// to the target squad. Answered identically to <see cref="Unauthorized"/> at the Api edge
    /// (Requirement 3.6).
    /// </summary>
    NotFound,

    /// <summary>The requested leaderboard ranking statistic is not in the supported set (Requirement 4.7).</summary>
    UnsupportedStatistic,

    /// <summary>
    /// An aggregation query failed or the relational store was unavailable while computing the request;
    /// no partial or stale statistics are returned (Requirement 2.6).
    /// </summary>
    ComputationFailed
}
