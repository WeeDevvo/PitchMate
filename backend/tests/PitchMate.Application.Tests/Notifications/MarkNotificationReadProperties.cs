using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Notifications;
using PitchMate.Domain.Notifications;
using DomainResult = PitchMate.Domain.Notifications.Result;

namespace PitchMate.Application.Tests.Notifications;

/// <summary>
/// Property-based tests for <see cref="MarkNotificationReadHandler"/> (notifications design Property 14).
/// They drive the real handler against the in-memory <see cref="FakeMarkReadNotificationRepository"/> over
/// a <see cref="MarkReadNotificationStore"/> (no database), per the Application-layer testing strategy.
/// Each property runs at least 100 generated cases.
/// </summary>
[Trait("Feature", "notifications")]
public class MarkNotificationReadProperties
{
    // Feature: notifications, Property 14: Marking read is monotonic, idempotent, and touches only the
    // target - for any population of the caller's own and other users' records in mixed read states,
    // marking one of the caller's own records read moves that record to Read (or leaves an already-Read
    // record Read), reports success, never reverts any record from Read to Unread (monotonic), leaves
    // every other record unchanged (touches only the target), and repeating the request yields the same
    // final Read state changing nothing further (idempotent).
    // Validates: Requirements 3.4, 3.5, 3.8, 9.5, 12.4
    [Property(MaxTest = 200)]
    [Trait("Property", "14")]
    public Property Property14_MarkingReadIsMonotonicIdempotentAndTouchesOnlyTheTarget() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var callerUserId = Guid.CreateVersion7();
            var otherUserId = Guid.CreateVersion7();
            Guid[] squads = [Guid.CreateVersion7(), Guid.CreateVersion7()];

            var store = new MarkReadNotificationStore();

            // Seed the caller's own records (at least one), plus other users' records, in mixed states.
            var callerRecords = new List<InAppNotification>();
            foreach (ReadState state in scenario.CallerStates)
            {
                callerRecords.Add(store.Seed(callerUserId, squads[scenario.NextSquad()], state));
            }

            foreach (ReadState state in scenario.OtherStates)
            {
                store.Seed(otherUserId, squads[scenario.NextSquad()], state);
            }

            InAppNotification target = callerRecords[scenario.TargetIndex % callerRecords.Count];

            // Snapshot every record's state and identity before the mark.
            Dictionary<Guid, ReadState> before = Snapshot(store);

            var repo = new FakeMarkReadNotificationRepository(store);
            var handler = new MarkNotificationReadHandler(repo, new FakeMarkReadUnitOfWork());
            DomainResult first = handler
                .HandleAsync(new MarkNotificationReadCommand(callerUserId, target.Id), CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            Dictionary<Guid, ReadState> afterFirst = Snapshot(store);

            bool firstSucceeded = first.IsSuccess;
            bool targetIsRead = target.ReadState == ReadState.Read;

            // Monotonic: no record moved from Read back to Unread.
            bool monotonic = store.Records.All(r =>
                !(before[r.Record.Id] == ReadState.Read && afterFirst[r.Record.Id] == ReadState.Unread));

            // Touches only the target: every record other than the target is unchanged.
            bool onlyTargetChanged = store.Records.All(r =>
                r.Record.Id == target.Id || afterFirst[r.Record.Id] == before[r.Record.Id]);

            // Idempotent: repeating the request keeps the target Read, succeeds, and changes nothing.
            DomainResult second = handler
                .HandleAsync(new MarkNotificationReadCommand(callerUserId, target.Id), CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            Dictionary<Guid, ReadState> afterSecond = Snapshot(store);

            bool idempotent = second.IsSuccess
                && target.ReadState == ReadState.Read
                && store.Records.All(r => afterSecond[r.Record.Id] == afterFirst[r.Record.Id]);

            return (firstSucceeded && targetIsRead && monotonic && onlyTargetChanged && idempotent)
                .ToProperty();
        });

    private static Dictionary<Guid, ReadState> Snapshot(MarkReadNotificationStore store) =>
        store.Records.ToDictionary(r => r.Record.Id, r => r.Record.ReadState);

    private static Gen<Scenario> ScenarioGen() =>
        from callerStates in ReadStateListGen(minCount: 1, maxCount: 6)
        from otherStates in ReadStateListGen(minCount: 0, maxCount: 5)
        from targetIndex in Gen.Choose(0, 5)
        from squadPicks in Gen.ListOf(Gen.Choose(0, 1), 20)
        select new Scenario(callerStates, otherStates, targetIndex, squadPicks.ToArray());

    private static Gen<ReadState[]> ReadStateListGen(int minCount, int maxCount) =>
        from count in Gen.Choose(minCount, maxCount)
        from states in Gen.ListOf(Gen.Elements(ReadState.Unread, ReadState.Read), count)
        select states.ToArray();

    public sealed class Scenario
    {
        private int _squadCursor;

        public Scenario(ReadState[] callerStates, ReadState[] otherStates, int targetIndex, int[] squadPicks)
        {
            CallerStates = callerStates;
            OtherStates = otherStates;
            TargetIndex = targetIndex;
            SquadPicks = squadPicks;
        }

        public ReadState[] CallerStates { get; }

        public ReadState[] OtherStates { get; }

        public int TargetIndex { get; }

        public int[] SquadPicks { get; }

        /// <summary>Deterministically walks the generated squad picks so each seeded record gets a squad.</summary>
        public int NextSquad() => SquadPicks[_squadCursor++ % SquadPicks.Length];
    }
}
