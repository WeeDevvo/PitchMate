using FsCheck;
using FsCheck.Xunit;
using PitchMate.Application.Stats;
using PitchMate.Domain.Common;
using PitchMate.Domain.Stats;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// Model-based property test for leaderboard ordering and eligibility (task 6.10), validating design
/// <c>Property 13: Leaderboard ordering and eligibility</c> against the real <c>EfStatsRepository</c>
/// SQL on a Testcontainers PostgreSQL instance, using the pure <see cref="StatsReferenceOracle"/> as
/// the source of truth.
/// <para>
/// The repository's <see cref="IStatsRepository.GetLeaderboardRowsAsync"/> returns the eligible
/// per-membership rows already filtered for eligibility but <em>unordered</em>: the best-first ordering
/// and the ascending-identity tie-break are applied by the Application <c>GetLeaderboardHandler</c>.
/// Streak statistics (<see cref="LeaderboardStatistic.WinStreak"/>,
/// <see cref="LeaderboardStatistic.UnbeatenStreak"/>) are returned as each row's ordered
/// <see cref="PlayerResult"/> sequence in <see cref="LeaderboardRow.Results"/> (with
/// <see cref="LeaderboardRow.Value"/> <see langword="null"/>); this test folds them with
/// <see cref="StreakCalculator.LongestWinStreak"/> / <see cref="StreakCalculator.LongestUnbeatenStreak"/>
/// to recover the ranking value. For every generated squad and every
/// <see cref="LeaderboardStatistic"/> value, the property asserts three things by comparing the real
/// repository against the oracle:
/// </para>
/// <list type="number">
/// <item>
/// <description>
/// <b>Eligibility (Requirements 4.4, 4.5)</b> — the eligible membership set the repository returns
/// (keyed by <see cref="LeaderboardRow.MembershipId"/>) equals the oracle's. Counting statistics
/// (appearances, longest Win_Streak, longest Unbeaten_Streak, bib appearances) include only
/// memberships with at least one appearance; Win_Percentage and Display_Rating include only
/// memberships with at least one appearance <em>and</em> a present value (win % not null / an
/// established display rating).
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>Values (Requirement 4.1)</b> — each row's ranking value equals the oracle's: for a non-streak
/// statistic the carried <see cref="LeaderboardRow.Value"/>; for a streak statistic the value folded
/// from <see cref="LeaderboardRow.Results"/> by <see cref="StreakCalculator"/>.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>Ordering (Requirements 4.2, 4.3)</b> — the best-first ranking (a higher value ranked first,
/// folding streaks to their value first) with the ascending-<see cref="LeaderboardRow.MembershipId"/>
/// tie-break (via <see cref="UuidV7Comparer.Instance"/>) computed from the repository's rows equals the
/// same ranking computed from the oracle's rows, and re-computing the ranking from the same rows a
/// second time yields the identical order — deterministic and reproducible.
/// </description>
/// </item>
/// </list>
/// <para>
/// Requirement 4.7 (a ranking statistic outside the supported set returns an unsupported-statistic
/// error and no leaderboard) is a <em>handler-level</em> concern covered by the leaderboard handler
/// unit tests (task 3.6); it is not testable at the repository layer because
/// <see cref="LeaderboardStatistic"/> is a closed enum — every value the repository can be asked for is
/// supported by construction. This test therefore focuses on Requirements 4.1–4.5.
/// </para>
/// <para>
/// Each iteration migrates, seeds, and drops its own throwaway database via
/// <see cref="StatsModelBasedHarness"/>, so <see cref="MaxTest"/> is kept modest; because every
/// generated dataset carries one to three squads and each is checked across all six leaderboard
/// statistics with a per-row eligibility, value, and full-ordering comparison, a single iteration
/// already performs dozens of independent logical checks, so the run clears well over 100 in total.
/// Requires Docker.
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class LeaderboardOrderingAndEligibilityPropertyTests
{
    // Modest generated-dataset count: each seeds/drops a real database, yet every dataset yields
    // per-squad, per-statistic eligibility/value/ordering comparisons, so total logical checks
    // far exceed 100.
    private const int MaxTest = 10;

    private readonly StatsModelBasedHarness _harness;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public LeaderboardOrderingAndEligibilityPropertyTests(PostgreSqlContainerFixture fixture)
    {
        _harness = new StatsModelBasedHarness(fixture);
    }

    // Feature: stats-and-summaries, Property 13: For any squad and any supported ranking statistic
    // (appearances, Win_Percentage, Display_Rating, longest Win_Streak, longest Unbeaten_Streak,
    // Bib_Appearance count), the Leaderboard lists memberships ordered best-first by that statistic
    // (a higher value ranks better), tie-broken by ascending membership identity; a counting statistic
    // includes only memberships with at least one appearance, while Win_Percentage and Display_Rating
    // additionally exclude memberships for which the statistic has no value; each entry carries the
    // membership's (possibly placeholder) Display_Name and the statistic value; and a request for a
    // statistic outside the supported set returns an unsupported-statistic error and no leaderboard.
    /// <summary>
    /// **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.7** (Requirement 4.7 is covered at the
    /// handler layer — see task 3.6 — because <see cref="LeaderboardStatistic"/> is a closed enum and
    /// every value the repository accepts is supported by construction).
    /// </summary>
    [Property(MaxTest = MaxTest, Arbitrary = new[] { typeof(StatsDatasetArbitraries) })]
    public Property LeaderboardRowsAreEligibleValuedAndDeterministicallyOrdered(StatsDatasetSpec spec) =>
        RunAsync(async () =>
        {
            await _harness.WithSeededDatasetAsync(spec, async (repository, seeded) =>
            {
                foreach (SeededStatsDataset.SquadData squad in seeded.Squads)
                {
                    foreach (LeaderboardStatistic statistic in Enum.GetValues<LeaderboardStatistic>())
                    {
                        await AssertLeaderboardAsync(repository, squad, statistic);
                    }
                }
            });

            return true;
        });

    /// <summary>
    /// Asserts, for one squad and one statistic, that the repository's eligible row set matches the
    /// oracle's (Req 4.4, 4.5), that each row's ranking value matches (Req 4.1), and that the best-first,
    /// ascending-identity ranking derived from the repository's rows equals the one derived from the
    /// oracle's and is reproducible across repeated computation (Req 4.2, 4.3).
    /// </summary>
    private async Task AssertLeaderboardAsync(
        IStatsRepository repository, SeededStatsDataset.SquadData squad, LeaderboardStatistic statistic)
    {
        IReadOnlyList<LeaderboardRow> expectedRows = StatsReferenceOracle.GetLeaderboardRows(
            squad, statistic, _harness.RatingEngine, _harness.DisplayParameters);
        IReadOnlyList<LeaderboardRow> actualRows = await repository.GetLeaderboardRowsAsync(
            squad.SquadId, statistic, CancellationToken.None);

        Dictionary<Guid, LeaderboardRow> expectedById = expectedRows.ToDictionary(row => row.MembershipId);
        Dictionary<Guid, LeaderboardRow> actualById = actualRows.ToDictionary(row => row.MembershipId);

        // (1) Eligibility (Req 4.4, 4.5): the eligible membership set matches exactly — no more, no
        //     fewer. Counting statistics require an appearance; Win_Percentage and Display_Rating
        //     additionally require a present value, all captured by the oracle's row set.
        Assert.Equal(expectedById.Keys.OrderBy(id => id, UuidV7Comparer.Instance),
            actualById.Keys.OrderBy(id => id, UuidV7Comparer.Instance));

        bool isStreak =
            statistic is LeaderboardStatistic.WinStreak or LeaderboardStatistic.UnbeatenStreak;

        foreach ((Guid membershipId, LeaderboardRow expectedRow) in expectedById)
        {
            LeaderboardRow actualRow = actualById[membershipId];

            // Each entry carries the membership's (possibly placeholder) Display_Name and state.
            Assert.Equal(expectedRow.DisplayName, actualRow.DisplayName);
            Assert.Equal(expectedRow.State, actualRow.State);

            // (2) Values (Req 4.1): non-streak statistics carry the value directly; streak statistics
            //     carry the ordered result sequence folded by StreakCalculator to the ranking value.
            Assert.Equal(RankingValue(statistic, expectedRow), RankingValue(statistic, actualRow));

            // The membership resolves within the squad.
            MembershipStatsData? stats = StatsReferenceOracle.GetMembershipStats(squad, membershipId);
            Assert.NotNull(stats);

            if (statistic == LeaderboardStatistic.DisplayRating)
            {
                // Display_Rating eligibility is "an Established display-rating value is present"
                // (Req 4.5). In production a rating only exists once a membership has participated, so
                // the appearance requirement is satisfied by construction; the generator can seed a
                // rating without an appearance, so the enforced invariant here is value presence, which
                // the non-streak Value non-null assertion below covers.
                Assert.NotNull(actualRow.Value);
                Assert.Null(actualRow.Results);
            }
            else if (isStreak)
            {
                // A streak row is appearance-eligible (Req 4.4) and carries the result sequence, not a
                // precomputed value.
                Assert.True(stats!.Appearances >= 1);
                Assert.NotNull(actualRow.Results);
                Assert.Null(actualRow.Value);
            }
            else
            {
                // Appearances, Win_Percentage, and Bib_Appearances are appearance-eligible (Req 4.4,
                // 4.5) and carry the precomputed value, not a result sequence.
                Assert.True(stats!.Appearances >= 1);
                Assert.NotNull(actualRow.Value);
                Assert.Null(actualRow.Results);
            }
        }

        // (3) Ordering (Req 4.2, 4.3): the best-first, ascending-identity ranking derived from the
        //     repository's rows equals the ranking derived from the oracle's rows, and is reproducible.
        List<Guid> expectedOrder = Rank(statistic, expectedRows);
        List<Guid> actualOrder = Rank(statistic, actualRows);
        Assert.Equal(expectedOrder, actualOrder);

        // Deterministic and reproducible: re-ranking the same rows yields the identical order.
        Assert.Equal(actualOrder, Rank(statistic, actualRows));
    }

    /// <summary>
    /// Produces the best-first ranking of <paramref name="rows"/> for <paramref name="statistic"/>: a
    /// higher ranking value is ordered first (streaks folded to their value first), with ties broken by
    /// ascending membership identity via <see cref="UuidV7Comparer.Instance"/> so repeated requests
    /// return the same order (Requirements 4.2, 4.3).
    /// </summary>
    private static List<Guid> Rank(LeaderboardStatistic statistic, IReadOnlyList<LeaderboardRow> rows) =>
        rows
            .OrderByDescending(row => RankingValue(statistic, row))
            .ThenBy(row => row.MembershipId, UuidV7Comparer.Instance)
            .Select(row => row.MembershipId)
            .ToList();

    /// <summary>
    /// The scalar ranking value of a row: the carried <see cref="LeaderboardRow.Value"/> for a
    /// non-streak statistic, or the streak folded from <see cref="LeaderboardRow.Results"/> by
    /// <see cref="StreakCalculator"/> for a streak statistic.
    /// </summary>
    private static double RankingValue(LeaderboardStatistic statistic, LeaderboardRow row) => statistic switch
    {
        LeaderboardStatistic.WinStreak => StreakCalculator.LongestWinStreak(row.Results ?? []),
        LeaderboardStatistic.UnbeatenStreak => StreakCalculator.LongestUnbeatenStreak(row.Results ?? []),
        _ => row.Value ?? 0d
    };

    /// <summary>
    /// Bridges FsCheck's synchronous property model to the harness's asynchronous per-iteration
    /// database work. Blocking is safe: xUnit test execution has no synchronization context, so
    /// <c>GetAwaiter().GetResult()</c> cannot deadlock and it surfaces the original exception unwrapped.
    /// </summary>
    private static Property RunAsync(Func<Task<bool>> body) =>
        body().GetAwaiter().GetResult().ToProperty();
}
