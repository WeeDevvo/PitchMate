using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.LiveTracking.UseCases;
using PitchMate.Domain.LiveTracking;
using MatchState = PitchMate.Domain.Matches.MatchState;

namespace PitchMate.Application.Tests.LiveTracking;

/// <summary>
/// Property-based test for <see cref="RecordEventBatchHandler"/> covering design Property 3 — batch
/// processing is independent and per-event classified. For a generated mixed batch containing valid
/// new events, an already-present event, an intra-batch duplicate, and an invalid event, the handler
/// classifies each event independently (<c>Applied</c>/<c>Duplicate</c>/<c>Rejected</c>), appends at
/// most one event per <c>Event_Id</c>, still appends every valid non-duplicate event, and rejects an
/// empty batch wholesale.
/// </summary>
[Trait("Feature", "live-tracking")]
public class BatchClassificationPropertyTests
{
    // Feature: live-tracking, Property 3: Batch processing is independent and per-event classified -
    // each event is processed independently and classified Applied, Duplicate, or Rejected: an event
    // whose id is already present (or repeated earlier in the same batch) is Duplicate while every
    // other event is still processed, at most one event is appended per Event_Id, and an invalid event
    // is Rejected with its reason while every valid, non-duplicate event in the same batch is still
    // appended; a batch containing zero events is rejected wholesale with a validation error and
    // appends nothing.
    // Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.6
    [Property(MaxTest = 200)]
    [Trait("Property", "3")]
    public Property BatchIsIndependentlyClassified() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            RecordEventBatchWorld world = RecordEventBatchWorld.Build(MatchState.InProgress);

            // An empty batch is a whole-request validation failure that appends nothing (Req 2.6).
            Result<BatchResult> empty = world.Record();
            if (empty.IsSuccess || empty.Error!.Code != LiveTrackingErrorCode.ValidationFailed || world.Events.TotalCount != 0)
            {
                return false;
            }

            // Pre-seed one already-present goal so a submission carrying its id must be a Duplicate.
            var present = new GoalScoredEvent(
                Guid.CreateVersion7(), world.Match.Id, world.SquadId,
                MatchMinute.Create(5).Value, world.TeamAId, null, ownGoal: false);
            world.Events.Seed(present);

            // Build the batch in a fixed order with a known expected classification per position:
            //   [ already-present (Duplicate) , valid_1..k (Applied) , invalid (Rejected) , intra-dup of valid_1 (Duplicate) ]
            var submissions = new List<EventSubmission>();
            var expected = new List<EventOutcome>();

            EventSubmission presentAgain = new(
                present.Id, EventKind.GoalScored, 5, ScoringTeamId: world.TeamAId);
            submissions.Add(presentAgain);
            expected.Add(EventOutcome.Duplicate);

            var validSubmissions = new List<EventSubmission>();
            foreach (int minute in scenario.ValidMinutes)
            {
                EventSubmission valid = world.ValidGoal(minute);
                validSubmissions.Add(valid);
                submissions.Add(valid);
                expected.Add(EventOutcome.Applied);
            }

            // An invalid event: a goal naming a team that is not one of the match's kickoff teams.
            EventSubmission invalid = new(
                Guid.CreateVersion7(), EventKind.GoalScored, 12, ScoringTeamId: Guid.NewGuid());
            submissions.Add(invalid);
            expected.Add(EventOutcome.Rejected);

            // An intra-batch duplicate: repeat the first valid event's id (a further occurrence).
            EventSubmission intraDup = validSubmissions[0] with { EventId = validSubmissions[0].EventId };
            submissions.Add(intraDup);
            expected.Add(EventOutcome.Duplicate);

            Result<BatchResult> result = world.Record(submissions.ToArray());
            if (!result.IsSuccess)
            {
                return false;
            }

            IReadOnlyList<RecordOutcome> outcomes = result.Value!.Outcomes;
            if (outcomes.Count != submissions.Count)
            {
                return false;
            }

            for (var i = 0; i < expected.Count; i++)
            {
                if (outcomes[i].Outcome != expected[i])
                {
                    return false;
                }
            }

            // The rejected event carries a reason; a duplicate/applied never does.
            if (outcomes.Any(o => (o.Outcome == EventOutcome.Rejected) != (o.Error is not null)))
            {
                return false;
            }

            // Only the valid, non-duplicate events were appended (one row each), on top of the seed.
            var appendedIds = world.Events.Stored(world.Match.Id).Select(e => e.Id).ToHashSet();
            bool everyValidAppended = validSubmissions.All(v => appendedIds.Contains(v.EventId));
            bool invalidNotAppended = !appendedIds.Contains(invalid.EventId);
            bool atMostOnePerId = world.Events.Stored(world.Match.Id).GroupBy(e => e.Id).All(g => g.Count() == 1);
            int expectedStored = validSubmissions.Count + 1; // + the pre-seeded event

            return everyValidAppended
                && invalidNotAppended
                && atMostOnePerId
                && world.Events.TotalCount == expectedStored;
        });

    /// <summary>A batch scenario: the count and minutes of the valid new events to include.</summary>
    private sealed record Scenario(IReadOnlyList<int> ValidMinutes);

    private static Gen<Scenario> ScenarioGen() =>
        from count in Gen.Choose(1, 5)
        from minutes in GenList(count, Gen.Choose(MatchMinute.MinValue, MatchMinute.MaxValue))
        select new Scenario(minutes);

    private static Gen<IReadOnlyList<T>> GenList<T>(int length, Gen<T> element)
    {
        if (length <= 0)
        {
            return Gen.Constant((IReadOnlyList<T>)new List<T>());
        }

        return from head in element
               from tail in GenList(length - 1, element)
               select (IReadOnlyList<T>)Prepend(head, tail);
    }

    private static List<T> Prepend<T>(T head, IReadOnlyList<T> tail)
    {
        var list = new List<T>(tail.Count + 1) { head };
        list.AddRange(tail);
        return list;
    }
}
