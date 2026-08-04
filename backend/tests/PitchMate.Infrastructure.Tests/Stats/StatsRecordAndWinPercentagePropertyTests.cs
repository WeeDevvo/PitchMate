using FsCheck;
using FsCheck.Xunit;
using PitchMate.Application.Stats;
using PitchMate.Domain.Stats;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// Model-based property test for the win/loss/draw record and win percentage (task 6.5), validating
/// design <c>Property 5: Record and win percentage</c> against the real <c>EfStatsRepository</c> SQL on
/// a Testcontainers PostgreSQL instance, using the pure <see cref="StatsReferenceOracle"/> — whose
/// per-match <see cref="PlayerResult"/> is derived from the kickoff team's placement in the match
/// outcome — as the source of truth.
/// <para>
/// For any generated squad and any membership in it, the property asserts four facets over the
/// repository's <see cref="IStatsRepository.GetMembershipStatsAsync"/> output:
/// </para>
/// <list type="number">
/// <item>
/// <description>
/// <b>Result derivation (Requirements 6.1, 6.5)</b> — each <see cref="PlayerResult"/> follows from the
/// kickoff team's placement in the match outcome: a <see cref="PlayerResult.Win"/> for the uniquely
/// best score, a <see cref="PlayerResult.Draw"/> for a best score shared by two or more teams, and a
/// <see cref="PlayerResult.Loss"/> otherwise. The repository's ordered <c>Results</c> sequence and its
/// <c>Wins</c>/<c>Draws</c>/<c>Losses</c> counts MUST equal the oracle's, and the counts MUST agree
/// with the tally of the sequence.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>Record invariant (Requirement 6.2)</b> — the repository's own <c>Wins + Draws + Losses</c> MUST
/// sum exactly to its <c>Appearances</c>, asserted directly on the repository output.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>Win percentage (Requirement 6.3)</b> — the win percentage computed from the repository's
/// <c>Wins</c>/<c>Appearances</c> via the Domain <see cref="WinPercentage"/> calculator MUST equal the
/// oracle's, and when the membership has at least one appearance it MUST have a value lying in the
/// closed range <c>[0.0, 100.0]</c>.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>No-appearance reporting (Requirement 6.4)</b> — when the membership has no appearance the win
/// percentage is reported as <em>having no value</em> (<see langword="null"/>), never as zero.
/// </description>
/// </item>
/// </list>
/// <para>
/// The generator supplies multi-team and uneven lineups drawn from a shared pool (so memberships recur
/// across matches with mixed outcomes), matches whose equal top scores force draws, and memberships
/// with zero appearances, so every facet — including the shared-best-placement draw and the empty
/// record — is exercised across the generated space.
/// </para>
/// <para>
/// Each iteration migrates, seeds, and drops its own throwaway database via
/// <see cref="StatsModelBasedHarness"/>, so <see cref="MaxTest"/> is kept modest; because every
/// generated dataset carries one to three squads of fifteen to twenty memberships, a single iteration
/// already performs dozens of independent record and win-percentage comparisons and the run clears well
/// over 100 logical checks in total. Requires Docker.
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class StatsRecordAndWinPercentagePropertyTests
{
    // Modest generated-dataset count: each seeds/drops a real database, yet every dataset yields
    // 15..60 per-membership record and win-percentage comparisons, so total logical checks exceed 100.
    private const int MaxTest = 10;

    private readonly StatsModelBasedHarness _harness;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public StatsRecordAndWinPercentagePropertyTests(PostgreSqlContainerFixture fixture)
    {
        _harness = new StatsModelBasedHarness(fixture);
    }

    // Feature: stats-and-summaries, Property 5: For any membership, each PlayerResult is derived from
    // its kickoff team's placement in the Match_Outcome (Win = uniquely best placement, Draw = a best
    // placement shared by two or more teams, Loss = worse than best); the Win/Draw/Loss counts sum
    // exactly to the Appearance count; the Win_Percentage is wins / appearances × 100 rounded to the
    // nearest 0.1 with exact halves rounded up and lies in [0.0, 100.0] when the membership has at least
    // one appearance; and it is reported as having no value (not zero) when the membership has no
    // appearance.
    /// <summary>
    /// **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**
    /// </summary>
    [Property(MaxTest = MaxTest, Arbitrary = new[] { typeof(StatsDatasetArbitraries) })]
    public Property RecordAndWinPercentageMatchPlacementDerivation(StatsDatasetSpec spec) =>
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

                        // A member of the squad always resolves on both sides (Req 6.4 covers zero).
                        Assert.NotNull(expected);
                        Assert.NotNull(actual);

                        AssertRecordMatchesPlacement(expected!, actual!);
                        AssertRecordInvariant(actual!);
                        AssertWinPercentage(expected!, actual!);
                    }
                }
            });

            return true;
        });

    /// <summary>
    /// Asserts that the repository's per-match results follow the placement-derived definition
    /// (Requirements 6.1, 6.5): its ordered <c>Results</c> sequence and its W/D/L counts equal the
    /// oracle's, and each count agrees with the tally of the sequence — so a <c>Win</c> is a uniquely
    /// best placement, a <c>Draw</c> a shared best placement, and a <c>Loss</c> worse than best.
    /// </summary>
    private static void AssertRecordMatchesPlacement(MembershipStatsData expected, MembershipStatsData actual)
    {
        // The chronological result sequence is derived identically to the placement definition.
        Assert.Equal(expected.Results, actual.Results);

        // The W/D/L counts equal the oracle's placement-derived counts.
        Assert.Equal(expected.Wins, actual.Wins);
        Assert.Equal(expected.Draws, actual.Draws);
        Assert.Equal(expected.Losses, actual.Losses);

        // The counts agree with the tally of the derived result sequence.
        Assert.Equal(actual.Results.Count(r => r == PlayerResult.Win), actual.Wins);
        Assert.Equal(actual.Results.Count(r => r == PlayerResult.Draw), actual.Draws);
        Assert.Equal(actual.Results.Count(r => r == PlayerResult.Loss), actual.Losses);
    }

    /// <summary>
    /// Asserts the record invariant directly on the repository output (Requirement 6.2): the
    /// <c>Win</c>, <c>Draw</c>, and <c>Loss</c> counts sum exactly to the appearance count.
    /// </summary>
    private static void AssertRecordInvariant(MembershipStatsData actual) =>
        Assert.Equal(actual.Appearances, actual.Wins + actual.Draws + actual.Losses);

    /// <summary>
    /// Asserts the win percentage computed from the repository's counts via the Domain
    /// <see cref="WinPercentage"/> calculator equals the oracle's, is reported as having no value when
    /// there is no appearance (Requirement 6.4), and lies in the closed range <c>[0.0, 100.0]</c> when
    /// there is at least one appearance (Requirement 6.3).
    /// </summary>
    private static void AssertWinPercentage(MembershipStatsData expected, MembershipStatsData actual)
    {
        double? expectedWinPercentage = WinPercentage.Compute(expected.Wins, expected.Appearances);
        double? actualWinPercentage = WinPercentage.Compute(actual.Wins, actual.Appearances);

        // The repository's counts feed the same win percentage the oracle computes.
        Assert.Equal(expectedWinPercentage, actualWinPercentage);

        if (actual.Appearances == 0)
        {
            // No appearance is reported as no value, never as zero (Req 6.4).
            Assert.Null(actualWinPercentage);
        }
        else
        {
            // With at least one appearance the value is present and in range (Req 6.3).
            Assert.NotNull(actualWinPercentage);
            Assert.InRange(actualWinPercentage!.Value, 0.0, 100.0);
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
