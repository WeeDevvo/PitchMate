using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.Extensions.Logging.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;
using DomainResult = PitchMate.Domain.Squads.Result;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Property-based tests for the squad-lifecycle use cases <see cref="DeleteSquadHandler"/>,
/// <see cref="ReverseSquadDeletionHandler"/>, and <see cref="ExportSquadHandler"/>
/// (squads-and-membership design Properties 34, 35, and 36). They drive the real handlers against the
/// in-memory squad fakes (no database), per the Application-layer testing strategy; the atomic-rollback
/// and DB-invariant portions of Properties 34 and 36 are covered separately by the Testcontainers
/// suite (task 18.5).
/// <para>
/// A soft-deleted squad is modelled faithfully: the store's soft-delete marker excludes it from the
/// non-deleted <see cref="ISquadRepository.GetByIdAsync"/> lookup, and the squad's own
/// <see cref="Squad.IsPendingDeletion"/> flag is set through the Domain soft-delete mediator exactly as
/// the persistence pipeline would, so the delete/reverse handlers observe the same pending-deletion
/// state they see in production. Each property runs at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class SquadDeletionProperties
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2025-01-01T00:00:00Z");

    // Feature: squads-and-membership, Property 34: Squad deletion sets a grace purge instant and is
    // idempotent (in-memory portion) - for any owner deletion with a whole-day grace period in
    // 1..90 (or none, defaulting to 30), the squad is marked pending deletion with a purge instant of
    // the clock instant plus that grace period; a grace period outside 1..90 is rejected as a
    // validation failure leaving the squad not deleted; and a second deletion of the already-deleted
    // squad leaves the purge instant unchanged, reports success, and performs no further commit.
    // Validates: Requirements 17.1, 17.7, 17.8
    [Property(MaxTest = 300)]
    [Trait("Property", "34")]
    public Property Property34_DeletionSetsGracePurgeInstantAndIsIdempotent() =>
        Prop.ForAll(GracePeriodArb(), grace =>
        {
            var world = DeletionWorld.Create(Now);
            var handler = world.DeleteHandler();

            Result<DeleteSquadResult> first = handler
                .HandleAsync(new DeleteSquadCommand(world.OwnerUserId, world.SquadId, grace), CancellationToken.None)
                .GetAwaiter().GetResult();

            bool valid = grace is null
                || (grace >= Squad.GracePeriodMinDays && grace <= Squad.GracePeriodMaxDays);

            // A grace period outside the inclusive 1..90 range is rejected and the squad is left not
            // deleted with nothing persisted (Requirement 17.8).
            if (!valid)
            {
                return (!first.IsSuccess
                    && first.Error!.Code == SquadErrorCode.ValidationFailed
                    && !world.Squad.IsPendingDeletion
                    && world.Squad.PurgeAt is null
                    && world.Store.SaveCallCount == 0).ToProperty();
            }

            // The purge instant is the clock instant plus the (defaulted) grace period, and the squad
            // is now pending deletion (Requirement 17.1, 17.8).
            int effectiveDays = grace ?? Squad.DefaultGracePeriodDays;
            DateTimeOffset expectedPurgeAt = Now.AddDays(effectiveDays);

            bool firstDeletion = first.IsSuccess
                && first.Value!.PurgeAt == expectedPurgeAt
                && world.Squad.PurgeAt == expectedPurgeAt
                && world.Squad.IsPendingDeletion
                && world.Store.SaveCallCount == 1;

            // Re-deleting the already-soft-deleted squad is idempotent: the existing purge instant is
            // reported unchanged, success is returned, and no further commit occurs (Requirement 17.7).
            Result<DeleteSquadResult> second = handler
                .HandleAsync(new DeleteSquadCommand(world.OwnerUserId, world.SquadId, grace), CancellationToken.None)
                .GetAwaiter().GetResult();

            bool idempotent = second.IsSuccess
                && second.Value!.PurgeAt == expectedPurgeAt
                && world.Squad.PurgeAt == expectedPurgeAt
                && world.Squad.IsPendingDeletion
                && world.Store.SaveCallCount == 1;

            return (firstDeletion && idempotent).ToProperty();
        });

    // Feature: squads-and-membership, Property 35: A pending-deletion squad rejects all actions except
    // export and reversal - for any squad that is soft-deleted and before its purge instant, every
    // squad action other than exporting the squad and reversing the deletion is rejected, while export
    // and reversal are permitted.
    // Validates: Requirements 17.3
    [Property(MaxTest = 300)]
    [Trait("Property", "35")]
    public Property Property35_PendingDeletionRejectsAllActionsExceptExportAndReversal() =>
        Prop.ForAll(Arb.From(Gen.Elements(Enum.GetValues<PendingAction>())), action =>
        {
            var world = PendingDeletionWorld.Create(Now);
            DomainResult result = world.Invoke(action);

            // Export and reversal remain permitted while the squad is pending deletion; every other
            // squad action is rejected (Requirement 17.3).
            bool permitted = action is PendingAction.Export or PendingAction.ReverseDeletion;

            return (result.IsSuccess == permitted).ToProperty();
        });

    // Feature: squads-and-membership, Property 36: Deletion reversal restores the full pre-deletion
    // state (in-memory portion) - for any squad soft-deleted and then reversed before its purge
    // instant, the deletion mark and purge instant are cleared and every membership (its role, state,
    // and display name) and every feature-flag state is identical to its pre-deletion value.
    // Validates: Requirements 17.4
    [Property(MaxTest = 200)]
    [Trait("Property", "36")]
    public Property Property36_ReversalRestoresFullPreDeletionState() =>
        Prop.ForAll(Arb.From(Gen.Choose(0, 4)), Arb.From(Gen.Elements(false, true)), (extraMembers, trackingEnabled) =>
        {
            var world = DeletionWorld.Create(Now, extraMembers, trackingEnabled);

            // Capture the pre-deletion state of every membership and the feature flag.
            var membersBefore = world.Store.Memberships
                .Select(m => (m.Id, m.Role, m.State, m.DisplayName, m.DisplayNameNormalized))
                .OrderBy(m => m.Id)
                .ToList();
            bool trackingBefore = world.Squad.IsFeatureEnabled(SquadFeature.LiveMatchTracking);

            // Soft-delete, then reverse, both as the owner and before the purge instant.
            Result<DeleteSquadResult> deletion = world.DeleteHandler()
                .HandleAsync(new DeleteSquadCommand(world.OwnerUserId, world.SquadId, 30), CancellationToken.None)
                .GetAwaiter().GetResult();

            DomainResult reversal = world.ReverseHandler()
                .HandleAsync(new ReverseSquadDeletionCommand(world.OwnerUserId, world.SquadId), CancellationToken.None)
                .GetAwaiter().GetResult();

            // The deletion mark and purge instant are cleared (Requirement 17.4).
            bool cleared = deletion.IsSuccess
                && reversal.IsSuccess
                && !world.Squad.IsPendingDeletion
                && world.Squad.PurgeAt is null;

            // Every feature-flag state is intact (Requirement 17.4).
            bool flagIntact = world.Squad.IsFeatureEnabled(SquadFeature.LiveMatchTracking) == trackingBefore;

            // Every membership's role, state, and display name is intact (Requirement 17.4).
            var membersAfter = world.Store.Memberships
                .Select(m => (m.Id, m.Role, m.State, m.DisplayName, m.DisplayNameNormalized))
                .OrderBy(m => m.Id)
                .ToList();
            bool membersIntact = membersBefore.SequenceEqual(membersAfter);

            return (cleared && flagIntact && membersIntact).ToProperty();
        });

    /// <summary>The squad action exercised against a pending-deletion squad in Property 35.</summary>
    public enum PendingAction
    {
        Promote,
        Demote,
        RemoveMember,
        Leave,
        TransferOwnership,
        GenerateInvite,
        RevokeInvite,
        RedeemInvite,
        SetFeatureFlag,
        CreateGuest,
        Export,
        ReverseDeletion,
    }

    /// <summary>
    /// A generator for the deletion grace period: <see langword="null"/> (apply the default), plus
    /// whole-day counts spanning below, within, and above the accepted 1..90 range.
    /// </summary>
    private static Arbitrary<int?> GracePeriodArb() =>
        Arb.From(Gen.OneOf(
            Gen.Constant((int?)null),
            Gen.Choose(-5, 100).Select(i => (int?)i)));

    /// <summary>
    /// A small test world for the delete/reverse handlers: a committed (not-yet-deleted) squad with an
    /// active owner and optional extra members and feature flag, plus the shared store and a
    /// soft-delete-aware squad repository that drives the Domain soft-delete mediators exactly as the
    /// persistence pipeline would.
    /// </summary>
    private sealed class DeletionWorld
    {
        public required SquadStore Store { get; init; }

        public required Squad Squad { get; init; }

        public required Guid SquadId { get; init; }

        public required Guid OwnerUserId { get; init; }

        public required SoftDeleteAwareSquadRepository SquadStore { get; init; }

        public required TimeProvider Clock { get; init; }

        public static DeletionWorld Create(DateTimeOffset now, int extraMembers = 0, bool trackingEnabled = false)
        {
            var store = new SquadStore();
            Squad squad = Squad.Create("The Squad").Value!;
            if (trackingEnabled)
            {
                squad.SetFeature(SquadFeature.LiveMatchTracking, true);
            }

            store.AddCommittedSquad(squad);

            Guid ownerUserId = Guid.NewGuid();
            SquadMembership owner = SquadMembership.CreateOwner(squad.Id, ownerUserId, "Owner").Value!;
            store.AddCommittedMembership(owner);

            // Seed a varied roster so the reversal restores a non-trivial pre-deletion state.
            for (int i = 0; i < extraMembers; i++)
            {
                SquadMembership member = SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), $"Member{i}").Value!;
                if (i % 2 == 0)
                {
                    member.PromoteToAdmin();
                }

                if (i % 3 == 0)
                {
                    member.Deactivate();
                }

                store.AddCommittedMembership(member);
            }

            var clock = new SquadFakeClock(now);
            return new DeletionWorld
            {
                Store = store,
                Squad = squad,
                SquadId = squad.Id,
                OwnerUserId = ownerUserId,
                SquadStore = new SoftDeleteAwareSquadRepository(clock),
                Clock = clock,
            };
        }

        public DeleteSquadHandler DeleteHandler() => new(
            new FakeSquadMembershipRepository(Store),
            new FakeSquadRepository(Store),
            SquadStore,
            new FakeSquadUnitOfWork(Store),
            Clock);

        public ReverseSquadDeletionHandler ReverseHandler() => new(
            new FakeSquadMembershipRepository(Store),
            new FakeSquadRepository(Store),
            SquadStore,
            new FakeSquadUnitOfWork(Store));
    }

    /// <summary>
    /// A test world holding a squad that is already soft-deleted and before its purge instant, with an
    /// active owner, an admin, an active member, and a redeemable invite, plus helpers to invoke every
    /// squad action so Property 35 can assert which are rejected and which remain permitted.
    /// </summary>
    private sealed class PendingDeletionWorld
    {
        private const string InviteSecretValue = "invite-secret";

        public required SquadStore Store { get; init; }

        public required Squad Squad { get; init; }

        public required Guid SquadId { get; init; }

        public required Guid OwnerUserId { get; init; }

        public required Guid AdminMembershipId { get; init; }

        public required Guid MemberMembershipId { get; init; }

        public required Guid MemberUserId { get; init; }

        public required Guid InviteId { get; init; }

        public required SoftDeleteAwareSquadRepository SquadStore { get; init; }

        public required FakeInviteSecretService Secrets { get; init; }

        public required TimeProvider Clock { get; init; }

        public static PendingDeletionWorld Create(DateTimeOffset now)
        {
            var store = new SquadStore();
            Squad squad = Squad.Create("The Squad").Value!;

            // Mark the squad soft-deleted before its purge instant: the store marker excludes it from
            // the non-deleted lookup, and the Domain mediator sets IsPendingDeletion just as the
            // persistence pipeline would.
            DateTimeOffset purgeAt = now.AddDays(Squad.DefaultGracePeriodDays);
            squad.MarkForDeletion(purgeAt);
            squad.MarkDeleted(now);
            store.AddCommittedSquad(squad, softDeleted: true);

            Guid ownerUserId = Guid.NewGuid();
            SquadMembership owner = SquadMembership.CreateOwner(squad.Id, ownerUserId, "Owner").Value!;
            store.AddCommittedMembership(owner);

            SquadMembership admin = SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), "Admin").Value!;
            admin.PromoteToAdmin();
            store.AddCommittedMembership(admin);

            Guid memberUserId = Guid.NewGuid();
            SquadMembership member = SquadMembership.CreateRegistered(squad.Id, memberUserId, "Member").Value!;
            store.AddCommittedMembership(member);

            var clock = new SquadFakeClock(now);
            var secrets = new FakeInviteSecretService();

            // A redeemable invite so the revoke/redeem actions have a live target.
            Invite invite = Invite.Create(squad.Id, secrets.Hash(InviteSecretValue), now.AddDays(7));
            store.AddCommittedInvite(invite);

            return new PendingDeletionWorld
            {
                Store = store,
                Squad = squad,
                SquadId = squad.Id,
                OwnerUserId = ownerUserId,
                AdminMembershipId = admin.Id,
                MemberMembershipId = member.Id,
                MemberUserId = memberUserId,
                InviteId = invite.Id,
                SquadStore = new SoftDeleteAwareSquadRepository(clock),
                Secrets = secrets,
                Clock = clock,
            };
        }

        public DomainResult Invoke(PendingAction action)
        {
            var memberships = new FakeSquadMembershipRepository(Store);
            var squads = new FakeSquadRepository(Store);
            var invites = new FakeInviteRepository(Store, Clock);
            var users = new FakeUserRepository(Store);
            var unitOfWork = new FakeSquadUnitOfWork(Store);

            return action switch
            {
                PendingAction.Promote => new PromoteToAdminHandler(
                        memberships,
                        squads,
                        unitOfWork,
                        new FakeNotificationPublisher(),
                        NullLogger<PromoteToAdminHandler>.Instance)
                    .HandleAsync(new PromoteToAdminCommand(OwnerUserId, SquadId, MemberMembershipId), CancellationToken.None)
                    .GetAwaiter().GetResult(),

                PendingAction.Demote => new DemoteToMemberHandler(memberships, unitOfWork)
                    .HandleAsync(new DemoteToMemberCommand(OwnerUserId, SquadId, AdminMembershipId), CancellationToken.None)
                    .GetAwaiter().GetResult(),

                PendingAction.RemoveMember => new RemoveMemberHandler(memberships, unitOfWork)
                    .HandleAsync(new RemoveMemberCommand(OwnerUserId, SquadId, MemberMembershipId), CancellationToken.None)
                    .GetAwaiter().GetResult(),

                PendingAction.Leave => new LeaveSquadHandler(memberships, unitOfWork)
                    .HandleAsync(new LeaveSquadCommand(MemberUserId, SquadId), CancellationToken.None)
                    .GetAwaiter().GetResult(),

                PendingAction.TransferOwnership => new TransferOwnershipHandler(memberships, unitOfWork)
                    .HandleAsync(new TransferOwnershipCommand(OwnerUserId, SquadId, AdminMembershipId), CancellationToken.None)
                    .GetAwaiter().GetResult(),

                PendingAction.GenerateInvite => new GenerateInviteHandler(memberships, invites, Secrets, unitOfWork, Clock, new InviteOptions())
                    .HandleAsync(new GenerateInviteCommand(OwnerUserId, SquadId), CancellationToken.None)
                    .GetAwaiter().GetResult().ToResult(),

                PendingAction.RevokeInvite => new RevokeInviteHandler(memberships, invites, unitOfWork, Clock)
                    .HandleAsync(new RevokeInviteCommand(OwnerUserId, SquadId, InviteId), CancellationToken.None)
                    .GetAwaiter().GetResult(),

                PendingAction.RedeemInvite => new RedeemInviteHandler(
                        invites,
                        memberships,
                        users,
                        squads,
                        Secrets,
                        unitOfWork,
                        Clock,
                        new FakeNotificationPublisher(),
                        NullLogger<RedeemInviteHandler>.Instance)
                    .HandleAsync(new RedeemInviteCommand(Guid.NewGuid(), InviteSecretValue, "NewJoiner"), CancellationToken.None)
                    .GetAwaiter().GetResult().ToResult(),

                PendingAction.SetFeatureFlag => new SetFeatureFlagHandler(squads, memberships, unitOfWork)
                    .HandleAsync(new SetFeatureFlagCommand(OwnerUserId, SquadId, SquadFeature.LiveMatchTracking, true), CancellationToken.None)
                    .GetAwaiter().GetResult(),

                PendingAction.CreateGuest => new CreateGuestHandler(squads, memberships, unitOfWork, Clock)
                    .HandleAsync(new CreateGuestCommand(OwnerUserId, SquadId, "Guesty", null, LawfulBasisAcknowledged: true), CancellationToken.None)
                    .GetAwaiter().GetResult().ToResult(),

                PendingAction.Export => new ExportSquadHandler(memberships, squads, invites, Clock)
                    .HandleAsync(new ExportSquadCommand(OwnerUserId, SquadId), CancellationToken.None)
                    .GetAwaiter().GetResult().ToResult(),

                PendingAction.ReverseDeletion => new ReverseSquadDeletionHandler(memberships, squads, SquadStore, unitOfWork)
                    .HandleAsync(new ReverseSquadDeletionCommand(OwnerUserId, SquadId), CancellationToken.None)
                    .GetAwaiter().GetResult(),

                _ => throw new ArgumentOutOfRangeException(nameof(action), action, "Unhandled pending action."),
            };
        }
    }
}

