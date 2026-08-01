using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.Extensions.Logging.Abstractions;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;
using NotificationType = PitchMate.Domain.Notifications.NotificationType;
using NotifResult = PitchMate.Domain.Notifications.Result;
using DomainResult = PitchMate.Domain.Squads.Result;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Producer-wiring tests for the four squad notification producers wired in tasks 10.1 and 10.2:
/// <see cref="RedeemInviteHandler"/> (<c>MemberJoined</c>), <see cref="PromoteToAdminHandler"/>
/// (<c>PromotedToAdmin</c>), <see cref="RemoveMemberHandler"/> (<c>RemovedFromSquad</c>), and
/// <see cref="TransferOwnershipHandler"/> (<c>OwnershipTransferred</c>). They drive the real handlers
/// against the in-memory squad fakes (no database), reusing the capturing
/// <see cref="FakeNotificationPublisher"/> to observe every publish call without persisting or emailing.
/// <para>
/// The property below is the notifications design Property 13 across each producer; the accompanying
/// example facts pin the correct catalogue <see cref="NotificationType"/> and the exact directed target
/// membership-id set per producer. The database-level rollback/atomicity of the originating squad
/// change is covered by the squads-and-membership Infrastructure tests; here we prove the
/// Application-layer wiring: publish runs only after a committed change, a rolled-back or no-op change
/// publishes nothing, and a failing or throwing publish never rolls back the committed action nor
/// changes the success result.
/// </para>
/// </summary>
[Trait("Feature", "notifications")]
public class NotificationProducerWiringProperties
{
    /// <summary>A fixed UTC anchor the fake clock reads from; the seeded invite expires well after it.</summary>
    private static readonly DateTimeOffset Anchor = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    /// <summary>The secret presented for redemption; the seeded invite stores only its one-way hash.</summary>
    private const string PresentedSecret = "join-secret-token";

    /// <summary>How the publisher behaves when (and if) it is invoked after a committed squad change.</summary>
    public enum PublisherMode
    {
        /// <summary>The publish returns a success result.</summary>
        Success,

        /// <summary>The publish returns a failure result (must be isolated and swallowed).</summary>
        FailureResult,

        /// <summary>The publish throws (must be caught and swallowed).</summary>
        Throws,
    }

    /// <summary>The redemption outcome scenario for the <c>MemberJoined</c> producer.</summary>
    public enum RedeemScenario
    {
        /// <summary>A genuine new join commits and publishes exactly once.</summary>
        GenuineJoin,

        /// <summary>An already-active member redeems: a no-op success that neither commits nor publishes.</summary>
        AlreadyMember,

        /// <summary>An inactive member reactivates: it commits but does not publish <c>MemberJoined</c>.</summary>
        ReactivateInactive,

        /// <summary>An unusable invite fails: nothing commits and nothing publishes.</summary>
        InviteUnusable,
    }

    /// <summary>The promotion scenario for the <c>PromotedToAdmin</c> producer.</summary>
    public enum PromoteScenario
    {
        /// <summary>An authorised promotion of an active member commits and publishes once.</summary>
        CommittedPromotion,

        /// <summary>A non-owner/admin actor is rejected: nothing commits and nothing publishes.</summary>
        Unauthorized,

        /// <summary>An ineligible target (guest) is rejected: nothing commits and nothing publishes.</summary>
        IneligibleTarget,
    }

    /// <summary>The removal scenario for the <c>RemovedFromSquad</c> producer.</summary>
    public enum RemoveScenario
    {
        /// <summary>An authorised removal of an active member commits and publishes once.</summary>
        CommittedRemoval,

        /// <summary>A non-owner/admin actor is rejected: nothing commits and nothing publishes.</summary>
        Unauthorized,

        /// <summary>Removing the owner is rejected: nothing commits and nothing publishes.</summary>
        OwnerTarget,

        /// <summary>An already-inactive target is a no-op success that neither commits nor publishes.</summary>
        AlreadyInactive,
    }

    /// <summary>The transfer scenario for the <c>OwnershipTransferred</c> producer.</summary>
    public enum TransferScenario
    {
        /// <summary>An authorised transfer to an active registered member commits and publishes once.</summary>
        CommittedTransfer,

        /// <summary>A non-owner actor is rejected: nothing commits and nothing publishes.</summary>
        Unauthorized,

        /// <summary>An ineligible target (guest) is rejected: nothing commits and nothing publishes.</summary>
        IneligibleTarget,
    }

