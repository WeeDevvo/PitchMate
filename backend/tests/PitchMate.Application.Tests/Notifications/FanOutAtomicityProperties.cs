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
/// Property-based tests for the in-app fan-out and its atomicity in <see cref="PublishNotificationHandler"/>
/// (notifications design Properties 1 and 8). They drive the real handler against the in-memory
/// <see cref="FakeNotificationRepository"/> over a <see cref="NotificationStore"/>, committing through the
/// <see cref="NotificationPublishFakeUnitOfWork"/> (no database), per the Application-layer testing
/// strategy. Each property runs at least 100 generated cases.
/// <para>
/// Task 4.3's handler resolves recipients, creates one <c>Unread</c> <see cref="InAppNotification"/> per
/// resolved recipient, and commits them atomically via a single
/// <see cref="Application.Common.Persistence.IUnitOfWork.SaveChangesAsync"/>. The store models a real
/// unit-of-work's all-or-nothing semantics: <see cref="NotificationStore.Added"/> surfaces only records a
/// successful save committed, so a failed or cancelled publish leaves no partial set observable.
/// </para>
/// </summary>
[Trait("Feature", "notifications")]
public class FanOutAtomicityProperties
{
    private static readonly NotificationType[] BroadcastTypes =
    [
        NotificationType.MatchDrafted,
        NotificationType.MatchConfirmed,
        NotificationType.TeamsRolled,
        NotificationType.ResultPosted,
    ];

    private static readonly NotificationType[] AllTypes = Enum.GetValues<NotificationType>();

    // Feature: notifications, Property 1: Fan-out persists exactly one Unread record per resolved
    // recipient - for any resolved set of R distinct valid recipients, a successful publish persists
    // exactly R InAppNotification records: one per recipient, each Unread, each carrying the published
    // NotificationType and owning squad, and never more or fewer.
    // Validates: Requirements 1.2, 1.5, 3.3, 5.1, 5.3
    [Property(MaxTest = 200)]
    [Trait("Property", "1")]
    public Property Property1_FanOutPersistsOneUnreadRecordPerRecipient() =>
        Prop.ForAll(Arb.From(FanOutScenarioGen()), scenario =>
        {
            var squadId = Guid.CreateVersion7();
            Population population = BuildPopulation(
                squadId, scenario.Active, scenario.Inactive, scenario.Guests, scenario.Other);
            (NotificationStore store, FakeNotificationRepository repo) = BuildStore(population);
            PublishNotificationHandler handler = NewHandler(repo, new NotificationPublishFakeUnitOfWork(store));

            bool broadcast = BroadcastTypes.Contains(scenario.Type);

            // Broadcast supplies no directed ids; directed hands over every seeded id (registered active +
            // inactive, plus guests and other-squad ids that must be filtered out), so the resolved set is
            // exactly the owning squad's registered memberships.
            IReadOnlyCollection<Guid> directedIds = broadcast ? [] : population.AllIds();

            HashSet<Guid> expectedRecipients = broadcast
                ? population.RegisteredActive.Select(m => m.Id).ToHashSet()
                : population.RegisteredActive.Concat(population.RegisteredInactive).Select(m => m.Id).ToHashSet();

            DomainResult result = Publish(handler, scenario.Type, squadId, directedIds);

            IReadOnlyList<InAppNotification> added = store.Added;
            List<Guid> recipientIds = added.Select(n => n.RecipientMembershipId).ToList();

            bool exactlyOnePerRecipient =
                recipientIds.Count == expectedRecipients.Count
                && recipientIds.Distinct().Count() == recipientIds.Count
                && recipientIds.ToHashSet().SetEquals(expectedRecipients);

            bool everyRecordUnread = added.All(n => n.ReadState == ReadState.Unread);
            bool everyRecordCarriesType = added.All(n => n.Type == scenario.Type);
            bool everyRecordOwnedBySquad = added.All(n => n.SquadId == squadId);

            return (result.IsSuccess
                && expectedRecipients.Count > 0
                && exactlyOnePerRecipient
                && everyRecordUnread
                && everyRecordCarriesType
                && everyRecordOwnedBySquad).ToProperty();
        });

