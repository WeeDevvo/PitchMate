using FsCheck;
using FsCheck.Xunit;
using PitchMate.Application.Stats;
using PitchMate.Domain.Common;
using PitchMate.Domain.Matches;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// Model-based property test for the most-played-with and most-played-against statistics (task 6.7),
/// validating design <c>Property 10: Most played with and against</c> against the real
/// <c>EfStatsRepository</c> SQL on a Testcontainers PostgreSQL instance, using the pure
/// <see cref="StatsReferenceOracle"/> as the source of truth.
/// <para>
/// The repository returns the <em>raw</em> co-appearance rows (one per other membership the subject
/// has shared a completed match with, each carrying a teammate and an opponent count); the
/// descending-count / ascending-identity ranking and the positive-count filtering are the profile
/// handler's presentation. This SQL-layer test therefore validates the raw counts against the oracle
/// <em>and independently</em> verifies that the ranking definition holds when applied to those rows.
/// For every membership in every generated squad it asserts:
/// </para>
/// <list type="number">
/// <item>
/// <description>
/// <b>Teammate and opponent counts (Requirements 10.1, 10.2)</b> — the repository's
/// <see cref="MembershipStatsData.CoAppearanceRow"/> set equals the oracle's, compared as a set keyed
/// on <see cref="MembershipStatsData.CoAppearanceRow.MembershipId"/> and asserting
/// <see cref="MembershipStatsData.CoAppearanceRow.TeammateCount"/> (completed matches sharing a kickoff
/// team), <see cref="MembershipStatsData.CoAppearanceRow.OpponentCount"/> (completed matches on
/// different kickoff teams), and <see cref="MembershipStatsData.CoAppearanceRow.DisplayName"/>.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>Subject excluded (Requirement 10.4)</b> — no co-appearance row carries the subject's own
/// identity, on either the repository or the oracle side.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>Counted at most once (Requirement 10.5)</b> — teammate and opponent counts are each non-negative
/// and, for every pair, their sum equals the number of completed matches in which both memberships
/// appear (independently recomputed from the seeded dataset) and therefore never exceeds it, proving
/// each shared match is counted exactly once toward exactly one of the two counts.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>Empty when isolated (Requirement 10.6)</b> — a subject with no co-appearance yields empty
/// most-played-with and most-played-against rankings.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>Deterministic ranking (Requirements 10.3, 10.7)</b> — the "most played with" ranking (rows with
/// a positive teammate count, ordered by descending teammate count then ascending membership identity)
/// and the "most played against" ranking (positive opponent count, descending opponent count then
/// ascending identity) computed from the repository's rows equal the same rankings computed from the
/// oracle's rows, so the deterministic order the handler presents is reproducible from the SQL output.
/// Identity ordering uses <see cref="UuidV7Comparer"/> to match PostgreSQL <c>uuid</c> ordering.
/// </description>
/// </item>
/// </list>
/// <para>
/// The generator supplies multi-team and uneven lineups drawn from a shared pool (so memberships recur
/// as teammates and opponents across matches), matches spanning every <see cref="MatchState"/>, and
/// memberships with zero appearances, so the teammate, opponent, and isolated-subject cases are all
/// exercised across the generated space.
/// </para>
/// <para>
/// Each iteration migrates, seeds, and drops its own throwaway database via
/// <see cref="StatsModelBasedHarness"/>, so <see cref="MaxTest"/> is kept modest; because every
/// generated dataset carries one to three squads of fifteen to twenty memberships, a single iteration
/// already performs dozens of independent co-appearance and ranking comparisons and the run clears well
/// over 100 logical checks in total. Requires Docker.
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class MostPlayedWithAndAgainstPropertyTests
{
    // Modest generated-dataset count: each seeds/drops a real database, yet every dataset yields
    // dozens of per-membership co-appearance and ranking comparisons, so total logical checks exceed 100.
    private const int MaxTest = 10;

    private readonly StatsModelBasedHarness _harness;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public MostPlayedWithAndAgainstPropertyTests(PostgreSqlContainerFixture fixture)
    {
        _harness = new StatsModelBasedHarness(fixture);
    }

    // Feature: stats-and-summaries, Property 10: For any subject membership, the Teammate_Co_Appearance
    // count with another membership equals the number of Completed matches in which both share a kickoff
    // team and the Opponent_Co_Appearance count equals the number in which both appear on different
    // kickoff teams, each match counted at most once so their sum never exceeds the matches in which
    // both appear; most-played-with lists the other memberships with a positive teammate count ranked by
    // descending count then ascending membership identity, and most-played-against does the same by
    // opponent count; the subject is excluded from its own results; and both results are empty when the
    // subject has no co-appearance.
    /// <summary>
    /// **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7**
    /// </summary>
    [Property(MaxTest = MaxTest, Arbitrary = new[] { typeof(StatsDatasetArbitraries) })]
    public Property MostPlayedWithAndAgainstMatchCoAppearanceDefinition(StatsDatasetSpec spec) =>
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

                        // A member of the squad always resolves on both sides (Req 10.6 covers empty).
                        Assert.NotNull(expected);
                        Assert.NotNull(actual);

                        // (1) Raw teammate/opponent counts equal the oracle's (Req 10.1, 10.2).
                        AssertCoAppearancesEqual(expected!.CoAppearances, actual!.CoAppearances);

                        // (2) The subject never appears in its own co-appearance rows (Req 10.4).
                        AssertSubjectExcluded(member.MembershipId, expected.CoAppearances);
                        AssertSubjectExcluded(member.MembershipId, actual.CoAppearances);

                        // (3) Each shared match is counted at most once (Req 10.5).
                        AssertCountedAtMostOnce(squad, member.MembershipId, actual.CoAppearances);

                        // (4) An isolated subject yields empty rankings (Req 10.6).
                        // (5) The ranking definition applied to the repository's rows matches the
                        //     oracle's — a deterministic order reproducible from the SQL output
                        //     (Req 10.3, 10.7).
                        AssertRankingsMatch(expected.CoAppearances, actual.CoAppearances);
                    }
                }
            });

            return true;
        });

    /// <summary>
    /// Asserts the repository's co-appearance rows equal the oracle's as a set keyed on
    /// <see cref="MembershipStatsData.CoAppearanceRow.MembershipId"/> — because the SQL does not
    /// guarantee an order — comparing the teammate count, opponent count, and display name of each row
    /// (Requirements 10.1, 10.2).
    /// </summary>
    private static void AssertCoAppearancesEqual(
        IReadOnlyList<MembershipStatsData.CoAppearanceRow> expected,
        IReadOnlyList<MembershipStatsData.CoAppearanceRow> actual)
    {
        Assert.Equal(expected.Count, actual.Count);
        Dictionary<Guid, MembershipStatsData.CoAppearanceRow> byId = actual.ToDictionary(r => r.MembershipId);
        foreach (MembershipStatsData.CoAppearanceRow row in expected)
        {
            Assert.True(byId.TryGetValue(row.MembershipId, out MembershipStatsData.CoAppearanceRow? match),
                $"Missing co-appearance row for {row.MembershipId}.");
            Assert.Equal(row.TeammateCount, match!.TeammateCount);
            Assert.Equal(row.OpponentCount, match.OpponentCount);
            Assert.Equal(row.DisplayName, match.DisplayName);
        }
    }

    /// <summary>
    /// Asserts no co-appearance row carries the subject's own identity, so the subject is excluded from
    /// both its most-played-with and most-played-against results (Requirement 10.4).
    /// </summary>
    private static void AssertSubjectExcluded(
        Guid subjectMembershipId, IReadOnlyList<MembershipStatsData.CoAppearanceRow> rows) =>
        Assert.DoesNotContain(rows, row => row.MembershipId == subjectMembershipId);

    /// <summary>
    /// Asserts every pair's teammate and opponent counts are non-negative and sum to the number of
    /// completed matches in which both memberships appear — independently recomputed from the seeded
    /// dataset — so each shared match is counted exactly once toward exactly one of the two counts and
    /// the sum never exceeds the matches in which both appear (Requirement 10.5).
    /// </summary>
    private static void AssertCountedAtMostOnce(
        SeededStatsDataset.SquadData squad,
        Guid subjectMembershipId,
        IReadOnlyList<MembershipStatsData.CoAppearanceRow> rows)
    {
        foreach (MembershipStatsData.CoAppearanceRow row in rows)
        {
            Assert.True(row.TeammateCount >= 0, "Teammate count must be non-negative.");
            Assert.True(row.OpponentCount >= 0, "Opponent count must be non-negative.");

            int bothAppear = CompletedMatchesBothAppear(squad, subjectMembershipId, row.MembershipId);
            int sum = row.TeammateCount + row.OpponentCount;

            // Each shared match contributes to exactly one of the two counts (Req 10.5): the sum equals
            // the matches both appear in and therefore never exceeds it.
            Assert.Equal(bothAppear, sum);
            Assert.True(sum <= bothAppear, "Co-appearance sum must not exceed shared matches.");
        }
    }

    /// <summary>
    /// Asserts the "most played with" ranking (positive teammate count, descending count then ascending
    /// identity) and the "most played against" ranking (positive opponent count, descending count then
    /// ascending identity) computed from the repository's rows equal the same rankings computed from the
    /// oracle's rows, giving a deterministic, reproducible order — empty when the subject has no
    /// co-appearance (Requirements 10.3, 10.6, 10.7).
    /// </summary>
    private static void AssertRankingsMatch(
        IReadOnlyList<MembershipStatsData.CoAppearanceRow> expected,
        IReadOnlyList<MembershipStatsData.CoAppearanceRow> actual)
    {
        Assert.Equal(RankMostPlayedWith(expected), RankMostPlayedWith(actual));
        Assert.Equal(RankMostPlayedAgainst(expected), RankMostPlayedAgainst(actual));

        // When there is no co-appearance at all, both rankings are empty (Req 10.6).
        if (actual.Count == 0)
        {
            Assert.Empty(RankMostPlayedWith(actual));
            Assert.Empty(RankMostPlayedAgainst(actual));
        }
    }

    /// <summary>
    /// Builds the "most played with" ranking: rows with a positive teammate count ordered by descending
    /// teammate count then ascending membership identity via <see cref="UuidV7Comparer"/> (Req 10.3).
    /// </summary>
    private static IReadOnlyList<Guid> RankMostPlayedWith(
        IReadOnlyList<MembershipStatsData.CoAppearanceRow> rows) =>
        rows.Where(row => row.TeammateCount > 0)
            .OrderByDescending(row => row.TeammateCount)
            .ThenBy(row => row.MembershipId, UuidV7Comparer.Instance)
            .Select(row => row.MembershipId)
            .ToList();

    /// <summary>
    /// Builds the "most played against" ranking: rows with a positive opponent count ordered by
    /// descending opponent count then ascending membership identity via <see cref="UuidV7Comparer"/>
    /// (Req 10.7).
    /// </summary>
    private static IReadOnlyList<Guid> RankMostPlayedAgainst(
        IReadOnlyList<MembershipStatsData.CoAppearanceRow> rows) =>
        rows.Where(row => row.OpponentCount > 0)
            .OrderByDescending(row => row.OpponentCount)
            .ThenBy(row => row.MembershipId, UuidV7Comparer.Instance)
            .Select(row => row.MembershipId)
            .ToList();

    /// <summary>
    /// Independently recomputes, from the seeded dataset, the number of completed matches in which both
    /// <paramref name="a"/> and <paramref name="b"/> appear in the kickoff lineup — the denominator the
    /// counted-at-most-once invariant is checked against.
    /// </summary>
    private static int CompletedMatchesBothAppear(SeededStatsDataset.SquadData squad, Guid a, Guid b) =>
        squad.Matches.Count(match =>
            match.State == MatchState.Completed &&
            match.Teams.Any(team => team.Roster.Contains(a)) &&
            match.Teams.Any(team => team.Roster.Contains(b)));

    /// <summary>
    /// Bridges FsCheck's synchronous property model to the harness's asynchronous per-iteration
    /// database work. Blocking is safe: xUnit test execution has no synchronization context, so
    /// <c>GetAwaiter().GetResult()</c> cannot deadlock and it surfaces the original exception unwrapped.
    /// </summary>
    private static Property RunAsync(Func<Task<bool>> body) =>
        body().GetAwaiter().GetResult().ToProperty();
}
