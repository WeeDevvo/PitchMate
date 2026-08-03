namespace PitchMate.Application.Stats;

/// <summary>
/// A request by an authenticated user to read a squad-scoped <c>Leaderboard</c> ranked by a single
/// selected statistic (Requirement 4.1, 4.7). The leaderboard is returned only when the requester
/// holds an <c>Active</c> membership in the target squad and the selected statistic is in the
/// supported set; any other requester receives a uniform failure that discloses nothing, and an
/// unsupported statistic is rejected with <see cref="StatsErrorCode.UnsupportedStatistic"/>. The
/// requester identity is always the authenticated access-token subject, never a caller-supplied
/// body/query value (Requirement 1.5).
/// </summary>
/// <param name="RequestingUserId">The authenticated user requesting the leaderboard (from the token subject).</param>
/// <param name="SquadId">The squad the leaderboard is scoped to.</param>
/// <param name="Statistic">The statistic the entries are ranked by.</param>
public sealed record GetLeaderboardCommand(Guid RequestingUserId, Guid SquadId, LeaderboardStatistic Statistic);
