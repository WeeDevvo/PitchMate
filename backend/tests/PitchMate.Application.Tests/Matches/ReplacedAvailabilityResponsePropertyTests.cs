using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.Extensions.Time.Testing;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// Property-based test for the replacement case of the availability submission contract
/// (match-read-models design Property 20, Requirements 8.2 and 8.4).
/// <para>
/// Property 20: for any pair of successive submissions by the same membership against the same match,
/// the second response reports the second submission's instant and marked days, reports no instant or
/// marked day of the first, and reports the same marked days and submission instant the operation
/// reports today. The claim generalises the single example
/// <c>SubmitAvailabilityResponseHandlerTests.ReplacingSubmissionReportsOnlyTheReplacingSubmissionsValues</c>
/// over the dimensions that can break it: which subset of candidate days each submission marks —
/// including the empty subset on either side, and the second marking the same days as the first, a
/// superset, a subset, or a disjoint set — the interval between the two submission instants, and the
/// candidate-day count.
/// </para>
/// <para>
/// The oracle is computed independently of the handler: the expected submission instant is the fake
/// clock's reading at the second submission and the expected marked days are the second submission's
/// requested candidate days as the bare UTC instants the aggregate holds. Nothing is read back out of
/// the store to form the expectation, so the property cannot be satisfied by the projection simply
/// agreeing with itself.
/// </para>
/// <para>
/// Discrimination control: every iteration additionally re-runs the same check against two
/// <em>planted</em> projections built from the replaced submission's values — one carrying the replaced
/// instant, one carrying the replaced marked days — and requires the check to <em>reject</em> them,
/// so an assertion that had stopped discriminating replacing from replaced would fail rather than
/// pass. The day-set prong is applied whenever the two submissions' day sequences differ, and
/// <see cref="TheGeneratedCaseSpaceCoversEveryReplacementShape"/> pins that the generated case space
/// actually contains those shapes.
/// </para>
/// <para>
/// The real handler is driven against the shared in-memory fakes with no database, per the
/// Application-layer testing strategy. The gate is not re-tested here — Property 6 in
/// <see cref="AvailabilityAuthorisationPropertyTests"/> owns who may submit — so every iteration acts
/// as one active registered member of the match's own squad, leaving the replacement projection as
/// the only thing under test.
/// </para>
/// </summary>
[Trait("Feature", "match-read-models")]
public class ReplacedAvailabilityResponsePropertyTests
{
    /// <summary>
    /// How the second submission's marked-day set relates to the first's. The relation is generated
    /// rather than left to chance so the sharp edges — an identical set, an empty second set, and an
    /// empty first set — are reached at a useful rate instead of only by coincidence.
    /// </summary>
    public enum DayRelation
    {
        /// <summary>The second submission marks exactly the days the first marked.</summary>
        Identical,

        /// <summary>The second submission marks every day the first marked, and possibly more.</summary>
        SecondSuperset,

        /// <summary>The second submission marks only days the first marked, and possibly fewer.</summary>
        SecondSubset,

        /// <summary>The second submission marks no day the first marked.</summary>
        Disjoint,

        /// <summary>The second submission marks no day at all — the empty-not-absent edge.</summary>
        SecondEmpty,

        /// <summary>The first submission marked no day, so the replaced response is the empty subset.</summary>
        FirstEmpty,

        /// <summary>The two subsets are drawn independently, with no relation imposed.</summary>
        Unconstrained
    }

    /// <summary>
    /// A generated pair of successive submissions: the match's candidate-day count, the candidate-day
    /// indices each submission marks, the interval between the two submission instants, and the
    /// relation the second subset was shaped by.
    /// </summary>
    /// <param name="CandidateDayCount">How many candidate days the match was drafted with (1–6).</param>
    /// <param name="FirstDays">Candidate-day indices the first (replaced) submission marks.</param>
    /// <param name="SecondDays">Candidate-day indices the second (replacing) submission marks.</param>
    /// <param name="IntervalSeconds">Strictly positive gap between the two submission instants.</param>
    /// <param name="Relation">The relation the second subset was shaped by.</param>
    public sealed record SubmissionPair(
        int CandidateDayCount,
        IReadOnlyList<int> FirstDays,
        IReadOnlyList<int> SecondDays,
        int IntervalSeconds,
        DayRelation Relation);

