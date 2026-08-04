using FsCheck;
using FsCheck.Xunit;
using PitchMate.Application.Stats;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// Model-based property test for the appearances statistic (task 6.4), validating design
/// <c>Property 4: Appearances</c> against the real <c>EfStatsRepository</c> SQL on a Testcontainers
/// PostgreSQL instance, using the pure <see cref="StatsReferenceOracle"/> as the source of truth.
/// <para>
/// For any generated squad and any membership in it, the repository's appearance count MUST equal
/// the oracle's — the number of <em>distinct</em> <c>Completed</c> matches whose <c>KickoffLineup</c>
/// includes that membership, each match counted at most once regardless of team count or roster
/// repetition, excluding every match in which the membership is not in the kickoff lineup (including
/// non-completed matches that still have a locked lineup, and matches where the membership was only a
/// <c>MatchParticipant</c>), and <c>0</c> when the membership never appeared. The generator supplies
/// memberships with zero appearances, multi-team and uneven lineups drawn from a shared pool (so a
/// membership recurs across matches), and matches spanning every <c>MatchState</c>, so the excluded
/// cases are exercised as part of the generated space.
/// </para>
/// <para>
/// Each iteration migrates, seeds, and drops its own throwaway database via
/// <see cref="StatsModelBasedHarness"/>, so <see cref="MaxTest"/> is kept modest; because every
/// generated dataset carries one to three squads of fifteen to twenty memberships, a single iteration
/// already performs dozens of independent appearance comparisons and the run clears well over 100
/// logical checks in total. Requires Docker.
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class AppearancesPropertyTests
{
    // Modest generated-dataset count: each seeds/drops a real database, yet every dataset yields
    // 15..60 per-membership appearance comparisons, so total logical iterations far exceed 100.
    private const int MaxTest = 10;

    private readonly StatsModelBasedHarness _harness;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public AppearancesPropertyTests(PostgreSqlContainerFixture fixture)
    {
        _harness = new StatsModelBasedHarness(fixture);
    }

    // Feature: stats-and-summaries, Property 4: Appearances
    /// <summary>
    /// **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
    /// </summary>
    [Property(MaxTest = MaxTest, Arbitrary = new[] { typeof(StatsDatasetArbitraries) })]
    public Property AppearanceCountEqualsDistinctCompletedKickoffLineupMatches(StatsDatasetSpec spec) =>
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

                        // A member of the squad always resolves on both sides (Req 5.4 covers zero).
                        Assert.NotNull(expected);
                        Assert.NotNull(actual);

                        // The count is a non-negative integer (Req 5.1).
                        Assert.True(expected!.Appearances >= 0);

                        // The SQL agrees with the definition for every membership — including
                        // zero-appearance members and members recurring across multi-team/uneven
                        // lineups and non-completed matches (Req 5.1, 5.2, 5.3, 5.4).
                        Assert.Equal(expected.Appearances, actual!.Appearances);
                    }
                }
            });

            return true;
        });

    /// <summary>
    /// Bridges FsCheck's synchronous property model to the harness's asynchronous per-iteration
    /// database work. Blocking is safe: xUnit test execution has no synchronization context, so
    /// <c>GetAwaiter().GetResult()</c> cannot deadlock and it surfaces the original exception unwrapped.
    /// </summary>
    private static Property RunAsync(Func<Task<bool>> body) =>
        body().GetAwaiter().GetResult().ToProperty();
}
