namespace PitchMate.Application.Stats;

/// <summary>
/// A squad-scoped read view ranking the squad's memberships by a single selected statistic
/// (Requirement 4.1). It carries the <see cref="LeaderboardStatistic"/> the entries are ranked by and
/// the ordered <see cref="LeaderboardEntry"/> rows, best-first with ties broken by ascending
/// membership identity for deterministic ordering.
/// </summary>
/// <param name="Statistic">The statistic the entries are ranked by.</param>
/// <param name="Entries">The ranked entries, ordered best-to-worst by value.</param>
public sealed record Leaderboard(
    LeaderboardStatistic Statistic,
    IReadOnlyList<LeaderboardEntry> Entries);