    /// <summary>A fixed UTC anchor the fake clock starts at; every candidate day sits after it.</summary>
    private static readonly DateTimeOffset Now = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    // Feature: match-read-models, Property 20: A replaced availability response reports the replacing
    // submission - for any pair of successive submissions by the same membership against the same
    // match, the second response reports the second submission's instant and marked days, reports no
    // instant or marked day of the first, and reports the same marked days and submission instant the
    // operation reports today.
    // Validates: Requirements 8.2, 8.4
    [Property(MaxTest = 200)]
    [Trait("Property", "20")]
    public Property AReplacedResponseReportsOnlyTheReplacingSubmission() =>
        Prop.ForAll(Arb.From(SubmissionPairGen()), pair =>
        {
            World world = World.Create(pair.CandidateDayCount);

            Result<SubmitAvailabilityResult> first = world.Submit(pair.FirstDays);
            if (!first.IsSuccess)
            {
                // The fixture is always authorised, gathering availability, and marking candidate days,
                // so a failure here is a genuine defect rather than an uninteresting case.
                return false;
            }

            world.Clock.Advance(TimeSpan.FromSeconds(pair.IntervalSeconds));

            Result<SubmitAvailabilityResult> second = world.Submit(pair.SecondDays);
            if (!second.IsSuccess)
            {
                return false;
            }

            SubmitAvailabilityResult replaced = first.Value!;
            SubmitAvailabilityResult replacing = second.Value!;

            // The oracle, computed without consulting either response: the clock's reading at the
            // second submission, and the second submission's days as the bare UTC instants the
            // aggregate holds (Requirement 8.4).
            DateTimeOffset expectedInstant = Now.AddSeconds(pair.IntervalSeconds);
            IReadOnlyList<DateTimeOffset> expectedDays = world.Days(pair.SecondDays);

            // The days the replaced response marked and the replacing submission did not: none of
            // these may appear (Requirement 8.2).
            IReadOnlyCollection<DateTimeOffset> replacedOnlyDays =
            [
                .. world.Days(pair.FirstDays).Except(expectedDays)
            ];

            bool Reports(SubmitAvailabilityResult candidate) => ReportsTheReplacingSubmission(
                candidate, expectedInstant, expectedDays, replaced.SubmittedAt, replacedOnlyDays);

            // The planted projections carry the replaced submission's instant and its marked days in
            // turn; the check must reject each, so it is shown to discriminate rather than to accept
            // anything handed to it.
            bool rejectsPlantedInstant = !Reports(replacing with { SubmittedAt = replaced.SubmittedAt });
            bool rejectsPlantedDays = replaced.MarkedDays.SequenceEqual(expectedDays)
                || !Reports(replacing with { MarkedDays = replaced.MarkedDays });

            return Reports(replacing)
                && rejectsPlantedInstant
                && rejectsPlantedDays
                // The membership retains exactly one stored response — the replacing one.
                && world.Availability.StoredResponseCount == 1;
        });

