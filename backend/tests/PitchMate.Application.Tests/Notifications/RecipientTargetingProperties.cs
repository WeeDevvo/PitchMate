using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.Extensions.Logging.Abstractions;
using PitchMate.Application.Notifications;
using PitchMate.Domain.Notifications;
using PitchMate.Domain.Squads;
using Factory = PitchMate.Application.Tests.Notifications.NotificationMembershipFactory;
using DomainResult = PitchMate.Domain.Notifications.Result;
using DomainErrorCode = PitchMate.Domain.Notifications.NotificationErrorCode;

namespace PitchMate.Application.Tests.Notifications;

/// <summary>
/// Property-based tests for recipient targeting in <see cref="PublishNotificationHandler"/> (notifications
/// design Properties 2–7). They drive the real handler against the in-memory
/// <see cref="FakeNotificationRepository"/> over a <see cref="NotificationStore"/> (no database), per the
/// Application-layer testing strategy. Each property runs at least 100 generated cases.
/// <para>
/// Task 4.1's handler resolves recipients but does not yet persist them (fan-out lands in task 4.3), so
/// these properties assert recipient-resolution behaviour by observing which targeting query the handler
/// drove and the recipient set it resolved (the memberships that would be persisted), captured by the
/// faithful repository fake. The fake's resolution mirrors the documented
/// <see cref="INotificationRepository"/> contract and the future EF implementation.
/// </para>
/// </summary>
[Trait("Feature", "notifications")]
public class RecipientTargetingProperties
{
    private static readonly NotificationType[] BroadcastTypes =
    [
        NotificationType.MatchDrafted,
        NotificationType.MatchConfirmed,
        NotificationType.TeamsRolled,
        NotificationType.ResultPosted,
    ];

    private static readonly NotificationType[] DirectedTypes =
    [
        NotificationType.MemberJoined,
        NotificationType.PromotedToAdmin,
        NotificationType.RemovedFromSquad,
        NotificationType.OwnershipTransferred,
    ];

    private static readonly NotificationType[] AllTypes = Enum.GetValues<NotificationType>();

    // Feature: notifications, Property 2: Recipients are always registered memberships of the owning
    // squad - for any publish over a squad containing a mix of guest and registered, active and inactive
    // memberships (and memberships of other squads), every resolved recipient is a registered
    // (user-backed) membership belonging to the owning squad; no guest membership and no membership of
    // another squad is ever a recipient.
    // Validates: Requirements 4.1, 4.5, 4.7
    [Property(MaxTest = 200)]
    [Trait("Property", "2")]
    public Property Property2_RecipientsAreRegisteredMembershipsOfOwningSquad() =>
        Prop.ForAll(Arb.From(AnyTypeScenarioGen()), scenario =>
        {
            var squadId = Guid.CreateVersion7();
            Population population = BuildPopulation(
                squadId, scenario.Active, scenario.Inactive, scenario.Guests, scenario.Other);
            (FakeNotificationRepository repo, _, PublishNotificationHandler handler) = Build(population);

            // Directed types are handed every seeded id (across kinds and squads) so the guest,
            // wrong-squad, and non-recipient ids all have to be filtered out; broadcast types take none.
            IReadOnlyCollection<Guid> directedIds = DirectedTypes.Contains(scenario.Type)
                ? population.AllIds()
                : [];

            DomainResult result = Publish(handler, scenario.Type, squadId, directedIds);

            bool everyRecipientRegisteredInOwningSquad = repo.LastResolvedRecipients.All(m =>
                !m.IsGuest && m.SquadId == squadId);

            return (result.IsSuccess && everyRecipientRegisteredInOwningSquad).ToProperty();
        });

    // Feature: notifications, Property 3: Broadcast targeting resolves to the active registered
    // memberships - for any squad and any broadcast (match-lifecycle) notification type, the handler
    // drives the broadcast query and the resolved recipients equal exactly the set of the owning squad's
    // registered memberships whose state is Active at the publish instant.
    // Validates: Requirements 4.2
    [Property(MaxTest = 200)]
    [Trait("Property", "3")]
    public Property Property3_BroadcastResolvesActiveRegistered() =>
        Prop.ForAll(Arb.From(BroadcastScenarioGen()), scenario =>
        {
            var squadId = Guid.CreateVersion7();
            Population population = BuildPopulation(
                squadId, scenario.Active, scenario.Inactive, scenario.Guests, scenario.Other);
            (FakeNotificationRepository repo, _, PublishNotificationHandler handler) = Build(population);

            DomainResult result = Publish(handler, scenario.Type, squadId, []);

            // The broadcast query ran (and only it); the directed query never did.
            bool droveBroadcastOnly =
                repo.ListActiveRegisteredCallCount == 1 && repo.ResolveRegisteredCallCount == 0;

            HashSet<Guid> expected = population.RegisteredActive.Select(m => m.Id).ToHashSet();
            HashSet<Guid> resolved = repo.LastResolvedRecipients.Select(m => m.Id).ToHashSet();

            return (result.IsSuccess && droveBroadcastOnly && resolved.SetEquals(expected)).ToProperty();
        });

