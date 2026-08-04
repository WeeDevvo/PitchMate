using FsCheck;
using FsCheck.Xunit;
using PitchMate.Application.Stats;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// Model-based property test for the bib-appearances statistic (task 6.9), validating design
/// <c>Property 12: Bib appearances</c> against the real <c>EfStatsRepository</c> SQL on a
/// Testcontainers PostgreSQL instance, using the pure <see cref="StatsReferenceOracle"/> as the
/// source of truth.
/// <para>
/// A bib appearance is a <c>Completed</c> match in which the membership's kickoff team carried a
/// <c>true</c> <c>BibFlag</c>. For any generated squad and any membership in it, the property asserts:
/// </para>
/// <list type="number">
/// <item>
/// <description>
/// <b>Bib-appearance count (Requirements 12.1, 12.2, 12.3, 12.6)</b> — the repository's
/// <c>BibAppearances</c> from <see cref="IStatsRepository.GetMembershipStatsAsync"/> MUST equal the
/// oracle's: the number of distinct <c>Completed</c> matches in which the membership is present in a
/// bib-wearing kickoff team's roster, each match counted at most once, contributing zero from any
/// match with no bib-wearing team.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>Bib appearance is an appearance</b> — a bib appearance is always an appearance, so
/// <c>0 &lt;= BibAppearances &lt;= Appearances</c>.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>No-bib reporting (Requirement 12.4)</b> — when the membership never appeared on a bib-wearing
/// team the count is reported as zero.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>Bib-appearances leaderboard (Requirements 12.5, 12.6)</b> — the repository's
/// <see cref="IStatsRepository.GetLeaderboardRowsAsync"/> rows for
/// <see cref="LeaderboardStatistic.BibAppearances"/> MUST equal the oracle's as a set keyed by
/// membership identity (same members, same <c>Value</c>, same <c>DisplayName</c>), and every eligible
/// row belongs to a membership with at least one appearance.
/// </description>
/// </item>
/// </list>
/// <para>
/// The generator supplies matches with and without bib-wearing teams, multi-team and uneven lineups
/// drawn from a shared pool (so a membership recurs across matches on bibbed and non-bibbed teams),
/// and memberships with zero appearances, so the excluded and zero cases are exercised as part of the
/// generated space.
/// </para>
/// <para>
/// Each iteration migrates, seeds, and drops its own throwaway database via
/// <see cref="StatsModelBasedHarness"/>, so <see cref="MaxTest"/> is kept modest; because every
/// generated dataset carries one to three squads of fifteen to twenty memberships, a single iteration
/// already performs dozens of independent bib-count comparisons plus a per-squad leaderboard
/// comparison, so the run clears well over 100 logical checks in total. Requires Docker.
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class BibAppearancesPropertyTests
{
    // Modest generated-dataset count: each seeds/drops a real database, yet every dataset yields
    // 15..60 per-membership bib comparisons plus per-squad leaderboard checks, so total logical
    // checks far exceed 100.
    private const int MaxTest = 10;

    private readonly StatsModelBasedHarness _harness;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public BibAppearancesPropertyTests(PostgreSqlContainerFixture fixture)
    {
        _harness = new StatsModelBasedHarness(fixture);
    }

    // Feature: stats-and-summaries, Property 12: For any membership, the Bib_Appearance count equals
    // the number of Completed matches in which the membership appears on a kickoff team whose BibFlag
    // is true, counting each match at most once and counting zero from any match that has no
    // bib-wearing team, and is 0 when the membership never appeared on a bib-wearing team; the
    // bib-appearances leaderboard ranks the squad's memberships by descending Bib_Appearance count
    // with an ascending-identity tie-break so repeated requests return the same order.
    /// <summary>
    /// **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6**
    /// </summary>
    [Property(MaxTest = MaxTest, Arbitrary = new[] { typeof(StatsDatasetArbitraries) })]
    public Property BibAppearanceCountEqualsDistinctCompletedBibTeamMatches(StatsDatasetSpec spec) =>
        RunAsync(async () =>
        {
            await _harness.WithSeededDatasetAsync(spec, async (repository, seeded) =>
            {
                foreach (SeededStatsDataset.SquadData squad in seeded.Squads)
                {
                    await AssertMembershipBibCountsAsync(repository, squad);
                    await AssertBibLeaderboardAsync(repository, squad);
                }
            });

            return true;
        });

    /// <summary>
    /// Asserts, for every membership in <paramref name="squad"/>, that the repository's bib-appearance
    /// count equals the oracle's (Requirements 12.1, 12.2, 12.3, 12.6), never exceeds the appearance
    /// count (a bib appearance is always an appearance), and is zero when the membership never appeared
    /// on a bib-wearing team (Requirement 12.4).
    /// </summary>
    private static async Task AssertMembershipBibCountsAsync(
        IStatsRepository repository, SeededStatsDataset.SquadData squad)
    {
        foreach (SeededStatsDataset.MembershipData member in squad.Memberships)
        {
            MembershipStatsData? expected =
                StatsReferenceOracle.GetMembershipStats(squad, member.MembershipId);
            MembershipStatsData? actual = await repository.GetMembershipStatsAsync(
                squad.SquadId, member.MembershipId, CancellationToken.None);

            // A member of the squad always resolves on both sides (Req 12.4 covers zero).
            Assert.NotNull(expected);
            Assert.NotNull(actual);

            // The count is a non-negative integer.
            Assert.True(actual!.BibAppearances >= 0);

            // The SQL agrees with the definition for every membership — including members who never
            // wore bibs and members recurring across bibbed/non-bibbed, multi-team and uneven lineups
            // (Req 12.1, 12.2, 12.3, 12.6).
            Assert.Equal(expected!.BibAppearances, actual.BibAppearances);

            // A bib appearance is always an appearance, so the bib count never exceeds appearances.
            Assert.True(actual.BibAppearances <= actual.Appearances);

            // When the membership never appeared on a bib-wearing team the count is zero (Req 12.4).
            if (expected.BibAppearances == 0)
            {
                Assert.Equal(0, actual.BibAppearances);
            }
        }
    }

    /// <summary>
    /// Asserts that the repository's bib-appearances leaderboard rows equal the oracle's as a set keyed
    /// by membership identity — same members, same <c>Value</c>, and same <c>DisplayName</c> — and that
    /// every eligible row belongs to a membership with at least one appearance (Requirements 12.5,
    /// 12.6). The rows are compared unordered because the SQL guarantees no order; the ranking order
    /// itself is the subject of Property 13 (task 6.10).
    /// </summary>
    private async Task AssertBibLeaderboardAsync(
        IStatsRepository repository, SeededStatsDataset.SquadData squad)
    {
        IReadOnlyList<LeaderboardRow> expectedRows = StatsReferenceOracle.GetLeaderboardRows(
            squad, LeaderboardStatistic.BibAppearances, _harness.RatingEngine, _harness.DisplayParameters);
        IReadOnlyList<LeaderboardRow> actualRows = await repository.GetLeaderboardRowsAsync(
            squad.SquadId, LeaderboardStatistic.BibAppearances, CancellationToken.None);

        Dictionary<Guid, LeaderboardRow> expectedById = expectedRows.ToDictionary(row => row.MembershipId);
        Dictionary<Guid, LeaderboardRow> actualById = actualRows.ToDictionary(row => row.MembershipId);

        // The eligible membership set matches exactly (no more, no fewer).
        Assert.Equal(expectedById.Keys.OrderBy(id => id), actualById.Keys.OrderBy(id => id));

        foreach ((Guid membershipId, LeaderboardRow expectedRow) in expectedById)
        {
            LeaderboardRow actualRow = actualById[membershipId];

            // Bib appearances is a counting statistic: the value is carried, not a streak sequence.
            Assert.NotNull(actualRow.Value);
            Assert.Equal(expectedRow.Value, actualRow.Value);
            Assert.Equal(expectedRow.DisplayName, actualRow.DisplayName);

            // Only memberships with at least one appearance are eligible (Req 12.5 via 4.4).
            MembershipStatsData? stats = StatsReferenceOracle.GetMembershipStats(squad, membershipId);
            Assert.NotNull(stats);
            Assert.True(stats!.Appearances >= 1);
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