    /// <summary>
    /// Non-vacuity control for the generated case space: shaping the second subset over every relation
    /// and every subset mask of a three-day match actually produces each replacement shape the property
    /// claims to range over — identical non-empty sets, a strict superset, a strict subset, disjoint
    /// non-empty sets, an empty second submission replacing a non-empty one, and a non-empty submission
    /// replacing an empty one. Without this, the day-set prong of the discrimination control could be
    /// vacuous because no iteration ever differed.
    /// </summary>
    [Fact]
    public void TheGeneratedCaseSpaceCoversEveryReplacementShape()
    {
        const int dayCount = 3;
        List<SubmissionPair> space =
        [
            .. from relation in Enum.GetValues<DayRelation>()
               from firstMask in Masks(dayCount)
               from secondMask in Masks(dayCount)
               select BuildPair(dayCount, relation, firstMask, secondMask, intervalSeconds: 60)
        ];

        Assert.Contains(space, p => p.FirstDays.Count > 0 && p.SecondDays.SequenceEqual(p.FirstDays));
        Assert.Contains(space, p => p.FirstDays.Count > 0 && p.SecondDays.Count > p.FirstDays.Count
            && p.FirstDays.All(p.SecondDays.Contains));
        Assert.Contains(space, p => p.SecondDays.Count > 0 && p.SecondDays.Count < p.FirstDays.Count
            && p.SecondDays.All(p.FirstDays.Contains));
        Assert.Contains(space, p => p.FirstDays.Count > 0 && p.SecondDays.Count > 0
            && !p.SecondDays.Intersect(p.FirstDays).Any());
        Assert.Contains(space, p => p.FirstDays.Count > 0 && p.SecondDays.Count == 0);
        Assert.Contains(space, p => p.FirstDays.Count == 0 && p.SecondDays.Count > 0);
    }

    /// <summary>
    /// The replacement claim itself: the candidate reports the replacing submission's instant and
    /// exactly its marked days as bare UTC instants, carries a present (possibly empty) day collection,
    /// and reports neither the replaced submission's instant nor any day only it marked
    /// (Requirements 8.2, 8.4).
    /// </summary>
    private static bool ReportsTheReplacingSubmission(
        SubmitAvailabilityResult candidate,
        DateTimeOffset expectedInstant,
        IReadOnlyList<DateTimeOffset> expectedDays,
        DateTimeOffset replacedInstant,
        IReadOnlyCollection<DateTimeOffset> replacedOnlyDays) =>
        candidate.SubmittedAt == expectedInstant
        && candidate.SubmittedAt != replacedInstant
        && candidate.MarkedDays is not null
        && candidate.MarkedDays.SequenceEqual(expectedDays)
        && candidate.MarkedDays.All(day => day.Offset == TimeSpan.Zero)
        && !candidate.MarkedDays.Any(replacedOnlyDays.Contains);

    /// <summary>
    /// Generates a pair of successive submissions: a 1–6 day match, an independently drawn subset for
    /// each submission, a relation that shapes the second subset against the first, and a strictly
    /// positive interval of up to a day between the two instants. The interval is never zero because
    /// the claim that the second response reports no instant of the first is only expressible when the
    /// two submissions are made at distinct instants.
    /// </summary>
    private static Gen<SubmissionPair> SubmissionPairGen() =>
        from dayCount in Gen.Choose(1, 6)
        from relation in Gen.Elements(Enum.GetValues<DayRelation>())
        from firstMask in Gen.ListOf(Gen.Elements(true, false), dayCount)
        from secondMask in Gen.ListOf(Gen.Elements(true, false), dayCount)
        from intervalSeconds in Gen.Choose(1, 86_400)
        select BuildPair(dayCount, relation, [.. firstMask], [.. secondMask], intervalSeconds);

    /// <summary>
    /// Shapes two generated subset masks into the requested <see cref="DayRelation"/>, as candidate-day
    /// index lists in ascending order.
    /// </summary>
    private static SubmissionPair BuildPair(
        int dayCount,
        DayRelation relation,
        IReadOnlyList<bool> firstMask,
        IReadOnlyList<bool> secondMask,
        int intervalSeconds)
    {
        int[] indices = [.. Enumerable.Range(0, dayCount)];
        int[] drawnFirst = [.. indices.Where(i => firstMask[i])];
        int[] drawnSecond = [.. indices.Where(i => secondMask[i])];

        int[] first = relation == DayRelation.FirstEmpty ? [] : drawnFirst;
        int[] second = relation switch
        {
            DayRelation.Identical => drawnFirst,
            DayRelation.SecondSuperset => [.. indices.Where(i => firstMask[i] || secondMask[i])],
            DayRelation.SecondSubset => [.. drawnFirst.Where(i => secondMask[i])],
            DayRelation.Disjoint => [.. drawnSecond.Where(i => !firstMask[i])],
            DayRelation.SecondEmpty => [],
            DayRelation.FirstEmpty => drawnSecond,
            DayRelation.Unconstrained => drawnSecond,
            _ => throw new ArgumentOutOfRangeException(nameof(relation), relation, "Unhandled relation."),
        };

        return new SubmissionPair(dayCount, first, second, intervalSeconds, relation);
    }

