using FsCheck;
using FsCheck.Xunit;
using PitchMate.Application.Stats;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// Model-based property test for historical stability and anonymisation (task 6.11), validating design
/// <c>Property 14: Historical stability and anonymisation</c> against the real <c>EfStatsRepository</c>
/// SQL on a Testcontainers PostgreSQL instance, using the pure <see cref="StatsReferenceOracle"/> as
/// the source of truth.
/// <para>
/// The dataset generator applies its lifecycle transforms — deactivation and anonymisation — <em>after</em>
/// each membership's match history has been recorded, so an <c>Inactive</c> or anonymised membership
/// still contributed its frozen kickoff-lineup, result, and rating-snapshot rows to the immutable match
/// record. Because every statistic is derived solely from that completion-time immutable data
/// (Requirement 14.1), transforming a membership must leave <em>every</em> membership's numbers — its
/// own and everyone else's — unchanged. The <see cref="StatsReferenceOracle"/> computes the expected
/// statistics from exactly that immutable data, indifferent to a membership's final lifecycle state, so
/// equality between the real SQL and the oracle for a dataset that already contains <c>Inactive</c> and
/// anonymised memberships is the historical-stability proof. For every generated squad the property
/// asserts:
/// </para>
/// <list type="number">
/// <item>
/// <description>
/// <b>Every membership retains full statistics unchanged (Requirements 14.1, 14.2, 14.4)</b> — for
/// every membership regardless of its <see cref="MembershipState"/> or whether it was anonymised, the
/// repository's <see cref="IStatsRepository.GetMembershipStatsAsync"/> result equals the oracle's, so an
/// <c>Inactive</c> or anonymised membership's own appearances, W/L/D record, streak sequence, rating
/// progression, bib appearances, and co-appearance / partnership / bogey rows are computed by the same
/// definitions and remain intact.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>De-identified contribution persists, keyed on the persistent identity (Requirements 14.1, 14.3)</b>
/// — wherever an <c>Inactive</c> or anonymised membership shared a completed match with another
/// membership, it still appears in that other membership's co-appearance rows, keyed on its persistent
/// <see cref="SquadMembership"/> identity (which anonymisation does not change), so removing or
/// anonymising a player never rewrites everyone else's numbers.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>Anonymised memberships are identified only by the placeholder (Requirements 3.5, 4.6, 14.4, 14.5)</b>
/// — an anonymised membership resolves via <see cref="IStatsRepository.FindMembershipAsync"/> under the
/// <see cref="SquadMembership.DisplayNamePlaceholder"/> ("Former player") name (Requirement 3.5); every
/// leaderboard row for it carries the placeholder name while retaining its statistic value
/// (Requirements 4.6, 14.5); and wherever it is referenced in another membership's co-appearance rows
/// it is identified only by the placeholder, never its former name (Requirement 14.4). A
/// non-anonymised membership is presented under its real display name throughout. In every case the
/// repository agrees with the oracle.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>Identity is unchanged by anonymisation (Requirement 14.3)</b> — an anonymised membership still
/// resolves via <see cref="IStatsRepository.FindMembershipAsync"/> under the same persistent identity
/// and appears with that same identity in aggregates and leaderboards.
/// </description>
/// </item>
/// </list>
/// <para>
/// The generator produces anonymised (~15%) and inactive (~20%) memberships in a shared pool of 15..20
/// per squad that recur across matches, so the anonymisation-specific assertions are exercised across
/// the generated space; they are nonetheless guarded to run only when such memberships (and the shared
/// matches they need) exist, so a rare dataset without them never weakens the unconditional
/// oracle-equality assertions.
/// </para>
/// <para>
/// Each iteration migrates, seeds, and drops its own throwaway database via
/// <see cref="StatsModelBasedHarness"/>, so <see cref="MaxTest"/> is kept modest; because every
/// generated dataset carries one to three squads of fifteen to twenty memberships, a single iteration
/// already performs dozens of independent per-membership stat comparisons, membership-reference checks,
/// and per-statistic leaderboard placeholder checks, so the run clears well over 100 logical checks in
/// total. Requires Docker.
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class HistoricalStabilityAndAnonymisationPropertyTests
{
    // Modest generated-dataset count: each seeds/drops a real database, yet every dataset yields
    // dozens of per-membership stat comparisons, membership-reference checks, and per-statistic
    // leaderboard placeholder checks, so total logical checks far exceed 100.
    private const int MaxTest = 10;

    private readonly StatsModelBasedHarness _harness;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public HistoricalStabilityAndAnonymisationPropertyTests(PostgreSqlContainerFixture fixture)
    {
        _harness = new StatsModelBasedHarness(fixture);
    }

    // Feature: stats-and-summaries, Property 14: For any dataset, transforming any membership to
    // Inactive or anonymising it (keyed on its persistent SquadMembership identity, which anonymisation
    // does not change) leaves every membership's Appearances, W/L/D record, Win_Streak, Unbeaten_Streak,
    // rating progression, Co_Appearances, Partnerships, Bogey_Opponents, and Bib_Appearances unchanged;
    // the affected membership's own statistics remain computable by the same definitions and appear in
    // its Profile and in Leaderboards as a distinct entry; and wherever an anonymised membership is
    // referenced — its own Profile, another membership's pairwise/partnership/bogey results, or a
    // Leaderboard entry — it is identified only by the "Former player" placeholder Display_Name, never
    // its former name or backing User reference.
    /// <summary>
    /// **Validates: Requirements 3.5, 4.6, 14.1, 14.2, 14.3, 14.4, 14.5**
    /// </summary>
    [Property(MaxTest = MaxTest, Arbitrary = new[] { typeof(StatsDatasetArbitraries) })]
    public Property InactiveAndAnonymisedMembershipsRetainStatisticsAndArePlaceholderIdentified(
        StatsDatasetSpec spec) =>
        RunAsync(async () =>
        {
            await _harness.WithSeededDatasetAsync(spec, async (repository, seeded) =>
            {
                foreach (SeededStatsDataset.SquadData squad in seeded.Squads)
                {
                    // (1) Every membership — Active, Inactive, or anonymised — retains its full
                    //     statistics unchanged, computed by one shared set of definitions (Req 14.1,
                    //     14.2, 14.4).
                    await AssertEveryMembershipRetainsStatsAsync(repository, squad);

                    // (2) An Inactive/anonymised membership still contributes to other memberships'
                    //     co-appearance rows, keyed on its persistent identity (Req 14.1, 14.3).
                    await AssertHistoricalMembersStillContributeAsync(repository, squad);

                    // (3) Anonymised memberships are identified only by the "Former player"
                    //     placeholder in their reference, in others' co-appearance rows, and in
                    //     leaderboards, while retaining their values; non-anonymised under real names
                    //     (Req 3.5, 4.6, 14.4, 14.5). Also proves identity is unchanged (Req 14.3).
                    await AssertAnonymisationPlaceholderAndIdentityAsync(repository, squad);
                }
            });

            return true;
        });

    /// <summary>
    /// Asserts, for every membership in <paramref name="squad"/> regardless of its
    /// <see cref="MembershipState"/> or anonymisation, that the repository's per-membership Profile
    /// aggregates equal the oracle's — proving an <c>Inactive</c> or anonymised membership retains its
    /// own appearances, W/L/D record, streak sequence, rating progression, bib appearances, and
    /// co-appearance / partnership / bogey rows unchanged, computed by the same definitions applied to
    /// an <c>Active</c> membership (Requirements 14.1, 14.2, 14.4).
    /// </summary>
    private static async Task AssertEveryMembershipRetainsStatsAsync(
        IStatsRepository repository, SeededStatsDataset.SquadData squad)
    {
        foreach (SeededStatsDataset.MembershipData member in squad.Memberships)
        {
            MembershipStatsData? expected = StatsReferenceOracle.GetMembershipStats(squad, member.MembershipId);
            MembershipStatsData? actual = await repository.GetMembershipStatsAsync(
                squad.SquadId, member.MembershipId, CancellationToken.None);

            // Every membership of the squad resolves on both sides, whatever its lifecycle state.
            Assert.NotNull(expected);
            Assert.NotNull(actual);
            AssertStatsEqual(expected!, actual!);
        }
    }

    /// <summary>
    /// Asserts that every <c>Inactive</c> or anonymised membership that shared a completed match with
    /// another membership still appears in that other membership's co-appearance rows, keyed on its
    /// persistent <see cref="SquadMembership"/> identity — so deactivation or anonymisation never
    /// rewrites another player's statistics (Requirements 14.1, 14.3). Guarded to run only where such a
    /// historical membership and a shared completed match exist.
    /// </summary>
    private async Task AssertHistoricalMembersStillContributeAsync(
        IStatsRepository repository, SeededStatsDataset.SquadData squad)
    {
        IReadOnlyList<SeededStatsDataset.MembershipData> historical = squad.Memberships
            .Where(m => m.State == MembershipState.Inactive || m.IsAnonymised)
            .ToList();

        foreach (SeededStatsDataset.MembershipData other in squad.Memberships)
        {
            MembershipStatsData? otherStats = await repository.GetMembershipStatsAsync(
                squad.SquadId, other.MembershipId, CancellationToken.None);
            Assert.NotNull(otherStats);

            var coAppearanceIds = otherStats!.CoAppearances.Select(row => row.MembershipId).ToHashSet();

            foreach (SeededStatsDataset.MembershipData historic in historical)
            {
                if (historic.MembershipId == other.MembershipId)
                {
                    continue;
                }

                // Guard: only assert contribution where the pair actually shared a completed match.
                if (!SharedCompletedMatch(squad, other.MembershipId, historic.MembershipId))
                {
                    continue;
                }

                // The historical membership persists in the other membership's co-appearance rows,
                // keyed on its unchanged persistent identity (Req 14.1, 14.3).
                Assert.Contains(historic.MembershipId, coAppearanceIds);

                // Its de-identified contribution is counted at least once (teammate or opponent).
                MembershipStatsData.CoAppearanceRow row =
                    otherStats.CoAppearances.First(r => r.MembershipId == historic.MembershipId);
                Assert.True(row.TeammateCount + row.OpponentCount >= 1);
            }
        }
    }

    /// <summary>
    /// Asserts that anonymised memberships are identified only by the
    /// <see cref="SquadMembership.DisplayNamePlaceholder"/> ("Former player") — in their membership
    /// reference (Requirement 3.5), wherever they are referenced in another membership's co-appearance
    /// rows (Requirement 14.4), and in every leaderboard row (Requirements 4.6, 14.5) — while their
    /// computed values are retained and their persistent identity is unchanged (Requirement 14.3); and
    /// that a non-anonymised membership is presented under its real display name throughout. The
    /// repository agrees with the oracle in every case.
    /// </summary>
    private async Task AssertAnonymisationPlaceholderAndIdentityAsync(
        IStatsRepository repository, SeededStatsDataset.SquadData squad)
    {
        // --- Membership references: placeholder iff anonymised; identity always resolves (Req 3.5, 14.3). ---
        foreach (SeededStatsDataset.MembershipData member in squad.Memberships)
        {
            MembershipRef? expectedRef = StatsReferenceOracle.FindMembership(squad, member.MembershipId);
            MembershipRef? actualRef =
                await repository.FindMembershipAsync(squad.SquadId, member.MembershipId, CancellationToken.None);

            Assert.NotNull(expectedRef);
            Assert.NotNull(actualRef);
            Assert.Equal(expectedRef, actualRef);

            // Identity is preserved regardless of anonymisation (Req 14.3).
            Assert.Equal(member.MembershipId, actualRef!.MembershipId);

            if (member.IsAnonymised)
            {
                // An anonymised membership is identified only by the placeholder (Req 3.5).
                Assert.Equal(SquadMembership.DisplayNamePlaceholder, actualRef.DisplayName);
            }
            else
            {
                // A non-anonymised membership keeps its real display name.
                Assert.NotEqual(SquadMembership.DisplayNamePlaceholder, actualRef.DisplayName);
                Assert.Equal(member.DisplayName, actualRef.DisplayName);
            }
        }

        // --- Others' co-appearance rows identify an anonymised member only by the placeholder (Req 14.4). ---
        var anonymisedIds = squad.Memberships
            .Where(m => m.IsAnonymised)
            .Select(m => m.MembershipId)
            .ToHashSet();

        if (anonymisedIds.Count > 0)
        {
            foreach (SeededStatsDataset.MembershipData member in squad.Memberships)
            {
                MembershipStatsData? stats = await repository.GetMembershipStatsAsync(
                    squad.SquadId, member.MembershipId, CancellationToken.None);
                Assert.NotNull(stats);

                foreach (MembershipStatsData.CoAppearanceRow row in stats!.CoAppearances)
                {
                    if (anonymisedIds.Contains(row.MembershipId))
                    {
                        Assert.Equal(SquadMembership.DisplayNamePlaceholder, row.DisplayName);
                    }
                }
            }
        }

        // --- Leaderboards: an anonymised entry carries the placeholder name and retains its value
        //     (Req 4.6, 14.5); a non-anonymised entry carries its real name; repo equals oracle. ---
        foreach (LeaderboardStatistic statistic in Enum.GetValues<LeaderboardStatistic>())
        {
            IReadOnlyList<LeaderboardRow> expectedRows = StatsReferenceOracle.GetLeaderboardRows(
                squad, statistic, _harness.RatingEngine, _harness.DisplayParameters);
            IReadOnlyList<LeaderboardRow> actualRows = await repository.GetLeaderboardRowsAsync(
                squad.SquadId, statistic, CancellationToken.None);

            Dictionary<Guid, LeaderboardRow> actualById = actualRows.ToDictionary(row => row.MembershipId);

            foreach (LeaderboardRow expectedRow in expectedRows)
            {
                Assert.True(actualById.TryGetValue(expectedRow.MembershipId, out LeaderboardRow? actualRow),
                    $"Missing leaderboard row for {expectedRow.MembershipId}.");

                // The repository agrees with the oracle on name and value, so the placeholder/value
                // handling is consistent with the specification (Req 4.6, 14.5).
                Assert.Equal(expectedRow.DisplayName, actualRow!.DisplayName);
                Assert.Equal(expectedRow.Value, actualRow.Value);
                Assert.Equal(expectedRow.Results, actualRow.Results);

                if (anonymisedIds.Contains(expectedRow.MembershipId))
                {
                    // Anonymised entry: placeholder name, value still retained (Req 4.6, 14.5).
                    Assert.Equal(SquadMembership.DisplayNamePlaceholder, actualRow.DisplayName);
                }
                else
                {
                    // Non-anonymised entry: real display name.
                    Assert.NotEqual(SquadMembership.DisplayNamePlaceholder, actualRow.DisplayName);
                }
            }
        }
    }

    /// <summary>
    /// Independently determines, from the seeded dataset, whether <paramref name="a"/> and
    /// <paramref name="b"/> both appear in the kickoff lineup of at least one <c>Completed</c> match —
    /// the precondition under which the historical membership must still contribute to the other's
    /// co-appearance rows.
    /// </summary>
    private static bool SharedCompletedMatch(SeededStatsDataset.SquadData squad, Guid a, Guid b) =>
        squad.Matches.Any(match =>
            match.State == MatchState.Completed &&
            match.Teams.Any(team => team.Roster.Contains(a)) &&
            match.Teams.Any(team => team.Roster.Contains(b)));

    private static void AssertStatsEqual(MembershipStatsData expected, MembershipStatsData actual)
    {
        Assert.Equal(expected.Appearances, actual.Appearances);
        Assert.Equal(expected.Wins, actual.Wins);
        Assert.Equal(expected.Draws, actual.Draws);
        Assert.Equal(expected.Losses, actual.Losses);
        Assert.Equal(expected.BibAppearances, actual.BibAppearances);
        Assert.Equal(expected.Results, actual.Results);
        Assert.Equal(expected.Mu, actual.Mu);
        Assert.Equal(expected.Sigma, actual.Sigma);
        Assert.Equal(expected.Snapshots.Count, actual.Snapshots.Count);
        Assert.Equal(expected.Snapshots, actual.Snapshots);

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
            Assert.True(byId.TryGetValue(row.MembershipId, out MembershipStatsData.CoAppearanceRow? match),
                $"Missing co-appearance row for {row.MembershipId}.");
            Assert.Equal(row.TeammateCount, match!.TeammateCount);
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
            Assert.True(byId.TryGetValue(row.MembershipId, out MembershipStatsData.PairedStatRow? match),
                $"Missing paired-stat row for {row.MembershipId}.");
            Assert.Equal(row.Wins, match!.Wins);
            Assert.Equal(row.QualifyingMatches, match.QualifyingMatches);
            Assert.Equal(row.DisplayName, match.DisplayName);
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
