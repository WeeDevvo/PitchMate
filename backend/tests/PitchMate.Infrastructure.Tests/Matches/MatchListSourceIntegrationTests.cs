using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;
using PitchMate.Infrastructure.Matches.Queries;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Matches;

/// <summary>
/// Integration tests for <see cref="EfMatchListSource"/> (match-read-models task 5.3), run against
/// <b>real PostgreSQL</b> with the production EF migrations applied — no in-memory provider and no
/// SQLite substitute, per the project's test-layering standard. Docker is required.
/// <para>
/// These tests exist because the list read's behaviour lives almost entirely in SQL the .NET type
/// system cannot check: a <c>LEFT JOIN LATERAL … ON TRUE</c> that must separate "squad visible, no
/// matches" from "squad not visible"; an ordering key that is a per-row minimum over a <c>jsonb</c>
/// array; an explicit <c>NOT is_deleted</c> on each joined table standing in for a query filter that
/// applies to LINQ only; and a <c>LIMIT n + 1</c> that <em>is</em> the truncation signal. Each case
/// below pins one of those.
/// </para>
/// <para>
/// Every expectation is read off the <see cref="Match"/> aggregate that produced the row, and the
/// expected ordering comes from the Domain's own <see cref="MatchSchedulingOrder"/> — so the
/// assertions compare the SQL against the specification rather than against a restatement of it.
/// </para>
/// <para>
/// <b>Validates: Requirements 1.3, 1.10, 1.11, 13.2.</b>
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class MatchListSourceIntegrationTests
{
    /// <summary>
    /// The class's harness, held <see langword="static"/> on purpose: xUnit constructs a fresh test
    /// class instance per <c>[Fact]</c>, so an instance field would re-run the harness's
    /// drop-and-migrate for every test. One static harness gives the mandated "one migrated database
    /// per test class, created lazily on first use" shape. Tests within a class run sequentially, and
    /// the harness's own initialisation is gated regardless.
    /// </summary>
    private static MatchListSourceHarness? _shared;

    private readonly MatchListSourceHarness _harness;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public MatchListSourceIntegrationTests(PostgreSqlContainerFixture fixture)
    {
        _harness = _shared ??= new MatchListSourceHarness(fixture);
    }

    /// <summary>
    /// **Validates: Requirements 1.3, 1.11** — a squad holding several matches yields a page whose
    /// entries are exactly that squad's admitted matches, in the order of Requirement 1.9, with every
    /// projected member equal to what the producing aggregate holds and no truncation reported.
    /// </summary>
    [Fact]
    public async Task ListForSquad_ReturnsEveryAdmittedMatch_InSchedulingOrder_WithEveryMemberProjected()
    {
        SeededMatchListDataset.SquadData squad = await _harness.SeedSquadAsync(
            new MatchListDatasetSpec.SquadSpec(
                MemberCount: 14,
                Matches:
                [
                    Draft([4, 9]),
                    Confirmed([6, 11], confirmedDayIndex: 1, participantCount: 3),
                    Rolled([3], participantCount: 10),
                    InProgress([13], participantCount: 12),
                    Completed([7], participantCount: 11, completedOffsetSeconds: 30)
                ]));

        MatchListPage? page = await _harness.ListForSquadAsync(squad.SquadId, MatchListLimits.MaximumEntries);

        Assert.NotNull(page);
        Assert.False(page!.Truncated);
        AssertEntriesMatch(squad.ExpectedOrder, page.Entries);
        AssertStrictlyDescendingBySchedulingInstant(squad, page.Entries);
    }

    /// <summary>
    /// **Validates: Requirement 1.11** — a <em>visible</em> squad holding no match is reported as an
    /// empty page rather than as a concealment. This is the case the lateral join's <c>ON TRUE</c>
    /// exists for: the statement yields exactly one placeholder row whose match identity is null, and
    /// the source must read that as "zero entries", not as "squad not visible".
    /// </summary>
    [Fact]
    public async Task ListForSquad_ReturnsEmptyPage_ForVisibleSquadWithNoMatches()
    {
        SeededMatchListDataset.SquadData squad = await _harness.SeedSquadAsync(
            new MatchListDatasetSpec.SquadSpec(MemberCount: 3, Matches: []));

        MatchListPage? page = await _harness.ListForSquadAsync(squad.SquadId, MatchListLimits.MaximumEntries);

        Assert.NotNull(page);
        Assert.Empty(page!.Entries);
        Assert.False(page.Truncated);
    }

    /// <summary>
    /// **Validates: Requirement 1.3** — with two squads whose matches interleave in scheduling order,
    /// the page for one carries that squad's matches alone. The interleaving is what makes the clause
    /// load-bearing: a query that dropped the squad predicate would still return a correctly
    /// <em>ordered</em> list, just one containing the other squad's matches, so an uninterleaved
    /// dataset could not detect the fault.
    /// </summary>
    [Fact]
    public async Task ListForSquad_ReturnsOnlyTheTargetSquadsMatches_WhenInterleavedWithAnothers()
    {
        SeededMatchListDataset seeded = await _harness.SeedAsync(new MatchListDatasetSpec(
        [
            // Target squad: days 2, 6, 10.
            new MatchListDatasetSpec.SquadSpec(
                MemberCount: 12,
                Matches: [Draft([2]), Confirmed([6], participantCount: 2), Completed([10], participantCount: 10)]),

            // Other squad: days 1, 4, 8, 12 — strictly interleaved with the target's.
            new MatchListDatasetSpec.SquadSpec(
                MemberCount: 12,
                Matches: [Draft([1]), Draft([4]), Rolled([8], participantCount: 10), Draft([12])])
        ]));

        SeededMatchListDataset.SquadData target = seeded.SquadAt(0);
        SeededMatchListDataset.SquadData other = seeded.SquadAt(1);

        MatchListPage? page = await _harness.ListForSquadAsync(target.SquadId, MatchListLimits.MaximumEntries);

        Assert.NotNull(page);
        AssertEntriesMatch(target.ExpectedOrder, page!.Entries);

        // Explicit negative: not one of the other squad's matches leaked in.
        IReadOnlySet<Guid> foreignIds = other.Matches.Select(match => match.Id).ToHashSet();
        Assert.DoesNotContain(page.Entries, entry => foreignIds.Contains(entry.MatchId));

        // And the other squad's own page is likewise its own, so the scoping is not one-directional.
        MatchListPage? otherPage = await _harness.ListForSquadAsync(other.SquadId, MatchListLimits.MaximumEntries);
        Assert.NotNull(otherPage);
        AssertEntriesMatch(other.ExpectedOrder, otherPage!.Entries);
    }

    /// <summary>
    /// **Validates: Requirement 1.11** — a soft-deleted squad, one inside its deletion grace period,
    /// is reported as <see langword="null"/> so the handler can conceal it, and so is a squad identity
    /// that never existed. The two are indistinguishable at this seam, which is the point.
    /// <para>
    /// This is the case the explicit squad join exists for: a squad's soft-delete does not cascade to
    /// its memberships or its matches, so its match rows are still there and a query that gated on a
    /// resolved membership instead would happily serve them.
    /// </para>
    /// </summary>
    [Fact]
    public async Task ListForSquad_ReturnsNull_ForSoftDeletedSquad_AndForAnAbsentOne()
    {
        SeededMatchListDataset.SquadData squad = await _harness.SeedSquadAsync(
            new MatchListDatasetSpec.SquadSpec(
                MemberCount: 12,
                Matches: [Draft([5]), Completed([9], participantCount: 10)],
                SoftDeleteSquad: true));

        // The matches themselves were not deleted, so a missing squad filter would have returned them.
        Assert.Equal(2, squad.Admitted.Count);

        MatchListPage? deleted = await _harness.ListForSquadAsync(squad.SquadId, MatchListLimits.MaximumEntries);
        MatchListPage? absent = await _harness.ListForSquadAsync(Guid.CreateVersion7(), MatchListLimits.MaximumEntries);

        Assert.Null(deleted);
        Assert.Null(absent);
    }

    /// <summary>
    /// **Validates: Requirement 1.3** — a soft-deleted match is excluded and the surviving matches are
    /// returned, unaffected. The exclusion is asserted explicitly rather than inferred from the count,
    /// because the global soft-delete query filter does not apply to this read's raw SQL: the
    /// <c>NOT is_deleted</c> predicate is hand-written and therefore worth pinning.
    /// </summary>
    [Fact]
    public async Task ListForSquad_ExcludesSoftDeletedMatches()
    {
        SeededMatchListDataset.SquadData squad = await _harness.SeedSquadAsync(
            new MatchListDatasetSpec.SquadSpec(
                MemberCount: 12,
                Matches:
                [
                    Draft([3]),
                    Draft([8], softDeleted: true),
                    Confirmed([5], participantCount: 4),
                    Completed([11], participantCount: 10, softDeleted: true)
                ]));

        MatchListPage? page = await _harness.ListForSquadAsync(squad.SquadId, MatchListLimits.MaximumEntries);

        Assert.NotNull(page);
        Assert.Equal(2, squad.SoftDeletedMatchIds.Count);
        AssertEntriesMatch(squad.ExpectedOrder, page!.Entries);
        Assert.DoesNotContain(page.Entries, entry => squad.SoftDeletedMatchIds.Contains(entry.MatchId));
    }

    /// <summary>
    /// **Validates: Requirement 1.3** — every one of the six lifecycle states is admitted. The read
    /// applies no state filter, so a draft, a cancelled match and a completed one all appear; and
    /// because the projection is state-dependent, this is also where a <c>Completed</c> entry carrying
    /// its result and a <c>GatheringAvailability</c> entry carrying its candidate days are checked
    /// side by side in one page.
    /// </summary>
    [Fact]
    public async Task ListForSquad_AdmitsMatchesInEverySixLifecycleStates()
    {
        SeededMatchListDataset.SquadData squad = await _harness.SeedSquadAsync(
            new MatchListDatasetSpec.SquadSpec(
                MemberCount: 14,
                Matches:
                [
                    Draft([2, 3]),
                    Confirmed([4], participantCount: 5),
                    Rolled([6], participantCount: 10),
                    InProgress([8], participantCount: 13),
                    Completed([10], participantCount: 14, completedOffsetSeconds: 7),
                    Cancelled([12])
                ]));

        MatchListPage? page = await _harness.ListForSquadAsync(squad.SquadId, MatchListLimits.MaximumEntries);

        Assert.NotNull(page);
        AssertEntriesMatch(squad.ExpectedOrder, page!.Entries);

        // Every defined state is present exactly once, so none was filtered out.
        Assert.Equal(
            Enum.GetValues<MatchState>().OrderBy(state => state),
            page.Entries.Select(entry => entry.State).OrderBy(state => state));
    }

    /// <summary>
    /// **Validates: Requirement 1.3** — when a draft supplies its candidate days out of chronological
    /// order, the list orders by the <em>earliest</em> of them rather than by the first one stored.
    /// <para>
    /// The dataset is built so the two readings disagree: ordering by the earliest day puts the second
    /// match first, while ordering by the first stored day would put the first match first. The stored
    /// order is also asserted to be non-chronological, so the case cannot quietly stop testing
    /// anything if the aggregate ever started sorting the days on the way in.
    /// </para>
    /// </summary>
    [Fact]
    public async Task ListForSquad_OrdersByEarliestCandidateDay_WhenTheDraftSuppliedThemOutOfOrder()
    {
        SeededMatchListDataset.SquadData squad = await _harness.SeedSquadAsync(
            new MatchListDatasetSpec.SquadSpec(
                MemberCount: 3,
                Matches:
                [
                    Draft([30, 5, 12]),  // earliest 5, first stored 30
                    Draft([9, 40, 8])    // earliest 8, first stored 9
                ]));

        MatchListPage? page = await _harness.ListForSquadAsync(squad.SquadId, MatchListLimits.MaximumEntries);

        Assert.NotNull(page);
        AssertEntriesMatch(squad.ExpectedOrder, page!.Entries);

        // Ordering by the earliest day puts the second-seeded match first; ordering by the first
        // stored day would have put the first-seeded one first.
        Assert.Equal(squad.Matches[1].Id, page.Entries[0].MatchId);
        Assert.Equal(squad.Matches[0].Id, page.Entries[1].MatchId);

        // The days really did reach the database unsorted, so the "earliest" clause is load-bearing.
        Assert.All(page.Entries, entry =>
            Assert.False(
                entry.CandidateDays.SequenceEqual(entry.CandidateDays.OrderBy(day => day)),
                "The candidate days were stored chronologically, so this case no longer distinguishes 'earliest' from 'first'."));
    }

    /// <summary>
    /// **Validates: Requirement 1.10** — the truncation signal at its boundary. With the declared
    /// maximum of 200 entries: 199 matches fill a page untruncated, 200 fill it exactly and still
    /// report untruncated, and 201 report truncated while carrying the first 200 of the order.
    /// <para>
    /// The trio matters because the signal is produced by admitting <c>limit + 1</c> rows, so an
    /// off-by-one in either direction shows up only at the boundary: a <c>&gt;=</c> in place of a
    /// <c>&gt;</c> would wrongly flag the exact-200 case, and a plain <c>LIMIT 200</c> would never
    /// flag the 201 case at all.
    /// </para>
    /// </summary>
    [Theory]
    [InlineData(MatchListLimits.MaximumEntries - 1, MatchListLimits.MaximumEntries - 1, false)]
    [InlineData(MatchListLimits.MaximumEntries, MatchListLimits.MaximumEntries, false)]
    [InlineData(MatchListLimits.MaximumEntries + 1, MatchListLimits.MaximumEntries, true)]
    public async Task ListForSquad_ReportsTruncation_AtTheDeclaredMaximumBoundary(
        int seededMatches,
        int expectedEntries,
        bool expectedTruncated)
    {
        // Drafts: the cheapest match to seed in bulk, and the limit is indifferent to state. Each
        // carries one distinct candidate day so the expected order is total and unambiguous.
        List<MatchListDatasetSpec.MatchSpec> matches =
            [.. Enumerable.Range(1, seededMatches).Select(offset => Draft([offset]))];

        SeededMatchListDataset.SquadData squad = await _harness.SeedSquadAsync(
            new MatchListDatasetSpec.SquadSpec(MemberCount: 2, Matches: matches));

        MatchListPage? page = await _harness.ListForSquadAsync(squad.SquadId, MatchListLimits.MaximumEntries);

        Assert.NotNull(page);
        Assert.Equal(expectedEntries, page!.Entries.Count);
        Assert.Equal(expectedTruncated, page.Truncated);

        // The retained entries are the *first* `limit` of the order, not an arbitrary subset.
        AssertEntriesMatch([.. squad.ExpectedOrder.Take(expectedEntries)], page.Entries);
    }

    // --- Spec helpers -------------------------------------------------------------------------

    private static MatchListDatasetSpec.MatchSpec Draft(int[] candidateDayOffsets, bool softDeleted = false) =>
        new(MatchState.GatheringAvailability, candidateDayOffsets, SoftDeleted: softDeleted);

    private static MatchListDatasetSpec.MatchSpec Confirmed(
        int[] candidateDayOffsets,
        int participantCount,
        int confirmedDayIndex = 0) =>
        new(MatchState.Confirmed, candidateDayOffsets, confirmedDayIndex, participantCount);

    private static MatchListDatasetSpec.MatchSpec Cancelled(int[] candidateDayOffsets) =>
        new(MatchState.Cancelled, candidateDayOffsets);

    private static MatchListDatasetSpec.MatchSpec Rolled(int[] candidateDayOffsets, int participantCount) =>
        new(MatchState.TeamsRolled, candidateDayOffsets, ParticipantCount: participantCount);

    private static MatchListDatasetSpec.MatchSpec InProgress(int[] candidateDayOffsets, int participantCount) =>
        new(MatchState.InProgress, candidateDayOffsets, ParticipantCount: participantCount);

    private static MatchListDatasetSpec.MatchSpec Completed(
        int[] candidateDayOffsets,
        int participantCount,
        bool softDeleted = false,
        int completedOffsetSeconds = 0) =>
        new(
            MatchState.Completed,
            candidateDayOffsets,
            ParticipantCount: participantCount,
            SoftDeleted: softDeleted,
            CompletedOffsetSeconds: completedOffsetSeconds);

    // --- Assertions ---------------------------------------------------------------------------

    /// <summary>
    /// Asserts the page's entries are, positionally, the expected matches — same order, and every
    /// projected member equal to what the producing aggregate holds.
    /// </summary>
    private static void AssertEntriesMatch(IReadOnlyList<Match> expected, IReadOnlyList<MatchListEntry> actual)
    {
        Assert.Equal(expected.Select(match => match.Id), actual.Select(entry => entry.MatchId));

        for (int i = 0; i < expected.Count; i++)
        {
            AssertEntryMatches(expected[i], actual[i]);
        }
    }

    /// <summary>Asserts one entry against the aggregate that produced it, member by member.</summary>
    private static void AssertEntryMatches(Match expected, MatchListEntry actual)
    {
        Assert.Equal(expected.Id, actual.MatchId);
        Assert.Equal(expected.State, actual.State);
        Assert.Equal(expected.Location, actual.Location);
        Assert.Equal(expected.ConfirmedDay?.Instant, actual.ConfirmedDay);
        Assert.Equal(expected.Participants.Count, actual.ParticipantCount);

        // Candidate days are carried only while gathering availability; otherwise the member is an
        // empty collection rather than being omitted (Requirement 1.5, 1.8).
        IEnumerable<DateTimeOffset> expectedDays = expected.State == MatchState.GatheringAvailability
            ? expected.CandidateDays.Select(day => day.Instant)
            : [];
        Assert.Equal(expectedDays, actual.CandidateDays);

        // Locked team names and bib flags in locked-team order, and nothing else.
        IEnumerable<LockedTeamSummary> expectedTeams = expected.KickoffLineup is { } lineup
            ? lineup.Teams.Select(team => new LockedTeamSummary(team.TeamName, team.BibFlag))
            : [];
        Assert.Equal(expectedTeams, actual.LockedTeams);

        if (expected.State == MatchState.Completed)
        {
            Assert.NotNull(actual.RecordedResult);
            Assert.Equal(expected.RecordedResult!.Fidelity, actual.RecordedResult!.Fidelity);
            Assert.Equal(expected.RecordedResult.TeamScores, actual.RecordedResult.TeamScores);
            Assert.Equal(expected.CompletedAt, actual.CompletedAt);
        }
        else
        {
            Assert.Null(actual.RecordedResult);
            Assert.Null(actual.CompletedAt);
        }
    }

    /// <summary>
    /// Asserts the returned order is strictly descending by the Domain's scheduling instant, so the
    /// in-database <c>ORDER BY</c> and the Domain comparator agree on more than just the final
    /// sequence — a page that happened to match positionally while being internally inconsistent would
    /// fail here.
    /// </summary>
    private static void AssertStrictlyDescendingBySchedulingInstant(
        SeededMatchListDataset.SquadData squad,
        IReadOnlyList<MatchListEntry> entries)
    {
        for (int i = 1; i < entries.Count; i++)
        {
            DateTimeOffset? previous = MatchSchedulingOrder.SchedulingInstantOf(squad.MatchById(entries[i - 1].MatchId));
            DateTimeOffset? current = MatchSchedulingOrder.SchedulingInstantOf(squad.MatchById(entries[i].MatchId));

            Assert.NotNull(previous);
            Assert.NotNull(current);
            Assert.True(
                previous!.Value >= current!.Value,
                $"Entry {i - 1} ({previous}) must not sort before entry {i} ({current}).");
        }
    }
}
