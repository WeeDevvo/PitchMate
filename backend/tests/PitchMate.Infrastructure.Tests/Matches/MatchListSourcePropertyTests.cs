using FsCheck;
using FsCheck.Xunit;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;
using PitchMate.Infrastructure.Matches.Queries;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Matches;

/// <summary>
/// Model-based property tests for the match list read (match-read-models tasks 7.2–7.5), comparing the
/// real <see cref="EfMatchListSource"/> SQL on Testcontainers PostgreSQL — production migrations
/// applied — against <see cref="MatchListReferenceOracle"/>, which derives every expectation from the
/// Domain aggregates and <see cref="MatchSchedulingOrder"/>.
/// <para>
/// Every case seeds into the one migrated database this class owns (see
/// <see cref="MatchListSourceHarness"/>), as fresh squads with fresh identities. Each earlier case's
/// squads therefore stay behind as further squads whose matches must not contribute, which strengthens
/// the scoping property as the run proceeds. Every iteration performs database work, so each property
/// runs at least ten datasets; the per-dataset comparisons take each run well past a hundred logical
/// checks. Requires Docker.
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class MatchListSourcePropertyTests
{
    private const int MaxTest = 10;

    /// <summary>
    /// The class's harness, held <see langword="static"/> so the class keeps one lazily migrated
    /// database across its properties: xUnit constructs a fresh instance per test method.
    /// </summary>
    private static MatchListSourceHarness? _shared;

    private readonly MatchListSourceHarness _harness;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public MatchListSourcePropertyTests(PostgreSqlContainerFixture fixture)
    {
        _harness = _shared ??= new MatchListSourceHarness(fixture, "match_list_properties");
    }

    // Feature: match-read-models, Property 1: The list is exactly the identified squad's admitted matches.
    /// <summary>
    /// **Validates: Requirements 1.2, 1.3, 13.6** — for 2–3 squads whose matches interleave, each
    /// spanning every state and including a soft-deleted match, every squad's page holds exactly its own
    /// admitted matches: each returned id is an admitted match of that squad, and each admitted match of
    /// that squad is returned.
    /// </summary>
    [Property(MaxTest = MaxTest)]
    public Property ListIsExactlyTheSquadsAdmittedMatches() =>
        Prop.ForAll(Arb.From(MatchListDatasetGenerators.Dataset()), spec => RunAsync(async () =>
        {
            SeededMatchListDataset seeded = await _harness.SeedAsync(spec);

            // Non-vacuity: the dataset carries the cases the property is about.
            Assert.InRange(seeded.Squads.Count, 2, 3);
            Assert.Equal(
                Enum.GetValues<MatchState>().OrderBy(state => state),
                seeded.SquadAt(0).Admitted.Select(match => match.State).Distinct().OrderBy(state => state));
            Assert.Contains(seeded.Squads, squad => squad.SoftDeletedMatchIds.Count > 0);

            foreach (SeededMatchListDataset.SquadData squad in seeded.Squads)
            {
                MatchListPage? page = await _harness.ListForSquadAsync(squad.SquadId, MatchListLimits.MaximumEntries);
                Assert.NotNull(page);

                HashSet<Guid> admitted = squad.Admitted.Select(match => match.Id).ToHashSet();
                HashSet<Guid> returned = page!.Entries.Select(entry => entry.MatchId).ToHashSet();

                Assert.Equal(page.Entries.Count, returned.Count);
                Assert.Subset(admitted, returned);
                Assert.Superset(admitted, returned);
                Assert.DoesNotContain(page.Entries, entry => squad.SoftDeletedMatchIds.Contains(entry.MatchId));
            }

            return true;
        }));

    // Feature: match-read-models, Property 2: The list order is total, declared, and stable.
    /// <summary>
    /// **Validates: Requirements 1.9, 13.13** — for a squad holding a pair of matches with equal
    /// scheduling instants and a draft whose days were stored out of chronological order, the entries
    /// are strictly decreasing under the declared comparator — no two comparing equal — and a second
    /// read over unmodified data returns the identical sequence.
    /// </summary>
    [Property(MaxTest = MaxTest)]
    public Property ListOrderIsTotalDeclaredAndStable() =>
        Prop.ForAll(Arb.From(MatchListDatasetGenerators.TiedSquadDataset()), spec => RunAsync(async () =>
        {
            SeededMatchListDataset.SquadData squad = (await _harness.SeedAsync(spec)).SquadAt(0);

            // Non-vacuity: a tie on the scheduling instant, and days stored out of order.
            Assert.True(
                squad.Admitted
                    .GroupBy(MatchSchedulingOrder.SchedulingInstantOf)
                    .Any(group => group.Count() > 1),
                "The dataset holds no pair with equal scheduling instants.");
            Assert.Contains(squad.Admitted, match =>
                match.State == MatchState.GatheringAvailability &&
                !match.CandidateDays.Select(day => day.Instant).SequenceEqual(
                    match.CandidateDays.Select(day => day.Instant).OrderBy(day => day)));

            MatchListPage? first = await _harness.ListForSquadAsync(squad.SquadId, MatchListLimits.MaximumEntries);
            MatchListPage? second = await _harness.ListForSquadAsync(squad.SquadId, MatchListLimits.MaximumEntries);
            Assert.NotNull(first);
            Assert.NotNull(second);

            List<Match> ordered = [.. first!.Entries.Select(entry => squad.MatchById(entry.MatchId))];
            Assert.Equal(squad.Admitted.Count, ordered.Count);

            for (int i = 0; i < ordered.Count; i++)
            {
                for (int j = i + 1; j < ordered.Count; j++)
                {
                    Assert.True(
                        MatchSchedulingOrder.Instance.Compare(ordered[i], ordered[j]) < 0,
                        $"Entry {i} must sort strictly before entry {j} under the declared comparator.");
                }
            }

            Assert.Equal(
                first.Entries.Select(entry => entry.MatchId),
                second!.Entries.Select(entry => entry.MatchId));

            return true;
        }));

    // Feature: match-read-models, Property 3: The list is bounded and reports its own truncation.
    /// <summary>
    /// **Validates: Requirements 1.10, 1.11, 13.2** — for a squad of <c>n</c> admitted matches the read
    /// returns <c>min(n, 200)</c> entries that are exactly the first <c>min(n, 200)</c> of the declared
    /// order, and reports truncation iff <c>n &gt; 200</c>. Sizes are drawn from the small range and
    /// from 199/200/201; <see cref="ListIsBoundedAtPinnedSizes"/> pins the boundary and the empty case.
    /// </summary>
    [Property(MaxTest = MaxTest)]
    public Property ListIsBoundedAndReportsTruncation() =>
        Prop.ForAll(
            Arb.From(
                from admitted in MatchListDatasetGenerators.BoundSizes()
                from spec in MatchListDatasetGenerators.BoundDataset(admitted)
                select (Admitted: admitted, Spec: spec)),
            testCase => RunAsync(() => AssertBoundAsync(testCase.Admitted, testCase.Spec)));

    /// <summary>
    /// **Validates: Requirements 1.10, 1.11, 13.2** — Property 3 at the pinned sizes: the empty squad and
    /// each side of the declared maximum, each seeded alongside soft-deleted matches that must not count.
    /// </summary>
    [Theory]
    [InlineData(0)]
    [InlineData(MatchListLimits.MaximumEntries - 1)]
    [InlineData(MatchListLimits.MaximumEntries)]
    [InlineData(MatchListLimits.MaximumEntries + 1)]
    public async Task ListIsBoundedAtPinnedSizes(int admitted)
    {
        MatchListDatasetSpec spec = MatchListDatasetGenerators.BoundDataset(admitted).Sample(0, 1).First();

        Assert.True(await AssertBoundAsync(admitted, spec));
    }

    // Feature: match-read-models, Property 4: The list projection equals its specification.
    /// <summary>
    /// **Validates: Requirements 1.4, 1.5, 1.6, 1.7, 1.12, 13.3** — every entry of every squad's page is
    /// structurally equal to the oracle's: location verbatim; a participant count over guests and
    /// registered members alike; candidate days only while gathering availability; the recorded result
    /// and completion instant only when completed; locked team names and bib flags in locked-team order
    /// whenever a lineup was locked — and none for working teams that were never locked.
    /// </summary>
    [Property(MaxTest = MaxTest)]
    public Property ListProjectionEqualsItsSpecification() =>
        Prop.ForAll(Arb.From(MatchListDatasetGenerators.Dataset()), spec => RunAsync(async () =>
        {
            SeededMatchListDataset seeded = await _harness.SeedAsync(spec);

            // Non-vacuity: the state-dependent members each have a case to bite on.
            List<Match> admitted = [.. seeded.Squads.SelectMany(squad => squad.Admitted)];
            Assert.Contains(admitted, match => match.State == MatchState.GatheringAvailability);
            Assert.Contains(admitted, match => match.State == MatchState.Completed);
            Assert.Contains(admitted, match => match.KickoffLineup is not null);
            Assert.Contains(admitted, match => match.Teams.Count > 0 && match.KickoffLineup is null);

            foreach (SeededMatchListDataset.SquadData squad in seeded.Squads)
            {
                MatchListPage? page = await _harness.ListForSquadAsync(squad.SquadId, MatchListLimits.MaximumEntries);
                MatchListReferenceOracle.AssertAgrees(MatchListReferenceOracle.Expected(squad), page);
            }

            return true;
        }));

    /// <summary>Seeds a bound dataset and asserts the page against the oracle and the bound.</summary>
    private async Task<bool> AssertBoundAsync(int admitted, MatchListDatasetSpec spec)
    {
        SeededMatchListDataset.SquadData squad = (await _harness.SeedAsync(spec)).SquadAt(0);
        Assert.Equal(admitted, squad.Admitted.Count);

        MatchListPage? page = await _harness.ListForSquadAsync(squad.SquadId, MatchListLimits.MaximumEntries);

        Assert.NotNull(page);
        Assert.Equal(Math.Min(admitted, MatchListLimits.MaximumEntries), page!.Entries.Count);
        Assert.Equal(admitted > MatchListLimits.MaximumEntries, page.Truncated);
        MatchListReferenceOracle.AssertAgrees(MatchListReferenceOracle.Expected(squad), page);

        return true;
    }

    /// <summary>
    /// Bridges FsCheck's synchronous property model to the harness's asynchronous database work.
    /// Blocking is safe: xUnit test execution has no synchronization context, so
    /// <c>GetAwaiter().GetResult()</c> cannot deadlock and it surfaces the original exception unwrapped.
    /// </summary>
    private static bool RunAsync(Func<Task<bool>> body) =>
        body().GetAwaiter().GetResult();
}
