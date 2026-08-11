using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.LiveTracking.UseCases;
using PitchMate.Domain.LiveTracking;
using MatchState = PitchMate.Domain.Matches.MatchState;

namespace PitchMate.Application.Tests.LiveTracking;

/// <summary>
/// Property-based test for <see cref="RecordEventBatchHandler"/> covering design Property 1 — the
/// append-only, idempotent recording guarantee keyed on <c>Event_Id</c>. It drives the real handler
/// against the in-memory <see cref="RecordEventBatchWorld"/> (no database), recording a generated set
/// of valid goal events, then re-recording the whole batch and each event again, and asserts the
/// stored log equals the distinct-by-<c>Event_Id</c> set appended exactly once and never mutates or
/// shrinks under repeated recording.
/// </summary>
[Trait("Feature", "live-tracking")]
public class IdempotentAppendPropertyTests
{
    // Feature: live-tracking, Property 1: Idempotent, append-only recording keyed on Event_Id - an
    // event whose Event_Id is not yet present is appended exactly once and reported Applied; every
    // recording of an already-present Event_Id appends nothing, mutates and deletes nothing, and is
    // reported Duplicate; recording the same event two or more times leaves the log identical to its
    // state after the first Applied recording.
    // Validates: Requirements 1.1, 1.2, 1.3, 1.5, 2.5
    [Property(MaxTest = 200)]
    [Trait("Property", "1")]
    public Property IdempotentAppendOnlyRecording() =>
        Prop.ForAll(Arb.From(GoalSpecsGen()), specs =>
        {
            RecordEventBatchWorld world = RecordEventBatchWorld.Build(MatchState.InProgress);

            EventSubmission[] batch = specs
                .Select(spec => world.ValidGoal(
                    spec.Minute,
                    spec.ScorerSlot is int slot ? world.TeamARoster[slot] : null,
                    spec.OwnGoal))
                .ToArray();

            // First recording: every distinct event is appended exactly once and reported Applied.
            Result<BatchResult> first = world.Record(batch);
            if (!first.IsSuccess || first.Value!.Outcomes.Any(o => o.Outcome != EventOutcome.Applied))
            {
                return false;
            }

            var expectedIds = batch.Select(e => e.EventId).OrderBy(id => id).ToList();
            var storedAfterFirst = world.Events.Stored(world.Match.Id).Select(e => e.Id).OrderBy(id => id).ToList();
            if (!storedAfterFirst.SequenceEqual(expectedIds))
            {
                return false;
            }

            // Every appended event is match- and squad-associated (never applied to a different match).
            if (world.Events.Stored(world.Match.Id).Any(e => e.MatchId != world.Match.Id || e.SquadId != world.SquadId))
            {
                return false;
            }

            // Re-recording the entire batch: every event is a Duplicate and the log is unchanged.
            Result<BatchResult> second = world.Record(batch);
            if (!second.IsSuccess || second.Value!.Outcomes.Any(o => o.Outcome != EventOutcome.Duplicate))
            {
                return false;
            }

            // Re-recording each event individually: still a Duplicate, still nothing appended.
            foreach (EventSubmission single in batch)
            {
                Result<BatchResult> repeat = world.Record(single);
                if (!repeat.IsSuccess
                    || repeat.Value!.Outcomes.Count != 1
                    || repeat.Value!.Outcomes[0].Outcome != EventOutcome.Duplicate)
                {
                    return false;
                }
            }

            // The stored log is byte-for-byte the same set of ids as after the first Applied recording.
            var storedFinal = world.Events.Stored(world.Match.Id).Select(e => e.Id).OrderBy(id => id).ToList();
            return storedFinal.SequenceEqual(expectedIds)
                && world.Events.TotalCount == expectedIds.Count;
        });

    /// <summary>A goal descriptor materialised into a valid submission once the world's roster is known.</summary>
    private sealed record GoalSpec(int Minute, int? ScorerSlot, bool OwnGoal);

    /// <summary>Generates 1..8 valid goal descriptors: an in-range minute, an optional scorer slot on team A, and an own-goal flag.</summary>
    private static Gen<IReadOnlyList<GoalSpec>> GoalSpecsGen() =>
        from count in Gen.Choose(1, 8)
        from specs in GenList(count, GoalSpecGen())
        select specs;

    private static Gen<GoalSpec> GoalSpecGen() =>
        from minute in Gen.Choose(MatchMinute.MinValue, MatchMinute.MaxValue)
        from slot in Gen.Choose(-1, 4)
        from ownGoal in Gen.Elements(false, true)
        select new GoalSpec(minute, slot < 0 ? null : slot, ownGoal);

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