    // Feature: notifications, Property 4: Directed targeting resolves to the named affected registered
    // memberships - for any directed (squad-event) notification type and any set of supplied affected
    // membership ids, the handler drives the directed query and the resolved recipients equal exactly
    // those supplied ids that are registered memberships of the owning squad, including a membership that
    // became Inactive as a result of the very event being notified (e.g. RemovedFromSquad).
    // Validates: Requirements 4.3, 4.4, 8.1, 8.2, 8.3, 8.4
    [Property(MaxTest = 200)]
    [Trait("Property", "4")]
    public Property Property4_DirectedResolvesNamedRegistered() =>
        Prop.ForAll(Arb.From(DirectedScenarioGen()), scenario =>
        {
            var squadId = Guid.CreateVersion7();
            Population population = BuildPopulation(
                squadId, scenario.Active, scenario.Inactive, scenario.Guests, scenario.Other);
            (FakeNotificationRepository repo, _, PublishNotificationHandler handler) = Build(population);

            // Name a subset of the registered members (active and — always at least one — inactive), plus
            // every guest and other-squad id and a non-existent id, none of which may resolve.
            List<SquadMembership> namedActive = population.RegisteredActive.Take(scenario.TakeActive).ToList();
            List<SquadMembership> namedInactive = population.RegisteredInactive.Take(scenario.TakeInactive).ToList();

            var directedIds = new List<Guid>();
            directedIds.AddRange(namedActive.Select(m => m.Id));
            directedIds.AddRange(namedInactive.Select(m => m.Id));
            directedIds.AddRange(population.Guests.Select(m => m.Id));
            directedIds.AddRange(population.OtherSquad.Select(m => m.Id));
            directedIds.Add(Guid.CreateVersion7()); // a non-existent id must be dropped

            DomainResult result = Publish(handler, scenario.Type, squadId, directedIds);

            bool droveDirectedOnly =
                repo.ResolveRegisteredCallCount == 1 && repo.ListActiveRegisteredCallCount == 0;

            HashSet<Guid> expected = namedActive.Concat(namedInactive).Select(m => m.Id).ToHashSet();
            HashSet<Guid> resolved = repo.LastResolvedRecipients.Select(m => m.Id).ToHashSet();

            // A named inactive registered membership is a legitimate recipient (Requirement 4.4).
            bool inactiveTargetsResolved = namedInactive.All(m => resolved.Contains(m.Id));
            bool inactiveRecipientsAreInactive = repo.LastResolvedRecipients
                .Where(m => namedInactive.Any(i => i.Id == m.Id))
                .All(m => m.State == MembershipState.Inactive);

            return (result.IsSuccess
                && droveDirectedOnly
                && resolved.SetEquals(expected)
                && inactiveTargetsResolved
                && inactiveRecipientsAreInactive).ToProperty();
        });

    // Feature: notifications, Property 5: Recipients are de-duplicated - for any directed targeting input
    // that names the same registered membership more than once, the resolved recipient set contains that
    // membership exactly once (so the fan-out would persist one record and attempt at most one email).
    // Validates: Requirements 4.8
    [Property(MaxTest = 200)]
    [Trait("Property", "5")]
    public Property Property5_RecipientsAreDeDuplicated() =>
        Prop.ForAll(Arb.From(DedupScenarioGen()), scenario =>
        {
            var squadId = Guid.CreateVersion7();
            Population population = BuildPopulation(
                squadId, scenario.Active, scenario.Inactive, guests: 1, other: 1);
            (FakeNotificationRepository repo, _, PublishNotificationHandler handler) = Build(population);

            List<SquadMembership> registered = population.RegisteredActive
                .Concat(population.RegisteredInactive)
                .ToList();

            // Repeat every registered id (and a guest/other id) DuplicationFactor times.
            var directedIds = new List<Guid>();
            for (int repeat = 0; repeat < scenario.DuplicationFactor; repeat++)
            {
                directedIds.AddRange(registered.Select(m => m.Id));
                directedIds.AddRange(population.Guests.Select(m => m.Id));
                directedIds.AddRange(population.OtherSquad.Select(m => m.Id));
            }

            DomainResult result = Publish(handler, scenario.Type, squadId, directedIds);

            List<Guid> resolvedIds = repo.LastResolvedRecipients.Select(m => m.Id).ToList();
            bool distinct = resolvedIds.Count == resolvedIds.Distinct().Count();
            bool exactlyTheRegistered = resolvedIds.ToHashSet().SetEquals(registered.Select(m => m.Id));

            return (result.IsSuccess && distinct && exactlyTheRegistered).ToProperty();
        });

