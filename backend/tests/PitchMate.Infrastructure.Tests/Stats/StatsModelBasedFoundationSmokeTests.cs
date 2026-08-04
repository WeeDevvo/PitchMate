using PitchMate.Application.Stats;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Stats;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// A single, minimal end-to-end smoke test for the task 6.1 foundation: it hand-builds a
/// <see cref="StatsDatasetSpec"/> that spans every <see cref="MatchState"/> (so the
/// <see cref="StatsDatasetSeeder"/> exercises every lifecycle branch), seeds it into a real
/// PostgreSQL database via the shared Testcontainers fixture, and confirms the real
/// <c>EfStatsRepository</c> agrees with the <see cref="StatsReferenceOracle"/> on the per-membership
/// aggregates and each leaderboard statistic. The exhaustive, generator-driven comparison is the job
/// of the model-based property tests (tasks 6.2–6.11); this only proves the oracle, generators'
/// output shape, seeder, and fixture fit together.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class StatsModelBasedFoundationSmokeTests
{
    private readonly StatsModelBasedHarness _harness;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public StatsModelBasedFoundationSmokeTests(PostgreSqlContainerFixture fixture)
    {
        _harness = new StatsModelBasedHarness(fixture);
    }

    [Fact]
    public async Task SeededDataset_RepositoryMatchesReferenceOracle()
    {
        StatsDatasetSpec spec = BuildSpec();

        await _harness.WithSeededDatasetAsync(spec, async (repository, seeded) =>
        {
            SeededStatsDataset.SquadData squad = seeded.SquadAt(0);

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

            foreach (LeaderboardStatistic statistic in Enum.GetValues<LeaderboardStatistic>())
            {
                IReadOnlyList<LeaderboardRow> expected = StatsReferenceOracle.GetLeaderboardRows(
                    squad, statistic, _harness.RatingEngine, _harness.DisplayParameters);
                IReadOnlyList<LeaderboardRow> actual =
                    await repository.GetLeaderboardRowsAsync(squad.SquadId, statistic, CancellationToken.None);

                AssertLeaderboardEqual(statistic, expected, actual);
            }
        });
    }

    /// <summary>
    /// One squad of twelve registered members (a few carrying ratings) and one match in each lifecycle
    /// state — completed, teams-rolled, in-progress (all 5v5), plus confirmed, gathering, and cancelled.
    /// </summary>
    private static StatsDatasetSpec BuildSpec()
    {
        var members = new List<StatsDatasetSpec.MembershipSpec>();
        for (int i = 0; i < 12; i++)
        {
            StatsDatasetSpec.RatingSpec? rating = i < 6 ? new StatsDatasetSpec.RatingSpec(25.0, 1.0 + i) : null;
            members.Add(new StatsDatasetSpec.MembershipSpec(IsGuest: i % 4 == 0, Inactive: false, Anonymise: false, rating));
        }

        StatsDatasetSpec.MatchSpec Rolled(MatchState state, int seed, int offset) =>
            new(state, ResultFidelity.Basic, [5, 5], seed, [3, 1], BibTeamIndex: 1, CompletedOffsetSeconds: offset);

        StatsDatasetSpec.MatchSpec Teamless(MatchState state) =>
            new(state, ResultFidelity.Basic, [5, 5], ShuffleSeed: 0, [0, 0], BibTeamIndex: 0, CompletedOffsetSeconds: 0);

        var matches = new List<StatsDatasetSpec.MatchSpec>
        {
            Rolled(MatchState.Completed, seed: 7, offset: 0),
            Rolled(MatchState.Completed, seed: 21, offset: 3),
            Rolled(MatchState.TeamsRolled, seed: 5, offset: 0),
            Rolled(MatchState.InProgress, seed: 9, offset: 0),
            Teamless(MatchState.Confirmed),
            Teamless(MatchState.GatheringAvailability),
            Teamless(MatchState.Cancelled)
        };

        return new StatsDatasetSpec([new StatsDatasetSpec.SquadSpec(LiveMatchTracking: false, members, matches)]);
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
                    ? StreakCalculator.LongestWinStreak(row.Results ?? [])
                    : StreakCalculator.LongestUnbeatenStreak(row.Results ?? []);
                int actualStreak = statistic == LeaderboardStatistic.WinStreak
                    ? StreakCalculator.LongestWinStreak(match.Results ?? [])
                    : StreakCalculator.LongestUnbeatenStreak(match.Results ?? []);
                Assert.Equal(expectedStreak, actualStreak);
            }
            else
            {
                Assert.Equal(row.Value, match.Value);
            }
        }
    }
}
