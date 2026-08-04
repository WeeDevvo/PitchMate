using FsCheck;
using FsCheck.Xunit;
using PitchMate.Application.Stats;
using PitchMate.Domain.Common;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Stats;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// Model-based property test for the best-partnerships and bogey-opponents statistics (task 6.8),
/// validating design <c>Property 11: Best partnerships and bogey opponents</c> against the real
/// <c>EfStatsRepository</c> SQL on a Testcontainers PostgreSQL instance, using the pure
/// <see cref="StatsReferenceOracle"/> as the source of truth.
/// <para>
/// The repository returns the <em>raw</em> paired rows: one
/// <see cref="MembershipStatsData.PairedStatRow"/> per teammate the subject has shared a kickoff team
/// with (the partnership rows) and one per opponent the subject has faced on a different kickoff team
/// (the bogey rows), each carrying the subject's <see cref="MembershipStatsData.PairedStatRow.Wins"/>
/// (numerator) and <see cref="MembershipStatsData.PairedStatRow.QualifyingMatches"/> (denominator)
/// over that shared subset. The subject's Partnership / Bogey_Opponent <em>value</em> is
/// <see cref="WinPercentage.Compute(int, int)"/> over those two numbers, and the descending /
/// ascending ranking with the minimum-qualifying-match eligibility filter (Requirement 11.3, 11.4) is
/// the profile handler's presentation. This SQL-layer test therefore validates the raw rows against
/// the oracle, independently re-derives the numerators and denominators straight from the seeded
/// dataset, and independently verifies that the ranking definition holds when applied to those rows.
/// For every membership in every generated squad it asserts:
/// </para>
/// <list type="number">
/// <item>
/// <description>
/// <b>Partnership and bogey numerators / denominators (Requirements 11.1, 11.2)</b> — the repository's
/// partnership and bogey row sets each equal the oracle's, compared as sets keyed on
/// <see cref="MembershipStatsData.PairedStatRow.MembershipId"/> and asserting <c>Wins</c>,
/// <c>QualifyingMatches</c>, and <c>DisplayName</c>; and both are re-derived directly from the seeded
/// dataset (partnership subset = completed matches sharing a kickoff team; bogey subset = completed
/// matches on different kickoff teams; numerator = subject's wins in the subset) so the SQL and the
/// specification stay provably in step.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>Win-percentage value (Requirements 11.1, 11.2)</b> — for every pair, the subject's Partnership /
/// Bogey_Opponent value <c>WinPercentage.Compute(Wins, QualifyingMatches)</c> computed from the
/// repository's row equals the value computed from the oracle's row, lies in the closed range
/// 0.0..100.0, and rests on a numerator never exceeding its denominator.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>Subject excluded (Requirement 11.5)</b> — no partnership or bogey row carries the subject's own
/// identity, on either the repository or the oracle side.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>Partition of shared matches</b> — for every other membership, the partnership qualifying-match
/// count plus the bogey qualifying-match count equals the number of completed matches in which both
/// memberships appear (independently recomputed from the seeded dataset), so the same-team and
/// different-team subsets partition the shared matches with no double counting.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>Deterministic ranking and eligibility (Requirements 11.3, 11.4, 11.6)</b> — the best-partnerships
/// ranking (rows meeting the squad's minimum qualifying-match threshold, ordered by descending
/// Partnership value then descending qualifying count then ascending membership identity) and the
/// bogey-opponents ranking (the same eligibility, ordered by ascending Bogey_Opponent value then
/// descending qualifying count then ascending identity) computed from the repository's rows equal the
/// same rankings computed from the oracle's rows, so the deterministic order the handler presents is
/// reproducible from the SQL output, and both rankings are empty when no other membership meets the
/// threshold. Identity ordering uses <see cref="UuidV7Comparer"/> to match PostgreSQL <c>uuid</c>
/// ordering.
/// </description>
/// </item>
/// </list>
/// <para>
/// The generator supplies multi-team and uneven lineups drawn from a shared pool (so memberships recur
/// as teammates and opponents across matches), matches spanning every <see cref="MatchState"/>, and
/// memberships with zero appearances, so the qualifying, sub-threshold, and isolated-subject cases are
/// all exercised across the generated space.
/// </para>
/// <para>
/// Each iteration migrates, seeds, and drops its own throwaway database via
/// <see cref="StatsModelBasedHarness"/>, so <see cref="MaxTest"/> is kept modest; because every
/// generated dataset carries one to three squads of fifteen to twenty memberships, a single iteration
/// already performs dozens of independent partnership, bogey, and ranking comparisons and the run
/// clears well over 100 logical checks in total. Requires Docker.
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class BestPartnershipsAndBogeyOpponentsPropertyTests
{
    // Modest generated-dataset count: each seeds/drops a real database, yet every dataset yields dozens
    // of per-membership partnership, bogey, and ranking comparisons, so total logical checks exceed 100.
    private const int MaxTest = 10;

    // The squad-configurable minimum qualifying-match threshold, defaulting to 3 where the squad has
    // configured none (Requirement 11.3). The MVP source configures none, so the default applies here.
    private const int MinimumQualifyingMatches = 3;

    private readonly StatsModelBasedHarness _harness;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public BestPartnershipsAndBogeyOpponentsPropertyTests(PostgreSqlContainerFixture fixture)
    {
        _harness = new StatsModelBasedHarness(fixture);
    }

    // Feature: stats-and-summaries, Property 11: For any subject membership, the Partnership value with
    // another membership equals the subject's Win_Percentage over the matches in which the two share a
    // kickoff team and the Bogey_Opponent value equals the subject's Win_Percentage over the matches in
    // which they are on different kickoff teams; only memberships sharing at least the squad's minimum
    // qualifying-match count (a configurable integer no less than 1, defaulting to 3) qualify; best
    // partnerships are ranked by descending Partnership value and bogey opponents by ascending
    // Bogey_Opponent value, each tie-broken first by descending qualifying-match count then by ascending
    // membership identity; the subject is excluded from both; and both results are empty when no other
    // membership meets the threshold.
    /// <summary>
    /// **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6**
    /// </summary>
    [Property(MaxTest = MaxTest, Arbitrary = new[] { typeof(StatsDatasetArbitraries) })]
    public Property BestPartnershipsAndBogeyOpponentsMatchWinPercentageDefinition(StatsDatasetSpec spec) =>
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

                        // A member of the squad always resolves on both sides (Req 11.6 covers empty).
                        Assert.NotNull(expected);
                        Assert.NotNull(actual);

                        // (1) Raw partnership/bogey numerators and denominators equal the oracle's
                        //     (Req 11.1, 11.2).
                        AssertPairedEqual(expected!.Partnerships, actual!.Partnerships);
                        AssertPairedEqual(expected.BogeyOpponents, actual.BogeyOpponents);

                        // (1b) Both re-derived directly from the seeded dataset (Req 11.1, 11.2).
                        AssertPartnershipsMatchDataset(squad, member.MembershipId, actual.Partnerships);
                        AssertBogeyOpponentsMatchDataset(squad, member.MembershipId, actual.BogeyOpponents);

                        // (2) The win-percentage value agrees and is well-formed (Req 11.1, 11.2).
                        AssertWinPercentageMatches(expected.Partnerships, actual.Partnerships);
                        AssertWinPercentageMatches(expected.BogeyOpponents, actual.BogeyOpponents);

                        // (3) The subject never appears in its own paired rows (Req 11.5).
                        AssertSubjectExcluded(member.MembershipId, expected.Partnerships);
                        AssertSubjectExcluded(member.MembershipId, expected.BogeyOpponents);
                        AssertSubjectExcluded(member.MembershipId, actual.Partnerships);
                        AssertSubjectExcluded(member.MembershipId, actual.BogeyOpponents);

                        // (4) Same-team and different-team subsets partition the shared matches.
                        AssertSubsetsPartitionSharedMatches(
                            squad, member.MembershipId, actual.Partnerships, actual.BogeyOpponents);

                        // (5) The ranking definition applied to the repository's rows matches the
                        //     oracle's — a deterministic, threshold-filtered order reproducible from the
                        //     SQL output, empty when no membership qualifies (Req 11.3, 11.4, 11.6).
                        AssertRankingsMatch(expected.Partnerships, actual.Partnerships, bestFirst: true);
                        AssertRankingsMatch(expected.BogeyOpponents, actual.BogeyOpponents, bestFirst: false);
                    }
                }
            });

            return true;
        });

    /// <summary>
    /// Asserts the repository's paired rows equal the oracle's as a set keyed on
    /// <see cref="MembershipStatsData.PairedStatRow.MembershipId"/> — because the SQL does not guarantee
    /// an order — comparing the win numerator, qualifying-match denominator, and display name of each
    /// row (Requirements 11.1, 11.2).
    /// </summary>
    private static void AssertPairedEqual(
        IReadOnlyList<MembershipStatsData.PairedStatRow> expected,
        IReadOnlyList<MembershipStatsData.PairedStatRow> actual)
    {
        Assert.Equal(expected.Count, actual.Count);
        Dictionary<Guid, MembershipStatsData.PairedStatRow> byId = actual.ToDictionary(r => r.MembershipId);
        foreach (MembershipStatsData.PairedStatRow row in expected)
        {
            Assert.True(byId.TryGetValue(row.MembershipId, out MembershipStatsData.PairedStatRow? match),
                $"Missing paired row for {row.MembershipId}.");
            Assert.Equal(row.Wins, match!.Wins);
            Assert.Equal(row.QualifyingMatches, match.QualifyingMatches);
            Assert.Equal(row.DisplayName, match.DisplayName);
        }
    }

    /// <summary>
    /// Asserts every partnership row's numerator and denominator equal the values independently
    /// recomputed from the seeded dataset: the denominator is the count of completed matches in which
    /// the subject and the other membership share a kickoff team, and the numerator is the count of
    /// those matches the subject won (Requirement 11.1).
    /// </summary>
    private static void AssertPartnershipsMatchDataset(
        SeededStatsDataset.SquadData squad,
        Guid subjectMembershipId,
        IReadOnlyList<MembershipStatsData.PairedStatRow> rows)
    {
        foreach (MembershipStatsData.PairedStatRow row in rows)
        {
            (int wins, int qualifying) =
                RecomputeShared(squad, subjectMembershipId, row.MembershipId, sameTeam: true);
            Assert.Equal(qualifying, row.QualifyingMatches);
            Assert.Equal(wins, row.Wins);
        }
    }

    /// <summary>
    /// Asserts every bogey row's numerator and denominator equal the values independently recomputed
    /// from the seeded dataset: the denominator is the count of completed matches in which the subject
    /// and the other membership are on different kickoff teams, and the numerator is the count of those
    /// matches the subject won (Requirement 11.2).
    /// </summary>
    private static void AssertBogeyOpponentsMatchDataset(
        SeededStatsDataset.SquadData squad,
        Guid subjectMembershipId,
        IReadOnlyList<MembershipStatsData.PairedStatRow> rows)
    {
        foreach (MembershipStatsData.PairedStatRow row in rows)
        {
            (int wins, int qualifying) =
                RecomputeShared(squad, subjectMembershipId, row.MembershipId, sameTeam: false);
            Assert.Equal(qualifying, row.QualifyingMatches);
            Assert.Equal(wins, row.Wins);
        }
    }

    /// <summary>
    /// Asserts, for every paired row, that the subject's win percentage
    /// <c>WinPercentage.Compute(Wins, QualifyingMatches)</c> computed from the repository row equals the
    /// value computed from the oracle row, that the numerator never exceeds the denominator, and that
    /// the resulting percentage lies in the closed range 0.0..100.0 (Requirements 11.1, 11.2).
    /// </summary>
    private static void AssertWinPercentageMatches(
        IReadOnlyList<MembershipStatsData.PairedStatRow> expected,
        IReadOnlyList<MembershipStatsData.PairedStatRow> actual)
    {
        Dictionary<Guid, MembershipStatsData.PairedStatRow> byId = actual.ToDictionary(r => r.MembershipId);
        foreach (MembershipStatsData.PairedStatRow row in expected)
        {
            MembershipStatsData.PairedStatRow match = byId[row.MembershipId];

            Assert.True(match.QualifyingMatches >= 1, "A paired row must rest on at least one shared match.");
            Assert.True(match.Wins >= 0, "A win numerator must be non-negative.");
            Assert.True(match.Wins <= match.QualifyingMatches, "A win numerator must not exceed its denominator.");

            double? expectedValue = WinPercentage.Compute(row.Wins, row.QualifyingMatches);
            double? actualValue = WinPercentage.Compute(match.Wins, match.QualifyingMatches);
            Assert.Equal(expectedValue, actualValue);
            Assert.NotNull(actualValue);
            Assert.InRange(actualValue!.Value, 0.0, 100.0);
        }
    }

    /// <summary>
    /// Asserts no paired row carries the subject's own identity, so the subject is excluded from both
    /// its best-partnership and bogey-opponent results (Requirement 11.5).
    /// </summary>
    private static void AssertSubjectExcluded(
        Guid subjectMembershipId, IReadOnlyList<MembershipStatsData.PairedStatRow> rows) =>
        Assert.DoesNotContain(rows, row => row.MembershipId == subjectMembershipId);

    /// <summary>
    /// Asserts, for every other membership the subject has shared any completed match with, that its
    /// partnership qualifying-match count (same-team subset) plus its bogey qualifying-match count
    /// (different-team subset) equals the number of completed matches in which both memberships appear —
    /// independently recomputed from the seeded dataset — so the two subsets partition the shared
    /// matches with no double counting and neither ever exceeds the shared total.
    /// </summary>
    private static void AssertSubsetsPartitionSharedMatches(
        SeededStatsDataset.SquadData squad,
        Guid subjectMembershipId,
        IReadOnlyList<MembershipStatsData.PairedStatRow> partnerships,
        IReadOnlyList<MembershipStatsData.PairedStatRow> bogeyOpponents)
    {
        Dictionary<Guid, int> partnershipQ = partnerships.ToDictionary(r => r.MembershipId, r => r.QualifyingMatches);
        Dictionary<Guid, int> bogeyQ = bogeyOpponents.ToDictionary(r => r.MembershipId, r => r.QualifyingMatches);

        IEnumerable<Guid> others = partnershipQ.Keys.Union(bogeyQ.Keys);
        foreach (Guid otherId in others)
        {
            int sameTeam = partnershipQ.GetValueOrDefault(otherId);
            int differentTeam = bogeyQ.GetValueOrDefault(otherId);
            int bothAppear = CompletedMatchesBothAppear(squad, subjectMembershipId, otherId);

            Assert.Equal(bothAppear, sameTeam + differentTeam);
            Assert.True(sameTeam <= bothAppear, "Partnership subset must not exceed shared matches.");
            Assert.True(differentTeam <= bothAppear, "Bogey subset must not exceed shared matches.");
        }
    }

    /// <summary>
    /// Asserts the best-partnerships ranking (<paramref name="bestFirst"/> = <see langword="true"/>:
    /// descending Partnership value) or the bogey-opponents ranking (<see langword="false"/>: ascending
    /// Bogey_Opponent value) — in both cases filtered to rows meeting
    /// <see cref="MinimumQualifyingMatches"/> and tie-broken by descending qualifying count then
    /// ascending membership identity — computed from the repository's rows equals the same ranking
    /// computed from the oracle's rows, giving a deterministic, reproducible order that is empty when no
    /// membership meets the threshold (Requirements 11.3, 11.4, 11.6).
    /// </summary>
    private static void AssertRankingsMatch(
        IReadOnlyList<MembershipStatsData.PairedStatRow> expected,
        IReadOnlyList<MembershipStatsData.PairedStatRow> actual,
        bool bestFirst)
    {
        Assert.Equal(Rank(expected, bestFirst), Rank(actual, bestFirst));

        // When no other membership meets the minimum qualifying-match threshold, the ranking is empty
        // (Req 11.6) — including the case where the subject has no paired rows at all.
        if (!actual.Any(row => row.QualifyingMatches >= MinimumQualifyingMatches))
        {
            Assert.Empty(Rank(actual, bestFirst));
        }
    }

    /// <summary>
    /// Builds a best-partnerships or bogey-opponents ranking from paired rows: only rows meeting the
    /// squad's minimum qualifying-match threshold are eligible (Req 11.3); they are ordered by
    /// descending Partnership value when <paramref name="bestFirst"/> is <see langword="true"/> or
    /// ascending Bogey_Opponent value otherwise, tie-broken first by descending qualifying-match count
    /// and then by ascending membership identity via <see cref="UuidV7Comparer"/> (Req 11.4).
    /// </summary>
    private static IReadOnlyList<Guid> Rank(
        IReadOnlyList<MembershipStatsData.PairedStatRow> rows, bool bestFirst)
    {
        IEnumerable<MembershipStatsData.PairedStatRow> eligible =
            rows.Where(row => row.QualifyingMatches >= MinimumQualifyingMatches);

        double Value(MembershipStatsData.PairedStatRow row) =>
            WinPercentage.Compute(row.Wins, row.QualifyingMatches) ?? 0.0;

        IOrderedEnumerable<MembershipStatsData.PairedStatRow> ordered = bestFirst
            ? eligible.OrderByDescending(Value)
            : eligible.OrderBy(Value);

        return ordered
            .ThenByDescending(row => row.QualifyingMatches)
            .ThenBy(row => row.MembershipId, UuidV7Comparer.Instance)
            .Select(row => row.MembershipId)
            .ToList();
    }

    /// <summary>
    /// Independently recomputes, from the seeded dataset, the subject's win numerator and qualifying
    /// denominator over the completed matches shared with <paramref name="otherId"/> on the same kickoff
    /// team (<paramref name="sameTeam"/> = <see langword="true"/>, a partnership subset) or on different
    /// kickoff teams (<see langword="false"/>, a bogey subset).
    /// </summary>
    private static (int Wins, int Qualifying) RecomputeShared(
        SeededStatsDataset.SquadData squad, Guid subjectId, Guid otherId, bool sameTeam)
    {
        int wins = 0, qualifying = 0;
        foreach (SeededStatsDataset.MatchData match in squad.Matches)
        {
            if (match.State != MatchState.Completed)
            {
                continue;
            }

            SeededStatsDataset.TeamData? subjectTeam =
                match.Teams.FirstOrDefault(team => team.Roster.Contains(subjectId));
            SeededStatsDataset.TeamData? otherTeam =
                match.Teams.FirstOrDefault(team => team.Roster.Contains(otherId));
            if (subjectTeam is null || otherTeam is null)
            {
                continue;
            }

            bool shareTeam = subjectTeam.TeamId == otherTeam.TeamId;
            if (shareTeam != sameTeam)
            {
                continue;
            }

            qualifying++;
            if (IsWin(match, subjectTeam))
            {
                wins++;
            }
        }

        return (wins, qualifying);
    }

    /// <summary>
    /// Independently recomputes, from the seeded dataset, the number of completed matches in which both
    /// <paramref name="a"/> and <paramref name="b"/> appear in the kickoff lineup — the shared total the
    /// subset-partition invariant is checked against.
    /// </summary>
    private static int CompletedMatchesBothAppear(SeededStatsDataset.SquadData squad, Guid a, Guid b) =>
        squad.Matches.Count(match =>
            match.State == MatchState.Completed &&
            match.Teams.Any(team => team.Roster.Contains(a)) &&
            match.Teams.Any(team => team.Roster.Contains(b)));

    /// <summary>
    /// Determines whether <paramref name="team"/> holds the uniquely best score in
    /// <paramref name="match"/> — a win for the subject on that team — mirroring the outcome derivation
    /// (a shared best score is a draw, not a win).
    /// </summary>
    private static bool IsWin(SeededStatsDataset.MatchData match, SeededStatsDataset.TeamData team)
    {
        int bestScore = match.Teams.Max(t => t.Score);
        int teamsAtBest = match.Teams.Count(t => t.Score == bestScore);
        return team.Score == bestScore && teamsAtBest == 1;
    }

    /// <summary>
    /// Bridges FsCheck's synchronous property model to the harness's asynchronous per-iteration
    /// database work. Blocking is safe: xUnit test execution has no synchronization context, so
    /// <c>GetAwaiter().GetResult()</c> cannot deadlock and it surfaces the original exception unwrapped.
    /// </summary>
    private static Property RunAsync(Func<Task<bool>> body) =>
        body().GetAwaiter().GetResult().ToProperty();
}