    // Feature: notifications, Property 6: An empty recipient set is a no-op success - for any publish
    // whose targeting resolves to no valid recipients, the publish reports success and persists no in-app
    // record (and would attempt no email).
    // Validates: Requirements 4.6
    [Property(MaxTest = 200)]
    [Trait("Property", "6")]
    public Property Property6_EmptyRecipientSetIsNoOpSuccess() =>
        Prop.ForAll(Arb.From(EmptyScenarioGen()), scenario =>
        {
            var squadId = Guid.CreateVersion7();
            IReadOnlyCollection<Guid> directedIds;
            NotificationType type;
            Population population;

            if (scenario.UseBroadcast)
            {
                // Broadcast over a squad with no ACTIVE registered members resolves to nothing.
                type = BroadcastTypes[scenario.TypeIndex % BroadcastTypes.Length];
                population = BuildPopulation(squadId, active: 0, scenario.Inactive, scenario.Guests, scenario.Other);
                directedIds = [];
            }
            else
            {
                // Directed at only guests, other-squad, and non-existent ids resolves to nothing, even
                // though the owning squad has active registered members (directed never broadcasts).
                type = DirectedTypes[scenario.TypeIndex % DirectedTypes.Length];
                population = BuildPopulation(squadId, scenario.Active, scenario.Inactive, guests: scenario.Guests + 1, scenario.Other);
                var ids = new List<Guid>();
                ids.AddRange(population.Guests.Select(m => m.Id));
                ids.AddRange(population.OtherSquad.Select(m => m.Id));
                ids.Add(Guid.CreateVersion7());
                directedIds = ids;
            }

            (FakeNotificationRepository repo, NotificationStore store, PublishNotificationHandler handler) = Build(population);

            DomainResult result = Publish(handler, type, squadId, directedIds);

            return (result.IsSuccess
                && repo.LastResolvedRecipients.Count == 0
                && store.Added.Count == 0).ToProperty();
        });

    // Feature: notifications, Property 7: An unrecognised notification type is rejected with no side
    // effects - for any publish request carrying a value that is not one of the eight defined
    // NotificationType members, the publish reports a validation failure (UnknownNotificationType) before
    // resolving any recipient, and persists no record (and would attempt no email).
    // Validates: Requirements 2.5
    [Property(MaxTest = 200)]
    [Trait("Property", "7")]
    public Property Property7_UnknownTypeRejectedWithNoSideEffects() =>
        Prop.ForAll(Arb.From(UnknownTypeGen()), unknownType =>
        {
            var squadId = Guid.CreateVersion7();
            Population population = BuildPopulation(squadId, active: 3, inactive: 1, guests: 1, other: 1);
            (FakeNotificationRepository repo, NotificationStore store, PublishNotificationHandler handler) = Build(population);

            // Directed ids are supplied too, to prove the rejection happens before any resolution.
            DomainResult result = Publish(handler, unknownType, squadId, population.AllIds());

            return (!result.IsSuccess
                && result.Error?.Code == DomainErrorCode.UnknownNotificationType
                && !repo.AnyResolutionInvoked
                && store.Added.Count == 0).ToProperty();
        });

    // --- Generators -------------------------------------------------------------------------------

    private static Gen<AnyTypeScenario> AnyTypeScenarioGen() =>
        from type in Gen.Elements(AllTypes)
        from active in Gen.Choose(0, 6)
        from inactive in Gen.Choose(0, 4)
        from guests in Gen.Choose(0, 4)
        from other in Gen.Choose(0, 3)
        select new AnyTypeScenario(type, active, inactive, guests, other);

    private static Gen<BroadcastScenario> BroadcastScenarioGen() =>
        from type in Gen.Elements(BroadcastTypes)
        from active in Gen.Choose(0, 6)
        from inactive in Gen.Choose(0, 4)
        from guests in Gen.Choose(0, 4)
        from other in Gen.Choose(0, 3)
        select new BroadcastScenario(type, active, inactive, guests, other);

