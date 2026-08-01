using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Notifications;
using PitchMate.Domain.Notifications;

namespace PitchMate.Application.Tests.Notifications;

/// <summary>
/// Property-based tests for <see cref="MarkAllNotificationsReadHandler"/> (notifications design
/// Property 15). They drive the real handler against the in-memory
/// <see cref="FakeMarkReadNotificationRepository"/> over a <see cref="MarkReadNotificationStore"/> (no
/// database), per the Application-layer testing strategy. Each property runs at least 100 generated cases.
/// </summary>
[Trait("Feature", "notifications")]
public class MarkAllNotificationsReadProperties
{
    // Feature: notifications, Property 15: Mark-all-read flips exactly the caller's unread records in
    // scope and reports the count - for any population of the caller's own and other users' records across
    // several squads in mixed read states, a mark-all request (optionally squad-scoped) flips exactly the
    // caller's own Unread records within scope to Read, leaves already-Read records, out-of-scope records,
    // and every other user's records unchanged, and returns the exact number of records flipped (0 when
    // none).
    // Validates: Requirements 9.6, 9.7
    [Property(MaxTest = 200)]
    [Trait("Property", "15")]
    public Property Property15_MarkAllFlipsExactlyTheCallersUnreadRecordsInScopeAndReportsTheCount() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var callerUserId = Guid.CreateVersion7();
            var otherUserId = Guid.CreateVersion7();
            Guid[] squads = [Guid.CreateVersion7(), Guid.CreateVersion7(), Guid.CreateVersion7()];

            var store = new MarkReadNotificationStore();

            var callerRecords = new List<InAppNotification>();
            foreach ((ReadState state, int squadIndex) in scenario.CallerRecords)
            {
                callerRecords.Add(store.Seed(callerUserId, squads[squadIndex], state));
            }

            foreach ((ReadState state, int squadIndex) in scenario.OtherRecords)
            {
                store.Seed(otherUserId, squads[squadIndex], state);
            }

            // The caller must hold a membership in the scoped squad for the scope check to pass; Seed
            // already grants one for every squad it touches, but grant explicitly so an empty caller
            // population in the scoped squad still resolves the scope rather than a non-disclosing not-found.
            Guid? scope = scenario.ScopeSquadIndex is { } idx ? squads[idx] : null;
            if (scope is { } scopedSquad)
            {
                store.GrantMembership(callerUserId, scopedSquad);
            }

            // The expected flip set: the caller's own Unread records within the requested scope.
            var expectedFlipped = store.Records
                .Where(r => r.OwnerUserId == callerUserId
                    && r.Record.ReadState == ReadState.Unread
                    && (scope is null || r.Record.SquadId == scope))
                .Select(r => r.Record.Id)
                .ToHashSet();

            Dictionary<Guid, ReadState> before = Snapshot(store);

            var repo = new FakeMarkReadNotificationRepository(store);
            var handler = new MarkAllNotificationsReadHandler(repo, new FakeMarkReadUnitOfWork());
            Result<int> result = handler
                .HandleAsync(new MarkAllNotificationsReadCommand(callerUserId, scope), CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            bool succeeded = result.IsSuccess;
            bool countMatches = result.Value == expectedFlipped.Count;

            // Every expected record is now Read; every other record is unchanged.
            bool exactlyExpectedFlipped = store.Records.All(r =>
                expectedFlipped.Contains(r.Record.Id)
                    ? r.Record.ReadState == ReadState.Read
                    : r.Record.ReadState == before[r.Record.Id]);

            // Monotonic: no record was reverted from Read to Unread.
            bool monotonic = store.Records.All(r =>
                !(before[r.Record.Id] == ReadState.Read && r.Record.ReadState == ReadState.Unread));

            return (succeeded && countMatches && exactlyExpectedFlipped && monotonic).ToProperty();
        });

    private static Dictionary<Guid, ReadState> Snapshot(MarkReadNotificationStore store) =>
        store.Records.ToDictionary(r => r.Record.Id, r => r.Record.ReadState);

    private static Gen<Scenario> ScenarioGen() =>
        from callerRecords in RecordSpecListGen(minCount: 0, maxCount: 8, squadCount: 3)
        from otherRecords in RecordSpecListGen(minCount: 0, maxCount: 6, squadCount: 3)
        from scopeSquadIndex in Gen.Elements(new int?[] { null, 0, 1, 2 })
        select new Scenario(callerRecords, otherRecords, scopeSquadIndex);

    private static Gen<(ReadState State, int SquadIndex)[]> RecordSpecListGen(int minCount, int maxCount, int squadCount) =>
        from count in Gen.Choose(minCount, maxCount)
        from specs in Gen.ListOf(
            from state in Gen.Elements(ReadState.Unread, ReadState.Read)
            from squadIndex in Gen.Choose(0, squadCount - 1)
            select (state, squadIndex),
            count)
        select specs.ToArray();

    public sealed record Scenario(
        (ReadState State, int SquadIndex)[] CallerRecords,
        (ReadState State, int SquadIndex)[] OtherRecords,
        int? ScopeSquadIndex);
}