/// <summary>
/// A soft-delete-aware <see cref="IRepository{Squad}"/> for the deletion property tests. Its
/// <see cref="Remove"/> and <see cref="Restore"/> drive the Domain soft-delete mediators on the squad
/// itself — exactly as the EF save pipeline reinterprets a removal as a soft-delete for
/// <c>ISoftDeletable</c> types — so <see cref="Squad.IsPendingDeletion"/> reflects the staged change.
/// The lookup members are unused by the delete/reverse handlers and are therefore not supported.
/// </summary>
internal sealed class SoftDeleteAwareSquadRepository : IRepository<Squad>
{
    private readonly TimeProvider _clock;

    public SoftDeleteAwareSquadRepository(TimeProvider clock) => _clock = clock;

    public Task AddAsync(Squad entity, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    public Task<Squad?> GetByIdAsync(Guid id, CancellationToken cancellationToken) =>
        throw new NotSupportedException("The delete/reverse handlers load squads via ISquadRepository.");

    public Task<IReadOnlyList<Squad>> ListAsync(CancellationToken cancellationToken) =>
        throw new NotSupportedException();

    public Task<IReadOnlyList<Squad>> ListChronologicalAsync(bool includeDeleted, CancellationToken cancellationToken) =>
        throw new NotSupportedException();

    public void Remove(Squad entity)
    {
        ArgumentNullException.ThrowIfNull(entity);
        entity.MarkDeleted(_clock.GetUtcNow());
    }

    public void Restore(Squad entity)
    {
        ArgumentNullException.ThrowIfNull(entity);
        entity.Restore();
    }
}

/// <summary>
/// Adapts the value-carrying <see cref="DomainResult{T}"/> results returned by some handlers to the
/// valueless <see cref="DomainResult"/> so Property 35 can treat every action's success/failure
/// uniformly, without inspecting the payload.
/// </summary>
internal static class SquadResultExtensions
{
    public static DomainResult ToResult<T>(this Result<T> result) =>
        result.IsSuccess ? DomainResult.Ok() : DomainResult.Fail(result.Error!);
}