    private static Gen<DirectedScenario> DirectedScenarioGen() =>
        from type in Gen.Elements(DirectedTypes)
        from active in Gen.Choose(1, 5)
        from inactive in Gen.Choose(1, 4)
        from guests in Gen.Choose(0, 3)
        from other in Gen.Choose(0, 2)
        from takeActive in Gen.Choose(0, active)
        from takeInactive in Gen.Choose(1, inactive)
        select new DirectedScenario(type, active, inactive, guests, other, takeActive, takeInactive);

    private static Gen<DedupScenario> DedupScenarioGen() =>
        from type in Gen.Elements(DirectedTypes)
        from active in Gen.Choose(1, 4)
        from inactive in Gen.Choose(0, 2)
        from duplicationFactor in Gen.Choose(2, 4)
        select new DedupScenario(type, active, inactive, duplicationFactor);

    private static Gen<EmptyScenario> EmptyScenarioGen() =>
        from useBroadcast in Gen.Elements(new[] { true, false })
        from typeIndex in Gen.Choose(0, 3)
        from active in Gen.Choose(0, 4)
        from inactive in Gen.Choose(0, 3)
        from guests in Gen.Choose(0, 3)
        from other in Gen.Choose(0, 2)
        select new EmptyScenario(useBroadcast, typeIndex, active, inactive, guests, other);

    // Values outside the eight defined members (0..7): negative or >= 8.
    private static Gen<NotificationType> UnknownTypeGen() =>
        Gen.OneOf(Gen.Choose(8, 5000), Gen.Choose(-5000, -1))
            .Select(value => (NotificationType)value);

    // --- Helpers ----------------------------------------------------------------------------------

    private static DomainResult Publish(
        PublishNotificationHandler handler, NotificationType type, Guid squadId, IReadOnlyCollection<Guid> directedIds) =>
        handler
            .PublishAsync(type, squadId, directedIds, Factory.Context(), CancellationToken.None)
            .GetAwaiter()
            .GetResult();

    private static (FakeNotificationRepository Repo, NotificationStore Store, PublishNotificationHandler Handler) Build(
        Population population)
    {
        var store = new NotificationStore();
        foreach (SquadMembership membership in population.All())
        {
            store.AddMembership(membership);
        }

        var repo = new FakeNotificationRepository(store);
        var unitOfWork = new NotificationPublishFakeUnitOfWork();
        return (repo, store, new PublishNotificationHandler(
            repo,
            unitOfWork,
            new FakeNotificationEmailRenderer(),
            new FakeEmailSender(),
            NullLogger<PublishNotificationHandler>.Instance));
    }

    private static Population BuildPopulation(Guid squadId, int active, int inactive, int guests, int other)
    {
        List<SquadMembership> registeredActive = Enumerable.Range(0, active)
            .Select(i => Factory.RegisteredActive(squadId, $"active-{i}"))
            .ToList();
        List<SquadMembership> registeredInactive = Enumerable.Range(0, inactive)
            .Select(i => Factory.RegisteredInactive(squadId, $"inactive-{i}"))
            .ToList();
        List<SquadMembership> guestList = Enumerable.Range(0, guests)
            .Select(i => Factory.Guest(squadId, $"guest-{i}"))
            .ToList();
        List<SquadMembership> otherSquad = Enumerable.Range(0, other)
            .Select(i => Factory.RegisteredActive(Guid.CreateVersion7(), $"other-{i}"))
            .ToList();

        return new Population(squadId, registeredActive, registeredInactive, guestList, otherSquad);
    }

    // --- Scenario records -------------------------------------------------------------------------

    public sealed record AnyTypeScenario(NotificationType Type, int Active, int Inactive, int Guests, int Other);

    public sealed record BroadcastScenario(NotificationType Type, int Active, int Inactive, int Guests, int Other);

    public sealed record DirectedScenario(
        NotificationType Type, int Active, int Inactive, int Guests, int Other, int TakeActive, int TakeInactive);

    public sealed record DedupScenario(NotificationType Type, int Active, int Inactive, int DuplicationFactor);

    public sealed record EmptyScenario(
        bool UseBroadcast, int TypeIndex, int Active, int Inactive, int Guests, int Other);

    private sealed record Population(
        Guid SquadId,
        IReadOnlyList<SquadMembership> RegisteredActive,
        IReadOnlyList<SquadMembership> RegisteredInactive,
        IReadOnlyList<SquadMembership> Guests,
        IReadOnlyList<SquadMembership> OtherSquad)
    {
        public IEnumerable<SquadMembership> All() =>
            RegisteredActive.Concat(RegisteredInactive).Concat(Guests).Concat(OtherSquad);

        public IReadOnlyList<Guid> AllIds() => All().Select(m => m.Id).ToList();
    }
}