    // Feature: notifications, Property 8: Publishing is atomic - all recipients' records or none - for any
    // publish resolving to one or more recipients, if committing the in-app records fails or the
    // cancellation token is signalled before the commit, the publish reports failure (PublishFailed) and
    // no InAppNotification record for that notification is persisted (no partial set).
    // Validates: Requirements 5.4, 5.7, 5.8
    [Property(MaxTest = 200)]
    [Trait("Property", "8")]
    public Property Property8_PublishingIsAtomicAllOrNone() =>
        Prop.ForAll(Arb.From(AtomicityScenarioGen()), scenario =>
        {
            var squadId = Guid.CreateVersion7();
            Population population = BuildPopulation(
                squadId, scenario.Active, scenario.Inactive, scenario.Guests, scenario.Other);
            (NotificationStore store, FakeNotificationRepository repo) = BuildStore(population);

            bool broadcast = BroadcastTypes.Contains(scenario.Type);
            IReadOnlyCollection<Guid> directedIds = broadcast ? [] : population.AllIds();

            DomainResult result;
            if (scenario.CancelBeforeCommit)
            {
                // The recipients resolve successfully; the token becomes signalled at the commit point, so
                // no record is committed (Requirement 5.8).
                using var cts = new CancellationTokenSource();
                PublishNotificationHandler handler = NewHandler(
                    repo, new NotificationPublishFakeUnitOfWork(store, cancelOnSave: cts));
                result = handler
                    .PublishAsync(scenario.Type, squadId, directedIds, Factory.Context(), cts.Token)
                    .GetAwaiter()
                    .GetResult();
            }
            else
            {
                // The commit itself fails, so the staged set is rolled back (Requirements 5.4, 5.7).
                PublishNotificationHandler handler = NewHandler(
                    repo, new NotificationPublishFakeUnitOfWork(store, throwOnSave: true));
                result = Publish(handler, scenario.Type, squadId, directedIds);
            }

            bool resolvedAtLeastOne = repo.LastResolvedRecipients.Count > 0;
            bool reportsPublishFailure =
                !result.IsSuccess && result.Error?.Code == DomainErrorCode.PublishFailed;
            bool nothingPersisted = store.Added.Count == 0;

            return (resolvedAtLeastOne && reportsPublishFailure && nothingPersisted).ToProperty();
        });

    // --- Generators -------------------------------------------------------------------------------

    // Any catalogue type over a population that always resolves at least one recipient: at least one
    // active registered member (so a broadcast has >=1 recipient and a directed set naming the registered
    // members has >=1 recipient).
    private static Gen<FanOutScenario> FanOutScenarioGen() =>
        from type in Gen.Elements(AllTypes)
        from active in Gen.Choose(1, 6)
        from inactive in Gen.Choose(0, 4)
        from guests in Gen.Choose(0, 3)
        from other in Gen.Choose(0, 2)
        select new FanOutScenario(type, active, inactive, guests, other);

    private static Gen<AtomicityScenario> AtomicityScenarioGen() =>
        from type in Gen.Elements(AllTypes)
        from cancelBeforeCommit in Gen.Elements(new[] { true, false })
        from active in Gen.Choose(1, 6)
        from inactive in Gen.Choose(0, 4)
        from guests in Gen.Choose(0, 3)
        from other in Gen.Choose(0, 2)
        select new AtomicityScenario(type, cancelBeforeCommit, active, inactive, guests, other);

    // --- Helpers ----------------------------------------------------------------------------------

    // Builds the handler with default no-op email collaborators: the fan-out and atomicity properties are
    // about the in-app path only, so email resolution finds no recorded addresses (an empty map) and no
    // send is attempted. Task 4.6 configures these fakes to exercise the email-isolation properties.
    private static PublishNotificationHandler NewHandler(
        FakeNotificationRepository repo, NotificationPublishFakeUnitOfWork unitOfWork) =>
        new(
            repo,
            unitOfWork,
            new FakeNotificationEmailRenderer(),
            new FakeEmailSender(),
            NullLogger<PublishNotificationHandler>.Instance);

    private static DomainResult Publish(
        PublishNotificationHandler handler, NotificationType type, Guid squadId, IReadOnlyCollection<Guid> directedIds) =>
        handler
            .PublishAsync(type, squadId, directedIds, Factory.Context(), CancellationToken.None)
            .GetAwaiter()
            .GetResult();

    private static (NotificationStore Store, FakeNotificationRepository Repo) BuildStore(Population population)
    {
        var store = new NotificationStore();
        foreach (SquadMembership membership in population.All())
        {
            store.AddMembership(membership);
        }

        return (store, new FakeNotificationRepository(store));
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

    public sealed record FanOutScenario(NotificationType Type, int Active, int Inactive, int Guests, int Other);

    public sealed record AtomicityScenario(
        NotificationType Type, bool CancelBeforeCommit, int Active, int Inactive, int Guests, int Other);

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
