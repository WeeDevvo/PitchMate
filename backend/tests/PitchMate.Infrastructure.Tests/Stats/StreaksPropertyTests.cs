using FsCheck;
using FsCheck.Xunit;
using PitchMate.Application.Stats;
using PitchMate.Domain.Stats;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// Model-based property test for the longest win and unbeaten streaks (task 6.6), validating design
/// <c>Property 6: Longest win and unbeaten streaks</c> against the real <c>EfStatsRepository</c> SQL on
/// a Testcontainers PostgreSQL instance, using the pure <see cref="StatsReferenceOracle"/> — whose
/// per-membership <c>Results</c> is the chronologically-ordered <see cref="PlayerResult"/> sequence
/// (ordered by completion instant then match identity) that both streaks fold over — as the source of
/// truth.
/// <para>
/// For any generated squad and any membership in it, the property asserts five facets over the
/// repository's <see cref="IStatsRepository.GetMembershipStatsAsync"/> output, using the Domain
/// <see cref="StreakCalculator"/> the production read path folds with:
/// </para>
/// <list type="number">
/// <item>
/// <description>
/// <b>Chronological result sequence (Requirement 9.1)</b> — the repository's <c>Results</c> sequence
/// (which drives both streak folds) MUST equal the oracle's: the membership's per-match results ordered
/// by the producing completed match's completion instant, tie-broken by match identity.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>Win streak (Requirements 9.2, 9.5)</b> — <see cref="StreakCalculator.LongestWinStreak"/> over the
/// repository's <c>Results</c> MUST equal the greatest run of consecutive <see cref="PlayerResult.Win"/>
/// results (computed independently here) and MUST equal the same fold over the oracle's <c>Results</c>.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>Unbeaten streak (Requirements 9.3, 9.5)</b> — <see cref="StreakCalculator.LongestUnbeatenStreak"/>
/// over the repository's <c>Results</c> MUST equal the greatest run of consecutive non-<see cref="PlayerResult.Loss"/>
/// (<see cref="PlayerResult.Win"/> or <see cref="PlayerResult.Draw"/>) results, and MUST equal the same
/// fold over the oracle's <c>Results</c>.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>No-appearance streaks (Requirement 9.4)</b> — when the membership has no appearance (an empty
/// <c>Results</c> sequence), both the win streak and the unbeaten streak MUST be zero.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>Degenerate-record streaks (Requirements 9.6, 9.7)</b> — where a membership has at least one
/// appearance but no <see cref="PlayerResult.Win"/>, its win streak MUST be zero; and where every one of
/// its results is a <see cref="PlayerResult.Loss"/>, its unbeaten streak MUST be zero. These edge cases
/// are asserted explicitly on the memberships whose generated data exhibits them.
/// </description>
/// </item>
/// </list>
/// <para>
/// The generator supplies multi-team and uneven lineups drawn from a shared pool (so memberships recur
/// across matches with mixed outcomes), matches whose equal top scores force draws, and memberships
/// with zero appearances, so every facet — including the no-win, all-loss, and empty-record edges — is
/// exercised across the generated space.
/// </para>
/// <para>
/// Each iteration migrates, seeds, and drops its own throwaway database via
/// <see cref="StatsModelBasedHarness"/>, so <see cref="MaxTest"/> is kept modest; because every
/// generated dataset carries one to three squads of fifteen to twenty memberships, a single iteration
/// already performs dozens of independent streak comparisons and the run clears well over 100 logical
/// checks in total. Requires Docker.
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class StreaksPropertyTests
{
    // Modest generated-dataset count: each seeds/drops a real database, yet every dataset yields
    // 15..60 per-membership streak comparisons, so total logical checks exceed 100.
    private const int MaxTest = 10;

    private readonly StatsModelBasedHarness _harness;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public StreaksPropertyTests(PostgreSqlContainerFixture fixture)
    {
        _harness = new StatsModelBasedHarness(fixture);
    }

    // Feature: stats-and-summaries, Property 6: For any membership, its Player_Results are taken in
    // chronological order (completion instant then match identity); the Win_Streak is the greatest count
    // of consecutive Win results and the Unbeaten_Streak the greatest count of consecutive non-Loss (Win
    // or Draw) results in that order; both streaks are zero when the membership has no appearance; the
    // Win_Streak is zero when the membership has at least one appearance but no Win; and the
    // Unbeaten_Streak is zero when every result is a Loss.
    /// <summary>
    /// **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7**
    /// </summary>
    [Property(MaxTest = MaxTest, Arbitrary = new[] { typeof(StatsDatasetArbitraries) })]
    public Property StreaksFoldTheChronologicalResultSequence(StatsDatasetSpec spec) =>
        RunAsync(async () =>
        {
            await _harness.WithSeededDatasetAsync(spec, async (repository, seeded) =>
            {
                foreach (SeededStatsDataset.SquadData squad in seeded.Squads)
                {
                    foreach (SeededStatsDataset.MembershipData member in squad.Memberships)
                    {
                        MembershipStatsData? expected =
                            StatsReferenceOracle.GetMembershipStats(squad, member.MembershipId);
                        MembershipStatsData? actual = await repository.GetMembershipStatsAsync(
                            squad.SquadId, member.MembershipId, CancellationToken.None);

                        // A member of the squad always resolves on both sides (Req 9.4 covers zero).
                        Assert.NotNull(expected);
                        Assert.NotNull(actual);

                        AssertResultSequence(expected!, actual!);
                        AssertWinStreak(expected!, actual!);
                        AssertUnbeatenStreak(expected!, actual!);
                        AssertDegenerateAndEmptyEdges(actual!);
                    }
                }
            });

            return true;
        });

    /// <summary>
    /// Asserts the repository's chronological result sequence — the sequence both streaks fold over —
    /// equals the oracle's, i.e. ordered by completion instant then match identity (Requirement 9.1).
    /// </summary>
    private static void AssertResultSequence(MembershipStatsData expected, MembershipStatsData actual) =>
        Assert.Equal(expected.Results, actual.Results);

    /// <summary>
    /// Asserts the win streak folded over the repository's results via the Domain
    /// <see cref="StreakCalculator"/> equals the greatest run of consecutive <see cref="PlayerResult.Win"/>
    /// (computed independently) and equals the same fold over the oracle's results (Requirements 9.2, 9.5).
    /// </summary>
    private static void AssertWinStreak(MembershipStatsData expected, MembershipStatsData actual)
    {
        int actualStreak = StreakCalculator.LongestWinStreak(actual.Results);

        Assert.Equal(LongestRun(actual.Results, static r => r == PlayerResult.Win), actualStreak);
        Assert.Equal(StreakCalculator.LongestWinStreak(expected.Results), actualStreak);
    }

    /// <summary>
    /// Asserts the unbeaten streak folded over the repository's results via the Domain
    /// <see cref="StreakCalculator"/> equals the greatest run of consecutive non-<see cref="PlayerResult.Loss"/>
    /// results (computed independently) and equals the same fold over the oracle's results
    /// (Requirements 9.3, 9.5).
    /// </summary>
    private static void AssertUnbeatenStreak(MembershipStatsData expected, MembershipStatsData actual)
    {
        int actualStreak = StreakCalculator.LongestUnbeatenStreak(actual.Results);

        Assert.Equal(LongestRun(actual.Results, static r => r != PlayerResult.Loss), actualStreak);
        Assert.Equal(StreakCalculator.LongestUnbeatenStreak(expected.Results), actualStreak);
    }

    /// <summary>
    /// Asserts the empty and degenerate edges explicitly on the memberships whose generated data exhibits
    /// them: both streaks are zero for an empty result sequence (no appearance, Requirement 9.4); the win
    /// streak is zero when there is at least one appearance but no <see cref="PlayerResult.Win"/>
    /// (Requirement 9.6); and the unbeaten streak is zero when every result is a
    /// <see cref="PlayerResult.Loss"/> (Requirement 9.7).
    /// </summary>
    private static void AssertDegenerateAndEmptyEdges(MembershipStatsData actual)
    {
        int winStreak = StreakCalculator.LongestWinStreak(actual.Results);
        int unbeatenStreak = StreakCalculator.LongestUnbeatenStreak(actual.Results);

        if (actual.Results.Count == 0)
        {
            // No appearance: both streaks are zero (Req 9.4).
            Assert.Equal(0, winStreak);
            Assert.Equal(0, unbeatenStreak);
            return;
        }

        if (!actual.Results.Contains(PlayerResult.Win))
        {
            // At least one appearance but no win: the win streak is zero (Req 9.6).
            Assert.Equal(0, winStreak);
        }

        if (actual.Results.All(r => r == PlayerResult.Loss))
        {
            // Every result is a loss: the unbeaten streak is zero (Req 9.7).
            Assert.Equal(0, unbeatenStreak);
        }
    }

    /// <summary>
    /// Independently computes the longest run of consecutive results for which <paramref name="qualifies"/>
    /// holds, resetting at a non-qualifying result — a ground truth for the Domain fold, derived here
    /// rather than reused from production so the two are cross-checked.
    /// </summary>
    private static int LongestRun(IReadOnlyList<PlayerResult> results, Func<PlayerResult, bool> qualifies)
    {
        int longest = 0;
        int current = 0;
        foreach (PlayerResult result in results)
        {
            current = qualifies(result) ? current + 1 : 0;
            if (current > longest)
            {
                longest = current;
            }
        }

        return longest;
    }

    /// <summary>
    /// Bridges FsCheck's synchronous property model to the harness's asynchronous per-iteration
    /// database work. Blocking is safe: xUnit test execution has no synchronization context, so
    /// <c>GetAwaiter().GetResult()</c> cannot deadlock and it surfaces the original exception unwrapped.
    /// </summary>
    private static Property RunAsync(Func<Task<bool>> body) =>
        body().GetAwaiter().GetResult().ToProperty();
}
