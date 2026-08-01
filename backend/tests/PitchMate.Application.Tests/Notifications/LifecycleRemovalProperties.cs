using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Notifications;
using PitchMate.Domain.Notifications;
using DomainResult = PitchMate.Domain.Notifications.Result;
using DomainErrorCode = PitchMate.Domain.Notifications.NotificationErrorCode;
using OwnedNotification = PitchMate.Application.Tests.Notifications.LifecycleRemovalStore.OwnedNotification;

namespace PitchMate.Application.Tests.Notifications;

/// <summary>
/// Property-based tests for the GDPR/lifecycle removal handlers —
/// <see cref="RemoveNotificationsForUserHandler"/>, <see cref="RemoveNotificationsForMembershipHandler"/>,
/// and <see cref="RemoveNotificationsForSquadHandler"/> — covering notifications design Properties 19 and
/// 20. They drive the real handlers against the in-memory <see cref="LifecycleRemovalNotificationRepository"/>
/// over a <see cref="LifecycleRemovalStore"/>, committing through the <see cref="LifecycleRemovalUnitOfWork"/>
/// (no database), per the Application-layer testing strategy. Each property runs at least 100 generated cases.
/// <para>
/// The population each scenario builds spreads records across several users and squads, with one
/// membership per (user, squad) pair, in mixed read states — so a user-scope removal must reach across
/// squads, a membership-scope removal must hit exactly one (user, squad) membership, and a squad-scope
/// removal must reach every user in the squad, all regardless of read state.
/// </para>
/// </summary>
[Trait("Feature", "notifications")]
public class LifecycleRemovalProperties
{
    // Removal modes: 0 = for erased user, 1 = for anonymised membership, 2 = for purged squad.
    private const int ForUser = 0;
    private const int ForMembership = 1;
    private const int ForSquad = 2;

    // Feature: notifications, Property 19: Lifecycle removal deletes exactly the targeted scope - for any
    // stored records, removing for an erased user deletes every record whose recipient membership is
    // backed by that user across all squads; removing for an anonymised membership deletes every record
    // for that membership; removing for a purged squad deletes every record owned by that squad - each
    // regardless of read state - and in every case leaves every record outside the targeted scope present
    // and unchanged.
    // Validates: Requirements 11.1, 11.2, 11.3
    [Property(MaxTest = 200)]
    [Trait("Property", "19")]
    public Property Property19_LifecycleRemovalDeletesExactlyTheTargetedScope() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            Population pop = BuildPopulation(scenario);
            Guid target = PickMatchingTarget(pop, scenario.Mode, scenario.TargetPick);

            // The scope the erasure/anonymisation/purge targets: exactly the records that match under the
            // chosen mode, regardless of their read state.
            HashSet<Guid> expectedRemoved = pop.Records
                .Where(r => MatchesScope(r, scenario.Mode, target))
                .Select(r => r.Record.Id)
                .ToHashSet();
            HashSet<Guid> expectedRemaining = pop.Records
                .Select(r => r.Record.Id)
                .Where(id => !expectedRemoved.Contains(id))
                .ToHashSet();

            var repo = new LifecycleRemovalNotificationRepository(pop.Store);
            var unitOfWork = new LifecycleRemovalUnitOfWork(pop.Store);
            DomainResult result = RunRemoval(scenario.Mode, repo, unitOfWork, target, CancellationToken.None);

            HashSet<Guid> surviving = pop.Store.Records.Select(r => r.Record.Id).ToHashSet();

            bool succeeded = result.IsSuccess;
            // Exactly the targeted scope was deleted, and every out-of-scope record survives unchanged.
            bool remainingIsExactlyOutOfScope = surviving.SetEquals(expectedRemaining);
            bool noTargetedRecordSurvives = !surviving.Overlaps(expectedRemoved);