    /// <summary>Every subset mask of <paramref name="dayCount"/> days, for the coverage control.</summary>
    private static IEnumerable<bool[]> Masks(int dayCount)
    {
        for (int bits = 0; bits < 1 << dayCount; bits++)
        {
            yield return [.. Enumerable.Range(0, dayCount).Select(i => (bits & (1 << i)) != 0)];
        }
    }

    /// <summary>
    /// Assembles the real <see cref="SubmitAvailabilityResponseHandler"/> over the shared in-memory
    /// fakes, with a match gathering availability on a generated number of candidate days and a single
    /// active registered member of the match's own squad acting, so every submission is authorised and
    /// valid and the replacement projection is what the property observes.
    /// </summary>
    private sealed class World
    {
        private readonly Guid _actingUserId;
        private readonly Guid _squadId;
        private readonly Guid _matchId;

        private World(
            SubmitAvailabilityResponseHandler handler,
            RecordingAvailabilityRepository availability,
            FakeTimeProvider clock,
            Guid actingUserId,
            Guid squadId,
            Guid matchId,
            IReadOnlyList<DateTimeOffset> candidateDays)
        {
            Handler = handler;
            Availability = availability;
            Clock = clock;
            _actingUserId = actingUserId;
            _squadId = squadId;
            _matchId = matchId;
            CandidateDays = candidateDays;
        }

        public SubmitAvailabilityResponseHandler Handler { get; }

        public RecordingAvailabilityRepository Availability { get; }

        public FakeTimeProvider Clock { get; }

        /// <summary>The match's candidate days, already normalised to UTC by the aggregate.</summary>
        public IReadOnlyList<DateTimeOffset> CandidateDays { get; }

        public static World Create(int candidateDayCount)
        {
            var squadId = Guid.NewGuid();
            var actingUserId = Guid.NewGuid();

            DateTimeOffset[] candidateDays =
                [.. Enumerable.Range(1, candidateDayCount).Select(day => Now.AddDays(day))];

            Match match = Match.CreateDraft(
                Guid.CreateVersion7(), squadId, "Recreation Ground", candidateDays, Now).Value!;

            SquadMembership acting =
                SquadMembership.CreateRegistered(squadId, actingUserId, "Member").Value!;

            var availability = new RecordingAvailabilityRepository();
            var clock = new FakeTimeProvider(Now);
            var handler = new SubmitAvailabilityResponseHandler(
                new ConcealmentMatchRepository(match),
                new ConcealmentMembershipRepository(acting),
                availability,
                new CommittingUnitOfWork(availability),
                clock);

            return new World(
                handler,
                availability,
                clock,
                actingUserId,
                squadId,
                match.Id,
                [.. match.CandidateDays.Select(day => day.Instant)]);
        }

        /// <summary>Submits the given candidate-day indices as the acting member's availability.</summary>
        public Result<SubmitAvailabilityResult> Submit(IReadOnlyList<int> dayIndices) =>
            Handler
                .HandleAsync(
                    new SubmitAvailabilityResponseCommand(_actingUserId, _squadId, _matchId, Days(dayIndices)),
                    CancellationToken.None)
                .GetAwaiter()
                .GetResult();

        /// <summary>Resolves candidate-day indices to the UTC instants the aggregate holds.</summary>
        public IReadOnlyList<DateTimeOffset> Days(IReadOnlyList<int> dayIndices) =>
            [.. dayIndices.Select(index => CandidateDays[index])];
    }
}