    // Feature: notifications, Property 13: Publishing runs only after a committed originating action and
    // never rolls it back - for any wired squad event, the publisher is invoked only after the
    // originating squad change has committed; if the squad change is not committed (authorization
    // failure, validation failure, or a no-op), no publish occurs and no record or email is produced;
    // and if a publish after a committed squad change fails (failure Result) or throws, the failure is
    // isolated so the squad change stays committed and the originating action still reports success.
    // Validates: Requirements 8.5, 8.6, 8.8
    [Property(MaxTest = 200)]
    [Trait("Property", "13")]
    public Property Property13_RedeemInvite_MemberJoined_PublishesOnlyAfterCommittedJoin() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(Enum.GetValues<RedeemScenario>())),
            Arb.From(Gen.Elements(Enum.GetValues<PublisherMode>())),
            (scenario, mode) =>
            {
                var clock = new SquadFakeClock(Anchor);
                var secrets = new FakeInviteSecretService();
                (SquadStore store, Guid squadId, _) = SeedSquadWithInviteAndOwner(secrets, clock);

                Guid joinUserId = Guid.NewGuid();
                string presented = PresentedSecret;
                string? displayName = null;

                switch (scenario)
                {
                    case RedeemScenario.GenuineJoin:
                        displayName = "Joiner";
                        break;
                    case RedeemScenario.AlreadyMember:
                        store.AddCommittedMembership(
                            SquadMembership.CreateRegistered(squadId, joinUserId, "Member").Value!);
                        break;
                    case RedeemScenario.ReactivateInactive:
                        SquadMembership inactive =
                            SquadMembership.CreateRegistered(squadId, joinUserId, "Returner").Value!;
                        inactive.Deactivate();
                        store.AddCommittedMembership(inactive);
                        break;
                    case RedeemScenario.InviteUnusable:
                        presented = "not-a-valid-secret";
                        break;
                }

                var publisher = MakePublisher(mode);
                RedeemInviteHandler handler = BuildRedeemHandler(store, secrets, clock, publisher);

                Result<RedeemInviteResult> result = handler
                    .HandleAsync(new RedeemInviteCommand(joinUserId, presented, displayName), CancellationToken.None)
                    .GetAwaiter()
                    .GetResult();

                bool ok = scenario switch
                {
                    // Committed genuine join publishes exactly once, after the single commit, and stays
                    // committed and successful regardless of the publisher's outcome (Requirement 8.1, 8.5,
                    // 8.6, 8.8).
                    RedeemScenario.GenuineJoin =>
                        result.IsSuccess
                        && result.Value!.Outcome == RedeemOutcome.Joined
                        && store.SaveCallCount == 1
                        && publisher.Calls.Count == 1
                        && publisher.Calls[0].Type == NotificationType.MemberJoined
                        && publisher.Calls[0].SquadId == squadId
                        && store.FindMembershipById(result.Value!.MembershipId) is { State: MembershipState.Active },

                    // Already-active member: no-op success, nothing committed, nothing published.
                    RedeemScenario.AlreadyMember =>
                        result.IsSuccess
                        && result.Value!.Outcome == RedeemOutcome.AlreadyMember
                        && store.SaveCallCount == 0
                        && publisher.Calls.Count == 0,

                    // Reactivation commits but is not a MemberJoined event, so it publishes nothing.
                    RedeemScenario.ReactivateInactive =>
                        result.IsSuccess
                        && result.Value!.Outcome == RedeemOutcome.Reactivated
                        && store.SaveCallCount == 1
                        && publisher.Calls.Count == 0,

                    // Unusable invite: not committed, so nothing is published (Requirement 8.8).
                    RedeemScenario.InviteUnusable =>
                        !result.IsSuccess
                        && store.SaveCallCount == 0
                        && publisher.Calls.Count == 0,

                    _ => false,
                };

                return ok.ToProperty();
            });

    // Feature: notifications, Property 13: Publishing runs only after a committed originating action and
    // never rolls it back (PromotedToAdmin producer). Validates: Requirements 8.5, 8.6, 8.8
    [Property(MaxTest = 200)]
    [Trait("Property", "13")]
    public Property Property13_Promote_PromotedToAdmin_PublishesOnlyAfterCommittedPromotion() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(Enum.GetValues<PromoteScenario>())),
            Arb.From(Gen.Elements(Enum.GetValues<PublisherMode>())),
            (scenario, mode) =>
            {
                var store = new SquadStore();
                Squad squad = Squad.Create("The Squad").Value!;
                store.AddCommittedSquad(squad);

                Guid ownerUserId = Guid.NewGuid();
                store.AddCommittedMembership(SquadMembership.CreateOwner(squad.Id, ownerUserId, "Owner").Value!);

                Guid actingUserId;
                Guid targetId;
                switch (scenario)
                {
                    case PromoteScenario.CommittedPromotion:
                        actingUserId = ownerUserId;
                        targetId = Add(store, SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), "Member").Value!);
                        break;
                    case PromoteScenario.Unauthorized:
                        Guid memberUserId = Guid.NewGuid();
                        store.AddCommittedMembership(
                            SquadMembership.CreateRegistered(squad.Id, memberUserId, "Actor member").Value!);
                        actingUserId = memberUserId;
                        targetId = Add(store, SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), "Member").Value!);
                        break;
                    case PromoteScenario.IneligibleTarget:
                        actingUserId = ownerUserId;
                        targetId = Add(store, SquadMembership.CreateGuest(squad.Id, "Guest", skillTier: null, Anchor).Value!);
                        break;
                    default:
                        throw new ArgumentOutOfRangeException(nameof(scenario), scenario, "Unhandled scenario.");
                }

                var publisher = MakePublisher(mode);
                var handler = new PromoteToAdminHandler(
                    new FakeSquadMembershipRepository(store),
                    new FakeSquadRepository(store),
                    new FakeSquadUnitOfWork(store),
                    publisher,
                    NullLogger<PromoteToAdminHandler>.Instance);

                DomainResult result = handler
                    .HandleAsync(new PromoteToAdminCommand(actingUserId, squad.Id, targetId), CancellationToken.None)
                    .GetAwaiter()
                    .GetResult();

                bool ok = scenario == PromoteScenario.CommittedPromotion
                    ? result.IsSuccess
                        && store.SaveCallCount == 1
                        && publisher.Calls.Count == 1
                        && publisher.Calls[0].Type == NotificationType.PromotedToAdmin
                        && publisher.Calls[0].SquadId == squad.Id
                        && store.FindMembershipById(targetId)!.Role == SquadRole.Admin
                    : !result.IsSuccess
                        && store.SaveCallCount == 0
                        && publisher.Calls.Count == 0;

                return ok.ToProperty();
            });

    // Feature: notifications, Property 13: Publishing runs only after a committed originating action and
    // never rolls it back (RemovedFromSquad producer). Validates: Requirements 8.5, 8.6, 8.8
    [Property(MaxTest = 200)]
    [Trait("Property", "13")]
    public Property Property13_Remove_RemovedFromSquad_PublishesOnlyAfterCommittedRemoval() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(Enum.GetValues<RemoveScenario>())),
            Arb.From(Gen.Elements(Enum.GetValues<PublisherMode>())),
            (scenario, mode) =>
            {
                var store = new SquadStore();
                Squad squad = Squad.Create("The Squad").Value!;
                store.AddCommittedSquad(squad);

                Guid ownerUserId = Guid.NewGuid();
                SquadMembership owner = SquadMembership.CreateOwner(squad.Id, ownerUserId, "Owner").Value!;
                store.AddCommittedMembership(owner);

                Guid actingUserId;
                Guid targetId;
                switch (scenario)
                {
                    case RemoveScenario.CommittedRemoval:
                        actingUserId = ownerUserId;
                        targetId = Add(store, SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), "Member").Value!);
                        break;
                    case RemoveScenario.Unauthorized:
                        Guid memberUserId = Guid.NewGuid();
                        store.AddCommittedMembership(
                            SquadMembership.CreateRegistered(squad.Id, memberUserId, "Actor member").Value!);
                        actingUserId = memberUserId;
                        targetId = Add(store, SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), "Member").Value!);
                        break;
                    case RemoveScenario.OwnerTarget:
                        actingUserId = ownerUserId;
                        targetId = owner.Id;
                        break;
                    case RemoveScenario.AlreadyInactive:
                        actingUserId = ownerUserId;
                        SquadMembership inactive =
                            SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), "Member").Value!;
                        inactive.Deactivate();
                        targetId = Add(store, inactive);
                        break;
                    default:
                        throw new ArgumentOutOfRangeException(nameof(scenario), scenario, "Unhandled scenario.");
                }

                var publisher = MakePublisher(mode);
                var handler = new RemoveMemberHandler(
                    new FakeSquadMembershipRepository(store),
                    new FakeSquadUnitOfWork(store),
                    new FakeSquadRepository(store),
                    publisher,
                    NullLogger<RemoveMemberHandler>.Instance);

                DomainResult result = handler
                    .HandleAsync(new RemoveMemberCommand(actingUserId, squad.Id, targetId), CancellationToken.None)
                    .GetAwaiter()
                    .GetResult();

                bool ok = scenario switch
                {
                    // Committed removal publishes exactly once, after the single commit, and the removed
                    // membership stays Inactive and successful regardless of the publisher's outcome.
                    RemoveScenario.CommittedRemoval =>
                        result.IsSuccess
                        && store.SaveCallCount == 1
                        && publisher.Calls.Count == 1
                        && publisher.Calls[0].Type == NotificationType.RemovedFromSquad
                        && publisher.Calls[0].SquadId == squad.Id
                        && store.FindMembershipById(targetId)!.State == MembershipState.Inactive,

                    // Already-inactive target: no-op success, nothing committed, nothing published.
                    RemoveScenario.AlreadyInactive =>
                        result.IsSuccess
                        && store.SaveCallCount == 0
                        && publisher.Calls.Count == 0,

                    // Unauthorized actor or owner target: not committed, so nothing is published.
                    _ =>
                        !result.IsSuccess
                        && store.SaveCallCount == 0
                        && publisher.Calls.Count == 0,
                };

                return ok.ToProperty();
            });

    // Feature: notifications, Property 13: Publishing runs only after a committed originating action and
    // never rolls it back (OwnershipTransferred producer). Validates: Requirements 8.5, 8.6, 8.8
    [Property(MaxTest = 200)]
    [Trait("Property", "13")]
    public Property Property13_Transfer_OwnershipTransferred_PublishesOnlyAfterCommittedTransfer() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(Enum.GetValues<TransferScenario>())),
            Arb.From(Gen.Elements(Enum.GetValues<PublisherMode>())),
            (scenario, mode) =>
            {
                var store = new SquadStore();
                Squad squad = Squad.Create("The Squad").Value!;
                store.AddCommittedSquad(squad);

                Guid ownerUserId = Guid.NewGuid();
                SquadMembership owner = SquadMembership.CreateOwner(squad.Id, ownerUserId, "Owner").Value!;
                store.AddCommittedMembership(owner);

                Guid actingUserId;
                Guid targetId;
                switch (scenario)
                {
                    case TransferScenario.CommittedTransfer:
                        actingUserId = ownerUserId;
                        targetId = Add(store, SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), "Member").Value!);
                        break;
                    case TransferScenario.Unauthorized:
                        Guid memberUserId = Guid.NewGuid();
                        store.AddCommittedMembership(
                            SquadMembership.CreateRegistered(squad.Id, memberUserId, "Actor member").Value!);
                        actingUserId = memberUserId;
                        targetId = Add(store, SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), "Member").Value!);
                        break;
                    case TransferScenario.IneligibleTarget:
                        actingUserId = ownerUserId;
                        targetId = Add(store, SquadMembership.CreateGuest(squad.Id, "Guest", skillTier: null, Anchor).Value!);
                        break;
                    default:
                        throw new ArgumentOutOfRangeException(nameof(scenario), scenario, "Unhandled scenario.");
                }

                var publisher = MakePublisher(mode);
                var handler = new TransferOwnershipHandler(
                    new FakeSquadMembershipRepository(store),
                    new FakeSquadUnitOfWork(store),
                    new FakeSquadRepository(store),
                    publisher,
                    NullLogger<TransferOwnershipHandler>.Instance);

                DomainResult result = handler
                    .HandleAsync(new TransferOwnershipCommand(actingUserId, squad.Id, targetId), CancellationToken.None)
                    .GetAwaiter()
                    .GetResult();

                bool ok;
                if (scenario == TransferScenario.CommittedTransfer)
                {
                    SquadMembership newOwner = store.FindMembershipById(targetId)!;
                    SquadMembership formerOwner = store.FindMembershipById(owner.Id)!;

                    // Committed transfer publishes exactly once, after the single commit, and the
                    // owner/admin swap stays committed and successful regardless of the publisher outcome.
                    ok = result.IsSuccess
                        && store.SaveCallCount == 1
                        && publisher.Calls.Count == 1
                        && publisher.Calls[0].Type == NotificationType.OwnershipTransferred
                        && publisher.Calls[0].SquadId == squad.Id
                        && newOwner.Role == SquadRole.Owner
                        && formerOwner.Role == SquadRole.Admin;
                }
                else
                {
                    // Not committed, so nothing is published (Requirement 8.8).
                    ok = !result.IsSuccess
                        && store.SaveCallCount == 0
                        && publisher.Calls.Count == 0;
                }

                return ok.ToProperty();
            });

    // ----- Example facts: correct catalogue type and exact directed target set per producer -----

    [Fact]
    [Trait("Property", "13")]
    public async Task MemberJoined_DirectsToActiveOwnerAndAdminsExcludingJoinerMemberGuestAndInactive()
    {
        var clock = new SquadFakeClock(Anchor);
        var secrets = new FakeInviteSecretService();
        (SquadStore store, Guid squadId, Guid ownerId) = SeedSquadWithInviteAndOwner(secrets, clock);

        // An active admin is a target; an active plain member, a guest, and an inactive admin are not.
        SquadMembership admin = SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), "Admin").Value!;
        admin.PromoteToAdmin();
        store.AddCommittedMembership(admin);

        store.AddCommittedMembership(SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), "Plain member").Value!);
        store.AddCommittedMembership(SquadMembership.CreateGuest(squadId, "Guest", skillTier: null, Anchor).Value!);

        SquadMembership inactiveAdmin = SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), "Inactive admin").Value!;
        inactiveAdmin.PromoteToAdmin();
        inactiveAdmin.Deactivate();
        store.AddCommittedMembership(inactiveAdmin);

        var publisher = new FakeNotificationPublisher();
        RedeemInviteHandler handler = BuildRedeemHandler(store, secrets, clock, publisher);

        Result<RedeemInviteResult> result = await handler.HandleAsync(
            new RedeemInviteCommand(Guid.NewGuid(), PresentedSecret, "Joiner"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(RedeemOutcome.Joined, result.Value!.Outcome);

        FakeNotificationPublisher.PublishCall call = Assert.Single(publisher.Calls);
        Assert.Equal(NotificationType.MemberJoined, call.Type);
        Assert.Equal(squadId, call.SquadId);
        Assert.Equal(
            new[] { ownerId, admin.Id }.OrderBy(id => id),
            call.DirectedTargetMembershipIds.OrderBy(id => id));
    }

    [Fact]
    [Trait("Property", "13")]
    public async Task PromotedToAdmin_DirectsToThePromotedMembership()
    {
        var store = new SquadStore();
        Squad squad = Squad.Create("The Squad").Value!;
        store.AddCommittedSquad(squad);

        Guid ownerUserId = Guid.NewGuid();
        store.AddCommittedMembership(SquadMembership.CreateOwner(squad.Id, ownerUserId, "Owner").Value!);

        SquadMembership target = SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), "Member").Value!;
        store.AddCommittedMembership(target);

        var publisher = new FakeNotificationPublisher();
        var handler = new PromoteToAdminHandler(
            new FakeSquadMembershipRepository(store),
            new FakeSquadRepository(store),
            new FakeSquadUnitOfWork(store),
            publisher,
            NullLogger<PromoteToAdminHandler>.Instance);

        DomainResult result = await handler.HandleAsync(
            new PromoteToAdminCommand(ownerUserId, squad.Id, target.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        FakeNotificationPublisher.PublishCall call = Assert.Single(publisher.Calls);
        Assert.Equal(NotificationType.PromotedToAdmin, call.Type);
        Assert.Equal(squad.Id, call.SquadId);
        Assert.Equal(new[] { target.Id }, call.DirectedTargetMembershipIds);
    }

    [Fact]
    [Trait("Property", "13")]
    public async Task RemovedFromSquad_DirectsToTheNowInactiveRemovedMembership()
    {
        var store = new SquadStore();
        Squad squad = Squad.Create("The Squad").Value!;
        store.AddCommittedSquad(squad);

        Guid ownerUserId = Guid.NewGuid();
        store.AddCommittedMembership(SquadMembership.CreateOwner(squad.Id, ownerUserId, "Owner").Value!);

        SquadMembership target = SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), "Member").Value!;
        store.AddCommittedMembership(target);

        var publisher = new FakeNotificationPublisher();
        var handler = new RemoveMemberHandler(
            new FakeSquadMembershipRepository(store),
            new FakeSquadUnitOfWork(store),
            new FakeSquadRepository(store),
            publisher,
            NullLogger<RemoveMemberHandler>.Instance);

        DomainResult result = await handler.HandleAsync(
            new RemoveMemberCommand(ownerUserId, squad.Id, target.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(MembershipState.Inactive, store.FindMembershipById(target.Id)!.State);

        FakeNotificationPublisher.PublishCall call = Assert.Single(publisher.Calls);
        Assert.Equal(NotificationType.RemovedFromSquad, call.Type);
        Assert.Equal(squad.Id, call.SquadId);
        Assert.Equal(new[] { target.Id }, call.DirectedTargetMembershipIds);
    }

    [Fact]
    [Trait("Property", "13")]
    public async Task OwnershipTransferred_DirectsToTheNewOwnerAndTheFormerOwner()
    {
        var store = new SquadStore();
        Squad squad = Squad.Create("The Squad").Value!;
        store.AddCommittedSquad(squad);

        Guid ownerUserId = Guid.NewGuid();
        SquadMembership owner = SquadMembership.CreateOwner(squad.Id, ownerUserId, "Owner").Value!;
        store.AddCommittedMembership(owner);

        SquadMembership target = SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), "Member").Value!;
        store.AddCommittedMembership(target);

        var publisher = new FakeNotificationPublisher();
        var handler = new TransferOwnershipHandler(
            new FakeSquadMembershipRepository(store),
            new FakeSquadUnitOfWork(store),
            new FakeSquadRepository(store),
            publisher,
            NullLogger<TransferOwnershipHandler>.Instance);

        DomainResult result = await handler.HandleAsync(
            new TransferOwnershipCommand(ownerUserId, squad.Id, target.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        FakeNotificationPublisher.PublishCall call = Assert.Single(publisher.Calls);
        Assert.Equal(NotificationType.OwnershipTransferred, call.Type);
        Assert.Equal(squad.Id, call.SquadId);

        // The producer directs to the new owner first, then the former owner (Requirement 8.4).
        Assert.Equal(new[] { target.Id, owner.Id }, call.DirectedTargetMembershipIds);
    }

    // ----- Helpers -----

    /// <summary>
    /// Builds the publisher for the requested mode: a success result, an isolated failure result, or a
    /// thrown exception — all of which the producers must swallow after a committed squad change.
    /// </summary>
    private static FakeNotificationPublisher MakePublisher(PublisherMode mode) => mode switch
    {
        PublisherMode.Success => new FakeNotificationPublisher(),
        PublisherMode.FailureResult => new FakeNotificationPublisher(
            NotifResult.Fail(new PitchMate.Domain.Notifications.NotificationError(
                PitchMate.Domain.Notifications.NotificationErrorCode.PublishFailed,
                "Induced failure result for isolation testing."))),
        PublisherMode.Throws => new FakeNotificationPublisher(throwOnPublish: true),
        _ => throw new ArgumentOutOfRangeException(nameof(mode), mode, "Unhandled publisher mode."),
    };

    /// <summary>
    /// Seeds a committed squad, a redeemable invite whose stored one-way token hash matches the presented
    /// secret, and an active owner (so a genuine join has at least one Owner/Admin recipient). Returns the
    /// store, the squad id, and the owner membership id.
    /// </summary>
    private static (SquadStore store, Guid squadId, Guid ownerId) SeedSquadWithInviteAndOwner(
        FakeInviteSecretService secrets, TimeProvider clock)
    {
        var store = new SquadStore();
        Squad squad = Squad.Create("The Squad").Value!;
        store.AddCommittedSquad(squad);

        Invite invite = Invite.Create(squad.Id, secrets.Hash(PresentedSecret), clock.GetUtcNow() + TimeSpan.FromDays(30));
        store.AddCommittedInvite(invite);

        SquadMembership owner = SquadMembership.CreateOwner(squad.Id, Guid.NewGuid(), "Owner").Value!;
        store.AddCommittedMembership(owner);

        return (store, squad.Id, owner.Id);
    }

    /// <summary>Builds the redeem handler over the supplied store, secret service, clock, and publisher.</summary>
    private static RedeemInviteHandler BuildRedeemHandler(
        SquadStore store, FakeInviteSecretService secrets, TimeProvider clock, FakeNotificationPublisher publisher) =>
        new(
            new FakeInviteRepository(store, clock),
            new FakeSquadMembershipRepository(store),
            new FakeUserRepository(store),
            new FakeSquadRepository(store),
            secrets,
            new FakeSquadUnitOfWork(store),
            clock,
            publisher,
            NullLogger<RedeemInviteHandler>.Instance);

    private static Guid Add(SquadStore store, SquadMembership membership)
    {
        store.AddCommittedMembership(membership);
        return membership.Id;
    }
}
