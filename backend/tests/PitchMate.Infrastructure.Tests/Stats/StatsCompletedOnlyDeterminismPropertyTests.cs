using FsCheck;
using FsCheck.Xunit;
using PitchMate.Application.Stats;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Stats;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// Model-based property test for completed-only derivation and determinism (task 6.3), validating
/// design <c>Property 3: Completed-only derivation and determinism</c> against the real
/// <c>EfStatsRepository</c> SQL on a Testcontainers PostgreSQL instance, using the pure
/// <see cref="StatsReferenceOracle"/> — which computes over <c>Completed</c> matches only — as the
/// source of truth.
/// <para>
/// The generated datasets deliberately span every <see cref="MatchState"/>, including non-completed
/// matches that nonetheless carry locked kickoff lineups (<see cref="MatchState.TeamsRolled"/> and
/// <see cref="MatchState.InProgress"/>). The property asserts two facets:
/// </para>
/// <list type="number">
/// <item>
/// <description>
/// <b>Completed-only derivation (Requirement 2.3)</b> — for every membership and every
/// <see cref="LeaderboardStatistic"/>, the repository's output equals the oracle computed over the
/// squad's <c>Completed</c> matches alone. Because the dataset also contains non-completed matches
/// with locked lineups (rosters, and for <see cref="MatchState.InProgress"/> even recorded team
/// scores), agreement with a <c>Completed</c>-only oracle proves those matches contribute nothing. The
/// test makes the exclusion explicit: any membership that appears only in a non-completed locked
/// lineup — and never in a completed one — has a zero appearance count and empty aggregates.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>Determinism (Requirement 2.4)</b> — calling <see cref="IStatsRepository.GetMembershipStatsAsync"/>
/// and <see cref="IStatsRepository.GetLeaderboardRowsAsync"/> twice against the same seeded database,
/// with no write between the two calls, yields equal results on both requests: equal counts and
/// sequences for every membership's profile aggregates, and equal ranking values (and streak result
/// sequences) for every leaderboard statistic.
/// </description>
/// </item>
/// </list>
/// <para>
/// Each iteration migrates, seeds, and drops its own throwaway database via
/// <see cref="StatsModelBasedHarness"/>, so <see cref="MaxTest"/> is kept modest; because every
/// generated dataset carries one to three squads of fifteen to twenty memberships and matches spanning
/// every state, a single iteration already performs dozens of independent completed-only and
/// determinism comparisons, so the run clears well over 100 logical checks in total. Requires Docker.
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class StatsCompletedOnlyDeterminismPropertyTests
{
    // Modest generated-dataset count: each seeds/drops a real database, yet every dataset yields many
    // per-membership, per-statistic completed-only and repeated-call comparisons, so total logical
    // checks exceed 100.
    private const int MaxTest = 10;

    private readonly StatsModelBasedHarness _harness;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public StatsCompletedOnlyDeterminismPropertyTests(PostgreSqlContainerFixture fixture)
    {
        _harness = new StatsModelBasedHarness(fixture);
    }

    // Feature: stats-and-summaries, Property 3: For any set of matches spanning every MatchState, every
    // statistic equals the value obtained by computing over only the Completed matches (matches in any
    // other state contribute nothing); and recomputing the same Leaderboard or Profile with no completed
    // match added and no change to any completed match's result or snapshots yields equal values on both
    // requests.
    /// <summary>
    /// **Validates: Requirements 2.3, 2.4**
    /// </summary>
    [Property(MaxTest = MaxTest, Arbitrary = new[] { typeof(StatsDatasetArbitraries) })]
    public Property StatisticsDeriveFromCompletedMatchesOnlyAndAreDeterministic(StatsDatasetSpec spec) =>
        RunAsync(async () =>
        {
            await _harness.WithSeededDatasetAsync(spec, async (repository, seeded) =>
            {
                foreach (SeededStatsDataset.SquadData squad in seeded.Squads)
                {
                    await AssertSquadAsync(repository, squad);
                }
            });

            return true;
        });

    /// <summary>
    /// Asserts both facets for the given squad in a single pass that reads each membership and each
    /// leaderboard statistic exactly twice: the two reads must be identical (determinism, Requirement
    /// 2.4), and the first read must equal the <c>Completed</c>-only oracle (completed-only derivation,
    /// Requirement 2.3). It also makes the exclusion explicit by reusing the cached first reads: a
    /// membership that appears only in a non-completed locked lineup (<see cref="MatchState.TeamsRolled"/>
    /// and <see cref="MatchState.InProgress"/> carry rosters, and <see cref="MatchState.InProgress"/>
    /// even carries scores) — and in no completed match — has a zero appearance count and empty
    /// aggregates, proving the non-completed matches contributed nothing.
    /// <para>
    /// Reading each item exactly twice (rather than in separate oracle and determinism passes) keeps the
    /// per-iteration database round-trips in line with the sibling model-based tests, which matters
    /// because the throwaway databases use unpooled connections.
    /// </para>
    /// </summary>
    private async Task AssertSquadAsync(IStatsRepository repository, SeededStatsDataset.SquadData squad)
    {
        var statsById = new Dictionary<Guid, MembershipStatsData?>();

        foreach (SeededStatsDataset.MembershipData member in squad.Memberships)
        {
            MembershipStatsData? first =
                await repository.GetMembershipStatsAsync(squad.SquadId, member.MembershipId, CancellationToken.None);
            MembershipStatsData? second =
                await repository.GetMembershipStatsAsync(squad.SquadId, member.MembershipId, CancellationToken.None);

            // Determinism: two successive reads with no write between them are identical (Req 2.4).
            AssertStatsIdentical(first, second);

            // Completed-only derivation: the read equals the oracle computed over completed matches
            // alone, even though the squad also contains non-completed matches (Req 2.3).
            MembershipStatsData? expected = StatsReferenceOracle.GetMembershipStats(squad, member.MembershipId);
            AssertStatsEqualToOracle(expected, first);

            statsById[member.MembershipId] = first;
        }

        foreach (LeaderboardStatistic statistic in Enum.GetValues<LeaderboardStatistic>())
        {
            IReadOnlyList<LeaderboardRow> first =
                await repository.GetLeaderboardRowsAsync(squad.SquadId, statistic, CancellationToken.None);
            IReadOnlyList<LeaderboardRow> second =
                await repository.GetLeaderboardRowsAsync(squad.SquadId, statistic, CancellationToken.None);

            AssertLeaderboardIdentical(first, second);

            IReadOnlyList<LeaderboardRow> expected = StatsReferenceOracle.GetLeaderboardRows(
                squad, statistic, _harness.RatingEngine, _harness.DisplayParameters);
            AssertLeaderboardEqualToOracle(statistic, expected, first);
        }

        // Make the exclusion explicit from the cached first reads: a membership present only in a
        // non-completed locked lineup contributes nothing (Req 2.3).
        foreach (Guid membershipId in MembersOnlyInNonCompletedLineups(squad))
        {
            MembershipStatsData? actual = statsById[membershipId];

            Assert.NotNull(actual);
            Assert.Equal(0, actual!.Appearances);
            Assert.Equal(0, actual.Wins);
            Assert.Equal(0, actual.Draws);
            Assert.Equal(0, actual.Losses);
            Assert.Equal(0, actual.BibAppearances);
            Assert.Empty(actual.Results);
            Assert.Empty(actual.CoAppearances);
            Assert.Empty(actual.Partnerships);
            Assert.Empty(actual.BogeyOpponents);
        }
    }

    /// <summary>
    /// Returns the memberships that appear in at least one non-completed match's locked kickoff lineup
    /// but in no completed match's lineup — the memberships whose entire on-pitch presence is in matches
    /// that must contribute nothing to statistics.
    /// </summary>
    private static IEnumerable<Guid> MembersOnlyInNonCompletedLineups(SeededStatsDataset.SquadData squad)
    {
        var inCompleted = squad.Matches
            .Where(match => match.State == MatchState.Completed)
            .SelectMany(match => match.Teams)
            .SelectMany(team => team.Roster)
            .ToHashSet();

        var inNonCompleted = squad.Matches
            .Where(match => match.State != MatchState.Completed)
            .SelectMany(match => match.Teams)
            .SelectMany(team => team.Roster)
            .ToHashSet();

        return inNonCompleted.Where(id => !inCompleted.Contains(id));
    }

    // --- Completed-only (oracle) comparison, mirroring the squad-isolation test's value comparison. ---

    private static void AssertStatsEqualToOracle(MembershipStatsData? expected, MembershipStatsData? actual)
    {
        if (expected is null)
        {
            Assert.Null(actual);
            return;
        }

        Assert.NotNull(actual);
        Assert.Equal(expected.Appearances, actual!.Appearances);
        Assert.Equal(expected.Wins, actual.Wins);
        Assert.Equal(expected.Draws, actual.Draws);
        Assert.Equal(expected.Losses, actual.Losses);
        Assert.Equal(expected.BibAppearances, actual.BibAppearances);
        Assert.Equal(expected.Results, actual.Results);
        Assert.Equal(expected.Mu, actual.Mu);
        Assert.Equal(expected.Sigma, actual.Sigma);
        Assert.Equal(expected.Snapshots.Count, actual.Snapshots.Count);

        AssertCoAppearancesEqual(expected.CoAppearances, actual.CoAppearances);
        AssertPairedEqual(expected.Partnerships, actual.Partnerships);
        AssertPairedEqual(expected.BogeyOpponents, actual.BogeyOpponents);
    }

    private static void AssertLeaderboardEqualToOracle(
        LeaderboardStatistic statistic,
        IReadOnlyList<LeaderboardRow> expected,
        IReadOnlyList<LeaderboardRow> actual)
    {
        Assert.Equal(expected.Count, actual.Count);
        Dictionary<Guid, LeaderboardRow> byId = actual.ToDictionary(r => r.MembershipId);

        foreach (LeaderboardRow row in expected)
        {
            Assert.True(byId.TryGetValue(row.MembershipId, out LeaderboardRow? match), $"Missing leaderboard row for {row.MembershipId}.");
            Assert.Equal(row.DisplayName, match!.DisplayName);
            Assert.Equal(row.State, match.State);

            if (statistic is LeaderboardStatistic.WinStreak or LeaderboardStatistic.UnbeatenStreak)
            {
                Assert.Equal(FoldStreak(statistic, row.Results), FoldStreak(statistic, match.Results));
            }
            else
            {
                Assert.Equal(row.Value, match.Value);
            }
        }
    }

    // --- Determinism (repeated repository call) comparison: two reads must be identical. ---

    private static void AssertStatsIdentical(MembershipStatsData? first, MembershipStatsData? second)
    {
        if (first is null)
        {
            Assert.Null(second);
            return;
        }

        Assert.NotNull(second);
        Assert.Equal(first.Appearances, second!.Appearances);
        Assert.Equal(first.Wins, second.Wins);
        Assert.Equal(first.Draws, second.Draws);
        Assert.Equal(first.Losses, second.Losses);
        Assert.Equal(first.BibAppearances, second.BibAppearances);
        Assert.Equal(first.Mu, second.Mu);
        Assert.Equal(first.Sigma, second.Sigma);

        // Chronologically-ordered sequences must be identical between calls, in order.
        Assert.Equal(first.Results, second.Results);
        Assert.Equal(first.Snapshots, second.Snapshots);

        // Row collections carry no SQL-guaranteed order, so compare them as sets keyed on identity.
        AssertCoAppearancesIdentical(first.CoAppearances, second.CoAppearances);
        AssertPairedIdentical(first.Partnerships, second.Partnerships);
        AssertPairedIdentical(first.BogeyOpponents, second.BogeyOpponents);
    }

    private static void AssertLeaderboardIdentical(
        IReadOnlyList<LeaderboardRow> first, IReadOnlyList<LeaderboardRow> second)
    {
        Assert.Equal(first.Count, second.Count);
        Dictionary<Guid, LeaderboardRow> byId = second.ToDictionary(r => r.MembershipId);

        foreach (LeaderboardRow row in first)
        {
            Assert.True(byId.TryGetValue(row.MembershipId, out LeaderboardRow? match), $"Missing leaderboard row for {row.MembershipId}.");
            Assert.Equal(row.DisplayName, match!.DisplayName);
            Assert.Equal(row.State, match.State);
            Assert.Equal(row.Value, match.Value);
            Assert.Equal(row.Results, match.Results);
        }
    }

    // --- Shared helpers. ---

    private static int FoldStreak(LeaderboardStatistic statistic, IReadOnlyList<PlayerResult>? results) =>
        statistic == LeaderboardStatistic.WinStreak
            ? StreakCalculator.LongestWinStreak(results ?? [])
            : StreakCalculator.LongestUnbeatenStreak(results ?? []);

    private static void AssertCoAppearancesEqual(
        IReadOnlyList<MembershipStatsData.CoAppearanceRow> expected,
        IReadOnlyList<MembershipStatsData.CoAppearanceRow> actual)
    {
        Assert.Equal(expected.Count, actual.Count);
        Dictionary<Guid, MembershipStatsData.CoAppearanceRow> byId = actual.ToDictionary(r => r.MembershipId);
        foreach (MembershipStatsData.CoAppearanceRow row in expected)
        {
            MembershipStatsData.CoAppearanceRow match = byId[row.MembershipId];
            Assert.Equal(row.TeammateCount, match.TeammateCount);
            Assert.Equal(row.OpponentCount, match.OpponentCount);
            Assert.Equal(row.DisplayName, match.DisplayName);
        }
    }

    private static void AssertPairedEqual(
        IReadOnlyList<MembershipStatsData.PairedStatRow> expected,
        IReadOnlyList<MembershipStatsData.PairedStatRow> actual)
    {
        Assert.Equal(expected.Count, actual.Count);
        Dictionary<Guid, MembershipStatsData.PairedStatRow> byId = actual.ToDictionary(r => r.MembershipId);
        foreach (MembershipStatsData.PairedStatRow row in expected)
        {
            MembershipStatsData.PairedStatRow match = byId[row.MembershipId];
            Assert.Equal(row.Wins, match.Wins);
            Assert.Equal(row.QualifyingMatches, match.QualifyingMatches);
        }
    }

    private static void AssertCoAppearancesIdentical(
        IReadOnlyList<MembershipStatsData.CoAppearanceRow> first,
        IReadOnlyList<MembershipStatsData.CoAppearanceRow> second)
    {
        Assert.Equal(first.Count, second.Count);
        Dictionary<Guid, MembershipStatsData.CoAppearanceRow> byId = second.ToDictionary(r => r.MembershipId);
        foreach (MembershipStatsData.CoAppearanceRow row in first)
        {
            Assert.True(byId.TryGetValue(row.MembershipId, out MembershipStatsData.CoAppearanceRow? match), $"Missing co-appearance row for {row.MembershipId}.");
            Assert.Equal(row, match);
        }
    }

    private static void AssertPairedIdentical(
        IReadOnlyList<MembershipStatsData.PairedStatRow> first,
        IReadOnlyList<MembershipStatsData.PairedStatRow> second)
    {
        Assert.Equal(first.Count, second.Count);
        Dictionary<Guid, MembershipStatsData.PairedStatRow> byId = second.ToDictionary(r => r.MembershipId);
        foreach (MembershipStatsData.PairedStatRow row in first)
        {
            Assert.True(byId.TryGetValue(row.MembershipId, out MembershipStatsData.PairedStatRow? match), $"Missing paired-stat row for {row.MembershipId}.");
            Assert.Equal(row, match);
        }
    }

    /// <summary>
    /// Bridges FsCheck's synchronous property model to the harness's asynchronous per-iteration
    /// database work. Blocking is safe: xUnit test execution has no synchronization context, so
    /// <c>GetAwaiter().GetResult()</c> cannot deadlock and it surfaces the original exception unwrapped.
    /// </summary>
    private static Property RunAsync(Func<Task<bool>> body) =>
        body().GetAwaiter().GetResult().ToProperty();
}