            return (succeeded && remainingIsExactlyOutOfScope && noTargetedRecordSurvives).ToProperty();
        });

    // Feature: notifications, Property 20: Lifecycle removal is atomic and succeeds on an empty scope -
    // for any removal, if the removal cannot complete, no record within the targeted scope is removed and
    // an error (RemovalFailed) is returned; and for any removal whose scope contains no matching records,
    // the removal reports success without error.
    // Validates: Requirements 11.7, 11.8
    [Property(MaxTest = 200)]
    [Trait("Property", "20")]
    public Property Property20_LifecycleRemovalIsAtomicAndSucceedsOnAnEmptyScope() =>
        Prop.ForAll(Arb.From(AtomicityScenarioGen()), scenario =>
        {
            // --- Atomicity: a removal that cannot complete removes nothing and reports RemovalFailed. ---
            Population atomicPop = BuildPopulation(scenario.Population);
            Guid matchedTarget = PickMatchingTarget(atomicPop, scenario.Population.Mode, scenario.Population.TargetPick);
            HashSet<Guid> allIdsBefore = atomicPop.Records.Select(r => r.Record.Id).ToHashSet();

            var failingRepo = new LifecycleRemovalNotificationRepository(atomicPop.Store);
            DomainResult atomicResult;
            switch (scenario.FailureKind)
            {
                case FailureKind.StagingThrows:
                    failingRepo.RemoveThrows = new InvalidOperationException("Simulated staging failure.");
                    atomicResult = RunRemoval(
                        scenario.Population.Mode,
                        failingRepo,
                        new LifecycleRemovalUnitOfWork(atomicPop.Store),
                        matchedTarget,
                        CancellationToken.None);
                    break;

                case FailureKind.CancelBeforeCommit:
                    using (var cts = new CancellationTokenSource())
                    {
                        atomicResult = RunRemoval(
                            scenario.Population.Mode,
                            failingRepo,
                            new LifecycleRemovalUnitOfWork(atomicPop.Store, cancelOnSave: cts),
                            matchedTarget,
                            cts.Token);
                    }

                    break;

                default: // FailureKind.CommitThrows
                    atomicResult = RunRemoval(
                        scenario.Population.Mode,
                        failingRepo,
                        new LifecycleRemovalUnitOfWork(atomicPop.Store, throwOnSave: true),
                        matchedTarget,
                        CancellationToken.None);
                    break;
            }

            HashSet<Guid> survivingAfterFailure = atomicPop.Store.Records.Select(r => r.Record.Id).ToHashSet();
            bool reportsRemovalFailed =
                !atomicResult.IsSuccess && atomicResult.Error?.Code == DomainErrorCode.RemovalFailed;
            bool nothingRemoved = survivingAfterFailure.SetEquals(allIdsBefore);

            // --- Empty scope: a removal whose scope matches nothing succeeds and removes nothing. ---
            Population emptyPop = BuildPopulation(scenario.Population);
            HashSet<Guid> emptyBefore = emptyPop.Records.Select(r => r.Record.Id).ToHashSet();
            // A freshly minted id belongs to no seeded user, membership, or squad, so every mode's scope is empty.
            Guid unmatchedTarget = Guid.CreateVersion7();

            DomainResult emptyResult = RunRemoval(
                scenario.Population.Mode,
                new LifecycleRemovalNotificationRepository(emptyPop.Store),
                new LifecycleRemovalUnitOfWork(emptyPop.Store),
                unmatchedTarget,
                CancellationToken.None);

            HashSet<Guid> survivingAfterEmpty = emptyPop.Store.Records.Select(r => r.Record.Id).ToHashSet();
            bool emptyScopeSucceeds = emptyResult.IsSuccess;
            bool emptyScopeRemovedNothing = survivingAfterEmpty.SetEquals(emptyBefore);

            return (reportsRemovalFailed
                && nothingRemoved
                && emptyScopeSucceeds
                && emptyScopeRemovedNothing).ToProperty();
        });

    // --- Removal dispatch -------------------------------------------------------------------------

    private static DomainResult RunRemoval(
        int mode, INotificationRepository repo, IUnitOfWork unitOfWork, Guid target, CancellationToken ct) =>
        mode switch
        {
            ForUser => new RemoveNotificationsForUserHandler(repo, unitOfWork)
                .HandleAsync(target, ct).GetAwaiter().GetResult(),
            ForMembership => new RemoveNotificationsForMembershipHandler(repo, unitOfWork)
                .HandleAsync(target, ct).GetAwaiter().GetResult(),
            _ => new RemoveNotificationsForSquadHandler(repo, unitOfWork)
                .HandleAsync(target, ct).GetAwaiter().GetResult(),
        };

    private static bool MatchesScope(OwnedNotification record, int mode, Guid target) => mode switch
    {
        ForUser => record.OwnerUserId == target,
        ForMembership => record.Record.RecipientMembershipId == target,
        _ => record.Record.SquadId == target,
    };

    // --- Generators -------------------------------------------------------------------------------

    private static Gen<Scenario> ScenarioGen() =>
        from seed in Gen.Choose(1, 1_000_000)
        from users in Gen.Choose(1, 4)
        from squads in Gen.Choose(1, 4)
        from records in Gen.Choose(0, 40)
        from mode in Gen.Choose(0, 2)
        from targetPick in Gen.Choose(0, 100)
        select new Scenario(seed, users, squads, records, mode, targetPick);

    private static Gen<AtomicityScenario> AtomicityScenarioGen() =>
        from population in ScenarioGen()
        from failureKind in Gen.Elements(
            FailureKind.StagingThrows, FailureKind.CommitThrows, FailureKind.CancelBeforeCommit)
        // The atomicity half needs a non-empty scope to prove "nothing is removed", so ensure at least one record.
        select new AtomicityScenario(population with { RecordCount = Math.Max(1, population.RecordCount) }, failureKind);

    // --- Population -------------------------------------------------------------------------------

    private static Population BuildPopulation(Scenario scenario)
    {
        var rng = new Random(scenario.Seed);
        var store = new LifecycleRemovalStore();

        List<Guid> userIds = Enumerable.Range(0, scenario.UserCount).Select(_ => Guid.CreateVersion7()).ToList();
        List<Guid> squadIds = Enumerable.Range(0, scenario.SquadCount).Select(_ => Guid.CreateVersion7()).ToList();

        // One membership per (user, squad) pair, minted lazily, so a user's records span squads and a
        // membership is exactly one (user, squad) pairing.
        var membershipsByPair = new Dictionary<(Guid User, Guid Squad), Guid>();
        Guid MembershipFor(Guid user, Guid squad)
        {
            if (!membershipsByPair.TryGetValue((user, squad), out Guid membershipId))
            {
                membershipId = Guid.CreateVersion7();
                membershipsByPair[(user, squad)] = membershipId;
            }

            return membershipId;
        }

        var records = new List<OwnedNotification>();
        for (int i = 0; i < scenario.RecordCount; i++)
        {
            Guid user = userIds[rng.Next(userIds.Count)];
            Guid squad = squadIds[rng.Next(squadIds.Count)];
            Guid membershipId = MembershipFor(user, squad);
            var state = (ReadState)rng.Next(2);

            InAppNotification record = store.Seed(user, squad, membershipId, state);
            records.Add(new OwnedNotification(user, record));
        }

        return new Population(store, userIds, squadIds, membershipsByPair.Values.ToList(), records);
    }

    // Picks a target that actually matches at least one seeded record when possible, so Property 19 always
    // exercises a real deletion; falls back to any pool member (an empty scope) when no records were seeded.
    private static Guid PickMatchingTarget(Population pop, int mode, int targetPick)
    {
        List<Guid> pool = mode switch
        {
            ForUser => pop.Records.Select(r => r.OwnerUserId).Distinct().DefaultIfEmpty(pop.UserIds[0]).ToList(),
            ForMembership => pop.Records.Select(r => r.Record.RecipientMembershipId).Distinct()
                .DefaultIfEmpty(pop.MembershipIds.Count > 0 ? pop.MembershipIds[0] : Guid.CreateVersion7()).ToList(),
            _ => pop.Records.Select(r => r.Record.SquadId).Distinct().DefaultIfEmpty(pop.SquadIds[0]).ToList(),
        };

        return pool[targetPick % pool.Count];
    }

    // --- Records ----------------------------------------------------------------------------------

    public sealed record Scenario(
        int Seed, int UserCount, int SquadCount, int RecordCount, int Mode, int TargetPick);

    public enum FailureKind
    {
        StagingThrows,
        CommitThrows,
        CancelBeforeCommit,
    }

    public sealed record AtomicityScenario(Scenario Population, FailureKind FailureKind);

    private sealed record Population(
        LifecycleRemovalStore Store,
        IReadOnlyList<Guid> UserIds,
        IReadOnlyList<Guid> SquadIds,
        IReadOnlyList<Guid> MembershipIds,
        IReadOnlyList<OwnedNotification> Records);
}
