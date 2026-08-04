using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Common;
using PitchMate.Domain.Squads;
using PitchMate.Domain.Stats;

namespace PitchMate.Application.Stats;

/// <summary>
/// Returns a squad-scoped <see cref="Leaderboard"/> ranked by a single selected statistic to an active
/// member of the same squad (Requirement 4.1). The handler resolves the requester's membership from
/// the authenticated token subject and gates the read through
/// <see cref="StatsAuthorization.RequireActiveMember"/>; any non-active-member requester receives the
/// single uniform authorisation failure that discloses nothing (Requirement 1.1, 1.5). It rejects a
/// statistic outside the supported <see cref="LeaderboardStatistic"/> set with
/// <see cref="StatsErrorCode.UnsupportedStatistic"/> and no leaderboard (Requirement 4.7), aggregates
/// the eligible per-membership rows via <see cref="IStatsRepository"/> (folding the ordered
/// <c>Player_Result</c> sequence with <see cref="StreakCalculator"/> for streak statistics), and
/// orders them best-first (higher value ranks better) with an ascending-identity tie-break for
/// determinism (Requirement 4.2, 4.3). An anonymised membership's "Former player" placeholder display
/// name is passed through unchanged (Requirement 4.6, 14.5). An aggregation failure aborts the request
/// and returns <see cref="StatsErrorCode.ComputationFailed"/> with no partial payload (Requirement 2.6).
/// </summary>
public sealed class GetLeaderboardHandler
{
    private readonly ISquadMembershipRepository _memberships;
    private readonly IStatsRepository _stats;

    /// <summary>Creates the handler with the membership and stats repositories it reads through.</summary>
    /// <param name="memberships">Resolves the requester's membership for authorisation.</param>
    /// <param name="stats">Provides the squad-scoped, completed-only, eligibility-filtered ranking rows.</param>
    public GetLeaderboardHandler(ISquadMembershipRepository memberships, IStatsRepository stats)
    {
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(stats);

        _memberships = memberships;
        _stats = stats;
    }

    /// <summary>
    /// Handles a <see cref="GetLeaderboardCommand"/>, returning the ranked leaderboard on success or a
    /// typed failure: the uniform <see cref="StatsErrorCode.Unauthorized"/> when the requester is not an
    /// active member, <see cref="StatsErrorCode.UnsupportedStatistic"/> when the selected statistic is
    /// outside the supported set, or <see cref="StatsErrorCode.ComputationFailed"/> when aggregation
    /// fails.
    /// </summary>
    /// <param name="command">The leaderboard-read request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<Leaderboard>> HandleAsync(GetLeaderboardCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        // Resolve the requester from the token subject and gate to an active member (Requirement 1.1, 1.5).
        SquadMembership? requester =
            await _memberships.GetByUserAndSquadAsync(command.RequestingUserId, command.SquadId, cancellationToken);

        Result gate = StatsAuthorization.RequireActiveMember(requester);
        if (!gate.IsSuccess)
        {
            return Result<Leaderboard>.Fail(gate.Error!);
        }

        // Reject a statistic outside the closed supported set, returning no leaderboard (Requirement 4.7).
        if (!Enum.IsDefined(command.Statistic))
        {
            return Result<Leaderboard>.Fail(new StatsError(
                StatsErrorCode.UnsupportedStatistic,
                $"The requested ranking statistic '{command.Statistic}' is not supported."));
        }

        try
        {
            IReadOnlyList<LeaderboardRow> rows =
                await _stats.GetLeaderboardRowsAsync(command.SquadId, command.Statistic, cancellationToken);

            IReadOnlyList<LeaderboardEntry> entries = rows
                .Select(row => new LeaderboardEntry(row.MembershipId, row.DisplayName, ResolveValue(command.Statistic, row)))
                .OrderByDescending(entry => entry.Value)
                .ThenBy(entry => entry.MembershipId, UuidV7Comparer.Instance)
                .ToList();

            return Result<Leaderboard>.Ok(new Leaderboard(command.Statistic, entries));
        }
        catch (OperationCanceledException)
        {
            // A cancelled request surfaces as cancellation, not a computed result.
            throw;
        }
        catch (Exception ex)
        {
            // An aggregation query failed or the store was unavailable: abort with no partial payload
            // (Requirement 2.6).
            return Result<Leaderboard>.Fail(new StatsError(
                StatsErrorCode.ComputationFailed,
                $"The leaderboard could not be computed: {ex.Message}"));
        }
    }

    /// <summary>
    /// Resolves a row's ranking value: for a streak statistic the ordered result sequence is folded by
    /// <see cref="StreakCalculator"/>; for every other statistic the store's precomputed value is used
    /// directly. Higher is always better (Requirement 4.2).
    /// </summary>
    private static double ResolveValue(LeaderboardStatistic statistic, LeaderboardRow row) =>
        statistic switch
        {
            LeaderboardStatistic.WinStreak => StreakCalculator.LongestWinStreak(row.Results ?? []),
            LeaderboardStatistic.UnbeatenStreak => StreakCalculator.LongestUnbeatenStreak(row.Results ?? []),
            _ => row.Value ?? 0.0
        };
}
