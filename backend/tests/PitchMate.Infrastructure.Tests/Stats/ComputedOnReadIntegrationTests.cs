using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Stats;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Rating;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Stats;
using PitchMate.Infrastructure.Tests.Persistence;
using DisplayRatingParameters = PitchMate.Domain.Stats.DisplayRatingParameters;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// Cross-cutting integration test (task 9.1) proving the stats read surface is <em>computed on read</em>
/// over the normalised match record and that no denormalised summary — table, entity, or write path —
/// exists. Runs against real PostgreSQL via the shared Testcontainers fixture, migrating a throwaway
/// database, seeding a squad through the real domain lifecycle (<see cref="StatsDatasetSeeder"/>), and
/// exercising the production <see cref="EfStatsRepository"/>. Validates:
/// <list type="bullet">
/// <item><description>
/// <b>Requirement 2.1 / 2.5</b> — every returned statistic equals the value the pure
/// <see cref="StatsReferenceOracle"/> computes from the normalised Match / Kickoff lineup / result /
/// rating / snapshot rows, so the read path aggregates those tables at request time.
/// </description></item>
/// <item><description>
/// <b>Requirement 2.1</b> (live) — mutating a normalised table (soft-deleting one completed match)
/// is reflected immediately on the next read, with no summary to maintain: the aggregate recomputes
/// from the live rows.
/// </description></item>
/// <item><description>
/// <b>Requirement 2.2</b> — the migrated schema carries the normalised read inputs but no
/// stats-summary table; the EF model maps no summary entity; and <see cref="IStatsRepository"/> exposes
/// read operations only (no write path that persists computed statistics).
/// </description></item>
/// </list>
/// Requires Docker.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class ComputedOnReadIntegrationTests
{
    private readonly PostgreSqlContainerFixture _fixture;
    private readonly StatsDatasetSeeder _seeder = new();
    private readonly IRatingEngine _ratingEngine = new PlackettLuceRatingEngine(new RatingEngineConfig());
    private readonly DisplayRatingParameters _displayParameters = DisplayRatingParameters.Default;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public ComputedOnReadIntegrationTests(PostgreSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    /// <summary>
    /// **Validates: Requirements 2.1, 2.5** — with a squad seeded into the normalised tables, the
    /// production repository's per-membership aggregates and every leaderboard statistic equal the
    /// values the reference oracle derives purely from those normalised rows, proving the statistics
    /// are computed on read by aggregation rather than read from any persisted summary.
    /// </summary>
    [Fact]
    public async Task ReadPath_ComputesStatisticsByAggregatingNormalisedTables()
    {
        await WithSeededSquadAsync(BuildSquadSpec(), async (connectionString, seeded) =>
        {
            SeededStatsDataset.SquadData squad = seeded.SquadAt(0);

            await using PitchMateDbContext read = CreateContext(connectionString);
            EfStatsRepository repository = CreateRepository(read);

            foreach (SeededStatsDataset.MembershipData member in squad.Memberships)
            {
                MembershipStatsData? expected = StatsReferenceOracle.GetMembershipStats(squad, member.MembershipId);
                MembershipStatsData? actual =
                    await repository.GetMembershipStatsAsync(squad.SquadId, member.MembershipId, CancellationToken.None);
                AssertStatsEqual(expected, actual);
            }

            foreach (LeaderboardStatistic statistic in Enum.GetValues<LeaderboardStatistic>())
            {
                IReadOnlyList<LeaderboardRow> expected = StatsReferenceOracle.GetLeaderboardRows(
                    squad, statistic, _ratingEngine, _displayParameters);
                IReadOnlyList<LeaderboardRow> actual =
                    await repository.GetLeaderboardRowsAsync(squad.SquadId, statistic, CancellationToken.None);
                AssertLeaderboardEqual(statistic, expected, actual);
            }
        });
    }

    /// <summary>
    /// **Validates: Requirements 2.1, 2.2, 2.5** — after an initial read, directly soft-deleting one
    /// completed match the subject appeared in (a change to a normalised table) is reflected on the very
    /// next read: the subject's appearance count drops by one and the whole aggregate equals the oracle
    /// recomputed over the remaining completed matches. Because no summary is stored, no rebuild step is
    /// invoked — the read path simply re-aggregates the live rows.
    /// </summary>
    [Fact]
    public async Task ReadPath_ReflectsLiveChangeToNormalisedTables_WithNoSummaryToMaintain()
    {
        await WithSeededSquadAsync(BuildSquadSpec(), async (connectionString, seeded) =>
        {
            SeededStatsDataset.SquadData squad = seeded.SquadAt(0);

            // A membership present in more than one completed match, so removing one still leaves history.
            SeededStatsDataset.MembershipData subject = squad.Memberships.First(member =>
                StatsReferenceOracle.GetMembershipStats(squad, member.MembershipId)!.Appearances >= 2);

            int appearancesBefore;
            await using (PitchMateDbContext read = CreateContext(connectionString))
            {
                MembershipStatsData? before = await CreateRepository(read)
                    .GetMembershipStatsAsync(squad.SquadId, subject.MembershipId, CancellationToken.None);
                appearancesBefore = before!.Appearances;
            }

            // Mutate a normalised table: soft-delete one completed match the subject played in.
            Guid removedMatchId = squad.Matches
                .First(match => match.State == MatchState.Completed
                    && match.Teams.Any(team => team.Roster.Contains(subject.MembershipId)))
                .MatchId;

            await using (PitchMateDbContext write = CreateContext(connectionString))
            {
                Match match = await write.Set<Match>().FirstAsync(m => m.Id == removedMatchId);
                write.Set<Match>().Remove(match); // the save pipeline reinterprets this as a soft-delete
                await write.SaveChangesAsync();
            }

            await using (PitchMateDbContext read = CreateContext(connectionString))
            {
                MembershipStatsData? after = await CreateRepository(read)
                    .GetMembershipStatsAsync(squad.SquadId, subject.MembershipId, CancellationToken.None);

                Assert.Equal(appearancesBefore - 1, after!.Appearances);

                // The recomputed aggregate matches the oracle over the squad without the removed match,
                // confirming the read aggregates the live normalised rows, not a persisted summary.
                SeededStatsDataset.SquadData reduced = squad with
                {
                    Matches = squad.Matches.Where(match => match.MatchId != removedMatchId).ToList()
                };
                MembershipStatsData? expected = StatsReferenceOracle.GetMembershipStats(reduced, subject.MembershipId);
                AssertStatsEqual(expected, after);
            }
        });
    }

    /// <summary>
    /// **Validates: Requirement 2.2** — the migrated schema contains the normalised read inputs the
    /// aggregation reads, the EF model maps no stats-summary entity, and no table denormalises computed
    /// statistics.
    /// </summary>
    [Fact]
    public async Task MigratedSchema_ContainsNormalisedInputsButNoStatsSummaryTable()
    {
        await WithSeededSquadAsync(BuildSquadSpec(), async (connectionString, _) =>
        {
            List<string> tables = await MigrationTestSupport.ListModelTablesAsync(connectionString);

            await using PitchMateDbContext context = CreateContext(connectionString);

            // The normalised inputs the aggregation reads all exist as real tables.
            Type[] normalisedInputs =
            [
                typeof(Match), typeof(MatchTeam), typeof(RatingSnapshot),
                typeof(MembershipRating), typeof(SquadMembership), typeof(Squad)
            ];
            foreach (Type inputType in normalisedInputs)
            {
                string? tableName = context.Model.FindEntityType(inputType)?.GetTableName();
                Assert.NotNull(tableName);
                Assert.Contains(tableName!, tables);
            }

            // No denormalised stats-summary table (Requirement 2.2).
            Assert.DoesNotContain(tables, t => t.Contains("summary", StringComparison.OrdinalIgnoreCase));
            Assert.DoesNotContain(tables, t => t.Contains("player_stats", StringComparison.OrdinalIgnoreCase));

            // No mapped entity denormalises statistics: none named like a summary, none from the
            // pure Domain.Stats namespace (its calculators/value objects are never persisted).
            List<Type> mappedTypes = context.Model.GetEntityTypes().Select(e => e.ClrType).ToList();
            Assert.DoesNotContain(mappedTypes, t => t.Name.Contains("Summary", StringComparison.OrdinalIgnoreCase));
            Assert.DoesNotContain(mappedTypes, t => t.Namespace == "PitchMate.Domain.Stats");
        });
    }

    /// <summary>
    /// **Validates: Requirement 2.2** — the stats aggregation abstraction exposes read operations only,
    /// so there is no write path that persists computed statistics. This is a pure model check needing
    /// no database.
    /// </summary>
    [Fact]
    public void StatsRepository_ExposesReadOperationsOnly_WithNoWritePath()
    {
        System.Reflection.MethodInfo[] methods = typeof(IStatsRepository).GetMethods();

        Assert.All(methods, method =>
            Assert.True(
                method.Name.StartsWith("Get", StringComparison.Ordinal)
                || method.Name.StartsWith("Find", StringComparison.Ordinal),
                $"IStatsRepository.{method.Name} is not a read operation; the stats surface must expose no write path (Req 2.2)."));

        string[] writeVerbs =
            ["Save", "Add", "Insert", "Update", "Delete", "Remove", "Persist", "Write", "Upsert", "Rebuild", "Store"];
        Assert.DoesNotContain(
            methods,
            method => writeVerbs.Any(verb => method.Name.Contains(verb, StringComparison.OrdinalIgnoreCase)));
    }

    /// <summary>
    /// One squad of twelve memberships (a few carrying ratings, one guest) with three completed matches
    /// sharing the same roster — so the shared players appear in every one, giving the live-mutation test
    /// a multi-appearance subject — plus an in-progress and a cancelled match that must contribute nothing.
    /// </summary>
    private static StatsDatasetSpec BuildSquadSpec()
    {
        var members = new List<StatsDatasetSpec.MembershipSpec>();
        for (int i = 0; i < 12; i++)
        {
            StatsDatasetSpec.RatingSpec? rating =
                i < 4 ? new StatsDatasetSpec.RatingSpec(27.0, 1.0 + (i * 0.2)) : null;
            members.Add(new StatsDatasetSpec.MembershipSpec(
                IsGuest: i % 5 == 0, Inactive: false, Anonymise: false, rating));
        }

        // Same shuffle seed => same roster/partition across the three matches, so the ten selected
        // players each appear in all three completed matches.
        StatsDatasetSpec.MatchSpec Completed(int offset, int[] scores) =>
            new(MatchState.Completed, ResultFidelity.Basic, [5, 5], ShuffleSeed: 1, scores, BibTeamIndex: 1, offset);

        var matches = new List<StatsDatasetSpec.MatchSpec>
        {
            Completed(offset: 0, [3, 1]),
            Completed(offset: 60, [2, 2]),
            Completed(offset: 120, [0, 4]),
            new(MatchState.InProgress, ResultFidelity.Basic, [5, 5], ShuffleSeed: 1, [0, 0], BibTeamIndex: 0, CompletedOffsetSeconds: 0),
            new(MatchState.Cancelled, ResultFidelity.Basic, [5, 5], ShuffleSeed: 0, [0, 0], BibTeamIndex: 0, CompletedOffsetSeconds: 0)
        };

        return new StatsDatasetSpec([new StatsDatasetSpec.SquadSpec(LiveMatchTracking: false, members, matches)]);
    }

    /// <summary>
    /// Creates a fresh, migrated throwaway database on the shared server, seeds <paramref name="spec"/>
    /// into it, invokes <paramref name="body"/> with its connection string and the resolved dataset, then
    /// drops the database regardless of outcome.
    /// </summary>
    private async Task WithSeededSquadAsync(
        StatsDatasetSpec spec,
        Func<string, SeededStatsDataset, Task> body)
    {
        var databaseName = "stats_cor_" + Guid.NewGuid().ToString("N");
        await MigrationTestSupport.CreateDatabaseAsync(_fixture.ConnectionString, databaseName);

        try
        {
            string connectionString =
                MigrationTestSupport.ConnectionStringForDatabase(_fixture.ConnectionString, databaseName);

            await using (PitchMateDbContext schema = CreateContext(connectionString))
            {
                await schema.Database.MigrateAsync();
            }

            SeededStatsDataset seeded;
            await using (PitchMateDbContext write = CreateContext(connectionString))
            {
                seeded = await _seeder.SeedAsync(write, spec, new FakeTimeProvider(), CancellationToken.None);
            }

            await body(connectionString, seeded);
        }
        finally
        {
            await MigrationTestSupport.DropDatabaseAsync(_fixture.ConnectionString, databaseName);
        }
    }

    private static PitchMateDbContext CreateContext(string connectionString) =>
        new(
            MigrationTestSupport.BuildContextOptions(connectionString),
            new FakeTimeProvider(),
            new FakeCurrentUserAccessor());

    private EfStatsRepository CreateRepository(PitchMateDbContext context) =>
        new(context, _ratingEngine, new SquadDisplayRatingParametersSource());

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
}
