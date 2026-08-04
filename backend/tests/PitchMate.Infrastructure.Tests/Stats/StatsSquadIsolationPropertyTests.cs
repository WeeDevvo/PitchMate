using FsCheck;
using FsCheck.Xunit;
using PitchMate.Application.Stats;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// Model-based property test for squad isolation (task 6.2), validating design
/// <c>Property 2: Squad isolation</c> against the real <c>EfStatsRepository</c> SQL on a Testcontainers
/// PostgreSQL instance, using the pure <see cref="StatsReferenceOracle"/> — computed over <em>one squad
/// at a time</em> — as the source of truth.
/// <para>
/// For any generated dataset of one to three squads, each with its own membership pool and its own
/// completed and non-completed matches, every statistic the repository returns for a squad MUST equal
/// the value the oracle computes from <em>only that squad's</em> completed matches and memberships, and
/// no match or membership belonging to any other squad may ever contribute to a value or appear in a
/// result. The test asserts this two ways:
/// </para>
/// <list type="number">
/// <item>
/// <description>
/// <b>Positive scoping</b> — for every membership in every squad, the repository's
/// <see cref="IStatsRepository.GetMembershipStatsAsync"/>, <see cref="IStatsRepository.FindMembershipAsync"/>,
/// and <see cref="IStatsRepository.GetLeaderboardRowsAsync"/> results (across every
/// <see cref="LeaderboardStatistic"/>) equal the oracle computed over that squad alone. Because each
/// squad owns disjoint matches and memberships, any cross-squad leakage would perturb these squad-scoped
/// values and fail the comparison.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>Negative isolation</b> — for every ordered pair of distinct squads, a membership belonging to the
/// other squad neither resolves nor contributes when queried against a squad: the repository's
/// <see cref="IStatsRepository.FindMembershipAsync"/> and <see cref="IStatsRepository.GetMembershipStatsAsync"/>
/// both return <see langword="null"/>, and no leaderboard row for a squad carries a membership identity
/// drawn from any other squad. This directly exercises a requester who belongs to more than one squad
/// (Requirement 1.4): the same person's membership in another squad is invisible here.
/// </description>
/// </item>
/// </list>
/// <para>
/// Each iteration migrates, seeds, and drops its own throwaway database via
/// <see cref="StatsModelBasedHarness"/>, so <see cref="MaxTest"/> is kept modest; because every
/// generated dataset carries one to three squads of fifteen to twenty memberships, a single iteration
/// already performs dozens of independent squad-scoped comparisons and cross-squad probes, so the run
/// clears well over 100 logical checks in total. Requires Docker.
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class StatsSquadIsolationPropertyTests
{
    // Modest generated-dataset count: each seeds/drops a real database, yet every dataset yields many
    // per-membership, per-statistic, and cross-squad comparisons, so total logical checks exceed 100.
    private const int MaxTest = 10;

    private readonly StatsModelBasedHarness _harness;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public StatsSquadIsolationPropertyTests(PostgreSqlContainerFixture fixture)
    {
        _harness = new StatsModelBasedHarness(fixture);
    }

    // Feature: stats-and-summaries, Property 2: For any two squads with their own memberships and
    // completed matches, every statistic returned for a squad is computed solely from that squad's
    // completed matches and memberships, and no match or membership belonging to any other squad ever
    // contributes to a value or appears in a result — including for a requester who belongs to more
    // than one squad.
    /// <summary>
    /// **Validates: Requirements 1.3, 1.4**
    /// </summary>
    [Property(MaxTest = MaxTest, Arbitrary = new[] { typeof(StatsDatasetArbitraries) })]
    public Property StatisticsAreScopedSolelyToTheirOwnSquad(StatsDatasetSpec spec) =>
        RunAsync(async () =>
        {
            await _harness.WithSeededDatasetAsync(spec, async (repository, seeded) =>
            {
                // (1) Positive scoping: every squad's repository output equals the oracle over that
                //     squad alone — for every membership and every leaderboard statistic.
                foreach (SeededStatsDataset.SquadData squad in seeded.Squads)
                {
                    await AssertSquadScopedToOracleAsync(repository, squad);
                }

                // (2) Negative isolation: a membership from any other squad neither resolves nor
                //     contributes when queried against this squad (Req 1.3, 1.4).
                foreach (SeededStatsDataset.SquadData squad in seeded.Squads)
                {
                    await AssertForeignMembershipsAreInvisibleAsync(repository, squad, seeded);
                }
            });

            return true;
        });

    /// <summary>
    /// Asserts that, for the given squad, the repository agrees with the oracle computed over that
    /// squad alone for every membership's profile aggregates and membership reference, and for every
    /// leaderboard statistic — proving no other squad's data leaks into this squad's values.
    /// </summary>
    private async Task AssertSquadScopedToOracleAsync(
        IStatsRepository repository, SeededStatsDataset.SquadData squad)
    {
        foreach (SeededStatsDataset.MembershipData member in squad.Memberships)
        {
            MembershipStatsData? expected = StatsReferenceOracle.GetMembershipStats(squad, member.MembershipId);
            MembershipStatsData? actual =
                await repository.GetMembershipStatsAsync(squad.SquadId, member.MembershipId, CancellationToken.None);
            AssertStatsEqual(expected, actual);

            MembershipRef? expectedRef = StatsReferenceOracle.FindMembership(squad, member.MembershipId);
            MembershipRef? actualRef =
                await repository.FindMembershipAsync(squad.SquadId, member.MembershipId, CancellationToken.None);
            Assert.Equal(expectedRef, actualRef);
        }

        var squadMembershipIds = squad.Memberships.Select(m => m.MembershipId).ToHashSet();

        foreach (LeaderboardStatistic statistic in Enum.GetValues<LeaderboardStatistic>())
        {
            IReadOnlyList<LeaderboardRow> expected = StatsReferenceOracle.GetLeaderboardRows(
                squad, statistic, _harness.RatingEngine, _harness.DisplayParameters);
            IReadOnlyList<LeaderboardRow> actual =
                await repository.GetLeaderboardRowsAsync(squad.SquadId, statistic, CancellationToken.None);

            AssertLeaderboardEqual(statistic, expected, actual);

            // Every ranked membership belongs to this squad — never another squad's (Req 1.3).
            Assert.All(actual, row => Assert.Contains(row.MembershipId, squadMembershipIds));
        }
    }

    /// <summary>
    /// Asserts that no membership belonging to any <em>other</em> squad resolves or contributes when
    /// queried against <paramref name="squad"/>: the membership reference and profile aggregates are
    /// both <see langword="null"/>, so a person's membership in a different squad is invisible here
    /// (Requirement 1.4), and the target squad is evaluated in isolation (Requirement 1.3).
    /// </summary>
    private async Task AssertForeignMembershipsAreInvisibleAsync(
        IStatsRepository repository,
        SeededStatsDataset.SquadData squad,
        SeededStatsDataset seeded)
    {
        foreach (SeededStatsDataset.SquadData other in seeded.Squads)
        {
            if (other.SquadId == squad.SquadId)
            {
                continue;
            }

            foreach (SeededStatsDataset.MembershipData foreign in other.Memberships)
            {
                MembershipRef? foreignRef =
                    await repository.FindMembershipAsync(squad.SquadId, foreign.MembershipId, CancellationToken.None);
                Assert.Null(foreignRef);

                MembershipStatsData? foreignStats =
                    await repository.GetMembershipStatsAsync(squad.SquadId, foreign.MembershipId, CancellationToken.None);
                Assert.Null(foreignStats);
            }
        }
    }

    private static void AssertStatsEqual(MembershipStatsData? expected, MembershipStatsData? actual)
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

    private static void AssertLeaderboardEqual(
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

            bool streak = statistic is LeaderboardStatistic.WinStreak or LeaderboardStatistic.UnbeatenStreak;
            if (streak)
            {
                int expectedStreak = statistic == LeaderboardStatistic.WinStreak
                    ? PitchMate.Domain.Stats.StreakCalculator.LongestWinStreak(row.Results ?? [])
                    : PitchMate.Domain.Stats.StreakCalculator.LongestUnbeatenStreak(row.Results ?? []);
                int actualStreak = statistic == LeaderboardStatistic.WinStreak
                    ? PitchMate.Domain.Stats.StreakCalculator.LongestWinStreak(match.Results ?? [])
                    : PitchMate.Domain.Stats.StreakCalculator.LongestUnbeatenStreak(match.Results ?? []);
                Assert.Equal(expectedStreak, actualStreak);
            }
            else
            {
                Assert.Equal(row.Value, match.Value);
            }
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
