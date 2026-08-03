namespace PitchMate.Application.Stats;

/// <summary>
/// The rich-tracking-only statistics for a membership — goals scored, clean sheets, goals conceded as
/// keeper, and keeper time — surfaced only when a squad has <c>LiveMatchTracking</c> enabled. Each
/// field is optional so that "no data" is expressed distinctly from a zero value: an enabled squad
/// with no rich detail yet reports every field as <see langword="null"/> (Requirement 13.1, 13.2,
/// 13.7). When <c>LiveMatchTracking</c> is disabled the enclosing <c>PlayerProfile.Rich</c> property
/// is itself <see langword="null"/> and this record is omitted entirely, with no placeholder. The
/// source data (goal events, goalkeeper stints) is delivered by the live-tracking spec.
/// </summary>
/// <param name="Goals">Goals scored, or <see langword="null"/> when no data.</param>
/// <param name="CleanSheets">Clean sheets, or <see langword="null"/> when no data.</param>
/// <param name="GoalsConcededAsKeeper">Goals conceded while keeping, or <see langword="null"/> when no data.</param>
/// <param name="KeeperTime">Total time spent as keeper, or <see langword="null"/> when no data.</param>
public sealed record RichStats(
    int? Goals,
    int? CleanSheets,
    int? GoalsConcededAsKeeper,
    TimeSpan? KeeperTime);
