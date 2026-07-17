using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;
using DomainResult = PitchMate.Domain.Squads.Result;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Property-based tests for the membership-lifecycle use cases <see cref="LeaveSquadHandler"/> and
/// <see cref="RemoveMemberHandler"/> (squads-and-membership design Properties 14, 15, 16, and 17).
/// They drive the real handlers against the in-memory squad fakes (no database), per the
/// Application-layer testing strategy. For removals the acting membership is always an active owner
/// (authorised), so these properties isolate lifecycle behaviour; the authorisation gate itself is
/// covered by Properties 8 and 9. Each property runs at least 100 iterations.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class MembershipLifecycleProperties
{
    /// <summary>The lifecycle operation under test.</summary>
    public enum Operation
    {
        Leave,
        Remove
    }

    /// <summary>The kind of subject a leave/remove can act on.</summary>
    public enum SubjectKind
    {
        ActiveMember,
        ActiveAdmin,
        ActiveGuest,
        Owner,
        InactiveMember,
        InactiveAdmin,
        ForeignActiveMember,
        NonExistent
    }

    // Feature: squads-and-membership, Property 14: Leaving and removal deactivate while retaining
    // history - for any leave by an active Member or Admin, and any removal of an active registered or
    // guest membership, the target becomes Inactive with its identity/squad retained; a leave by the
    // Owner and a removal targeting the Owner are rejected and leave the membership Active with role
    // Owner.
    // Validates: Requirements 7.1, 7.2, 8.1, 8.2, 8.3
    [Property(MaxTest = 300)]
    [Trait("Property", "14")]
    public Property Property14_LeaveAndRemovalDeactivateRetainingHistory() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(Enum.GetValues<Operation>())),
            Arb.From(Gen.Elements(new[]
            {
                SubjectKind.ActiveMember,
                SubjectKind.ActiveAdmin,
                SubjectKind.ActiveGuest,
                SubjectKind.Owner,
            })),
            (operation, subjectKind) =>
            {
                // A guest can only be a removal subject (a guest cannot authenticate to leave).
                if (operation == Operation.Leave && subjectKind == SubjectKind.ActiveGuest)
                {
                    return true.ToProperty();
                }

                var world = LifecycleWorld.Create();
                Subject subject = world.BuildSubject(operation, subjectKind);

                Guid? idBefore = subject.Membership?.Id;
                Guid? squadIdBefore = subject.Membership?.SquadId;

                DomainResult result = world.Invoke(operation, subject);

                bool expectedSuccess = subjectKind is SubjectKind.ActiveMember
                    or SubjectKind.ActiveAdmin
                    or SubjectKind.ActiveGuest;

                SquadMembership after = world.Store.FindMembershipById(subject.Membership!.Id)!;

                if (expectedSuccess)
                {
                    // Deactivated in place: state Inactive, row/identity/squad retained (history kept).
                    return (result.IsSuccess
                        && after.State == MembershipState.Inactive
                        && after.Id == idBefore
                        && after.SquadId == squadIdBefore).ToProperty();
                }

                // The owner cannot leave or be removed: rejected, still Active with role Owner.
                return (!result.IsSuccess
                    && after.State == MembershipState.Active
                    && after.Role == SquadRole.Owner).ToProperty();
            });

    // Feature: squads-and-membership, Property 15: Leave and removal are idempotent for inactive
    // memberships - for any membership already Inactive, a further leave or removal reports success
    // and leaves it Inactive and otherwise unchanged.
    // Validates: Requirements 7.3, 8.4
    [Property(MaxTest = 200)]
    [Trait("Property", "15")]
    public Property Property15_LeaveAndRemovalAreIdempotentForInactive() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(Enum.GetValues<Operation>())),
            Arb.From(Gen.Elements(new[] { SubjectKind.InactiveMember, SubjectKind.InactiveAdmin })),
            (operation, subjectKind) =>
            {
                var world = LifecycleWorld.Create();
                Subject subject = world.BuildSubject(operation, subjectKind);

                SquadRole? roleBefore = subject.Membership!.Role;

                DomainResult result = world.Invoke(operation, subject);

                SquadMembership after = world.Store.FindMembershipById(subject.Membership.Id)!;

                // Success, still inactive, role unchanged, and no persistence occurred (no-op).
                return (result.IsSuccess
                    && after.State == MembershipState.Inactive
                    && after.Role == roleBefore
                    && world.Store.SaveCallCount == 0).ToProperty();
            });

    // Feature: squads-and-membership, Property 16: Removing an unknown target is rejected - for any
    // removal whose target identifier does not resolve to a membership in the acting member's squad
    // (unknown id or a membership in a different squad), the request is rejected and no membership
    // changes.
    // Validates: Requirements 8.5
    [Property(MaxTest = 200)]
    [Trait("Property", "16")]
    public Property Property16_RemovingAnUnknownTargetIsRejected() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(new[] { SubjectKind.ForeignActiveMember, SubjectKind.NonExistent })),
            subjectKind =>
            {
                var world = LifecycleWorld.Create();
                Subject subject = world.BuildSubject(Operation.Remove, subjectKind);

                var snapshots = world.Store.Memberships
                    .Select(m => (m.Id, m.Role, m.State))
                    .ToList();

                DomainResult result = world.Invoke(Operation.Remove, subject);

                // Rejected, nothing committed, and every existing membership is unchanged.
                bool allUnchanged = snapshots.All(s =>
                {
                    SquadMembership current = world.Store.FindMembershipById(s.Id)!;
                    return current.Role == s.Role && current.State == s.State;
                });

                return (!result.IsSuccess
                    && allUnchanged
                    && world.Store.SaveCallCount == 0).ToProperty();
            });

    // Feature: squads-and-membership, Property 17: Inactive memberships are excluded but keep their
    // name reserved - for any membership made Inactive by leaving or removal, it is excluded from the
    // squad's active member list, yet its normalised display name remains reserved so another
    // membership cannot take it until the membership is anonymised.
    // Validates: Requirements 7.4, 7.5, 8.6
    [Property(MaxTest = 200)]
    [Trait("Property", "17")]
    public Property Property17_InactiveExcludedButNameReserved() =>
        Prop.ForAll(Arb.From(Gen.Elements(Enum.GetValues<Operation>())), operation =>
        {
            var world = LifecycleWorld.Create();
            Subject subject = world.BuildSubject(operation, SubjectKind.ActiveMember);

            string reservedName = subject.Membership!.DisplayNameNormalized!;

            DomainResult result = world.Invoke(operation, subject);

            var repository = new FakeSquadMembershipRepository(world.Store);

            // Excluded from the active member list once inactive (Requirement 7.4, 8.6).
            IReadOnlyList<SquadMembership> active = repository
                .ListForSquadAsync(world.SquadId, activeOnly: true, CancellationToken.None)
                .GetAwaiter().GetResult();
            bool excludedFromActive = active.All(m => m.Id != subject.Membership.Id);

            // The inactive row still reserves its normalised name against other memberships
            // (Requirement 7.5, 8.6).
            bool nameStillReserved = repository
                .DisplayNameTakenAsync(world.SquadId, reservedName, excludingMembershipId: null, CancellationToken.None)
                .GetAwaiter().GetResult();

            return (result.IsSuccess
                && excludedFromActive
                && nameStillReserved).ToProperty();
        });

    /// <summary>A leave/remove subject: the target membership (if any) and the acting user identity.</summary>
    private sealed record Subject(SquadMembership? Membership, Guid ActingUserId, Guid TargetMembershipId);

    /// <summary>
    /// A small test world: a committed squad plus an active owner, with helpers to build a subject
    /// and invoke the real handler for either operation.
    /// </summary>
    private sealed class LifecycleWorld
    {
        public required SquadStore Store { get; init; }

        public required Guid SquadId { get; init; }

        public required Guid OwnerUserId { get; init; }

        public required SquadMembership Owner { get; init; }

        public static LifecycleWorld Create()
        {
            var store = new SquadStore();
            Squad squad = Squad.Create("The Squad").Value!;
            store.AddCommittedSquad(squad);

            Guid ownerUserId = Guid.NewGuid();
            SquadMembership owner = SquadMembership.CreateOwner(squad.Id, ownerUserId, "Owner").Value!;
            store.AddCommittedMembership(owner);

            return new LifecycleWorld
            {
                Store = store,
                SquadId = squad.Id,
                OwnerUserId = ownerUserId,
                Owner = owner,
            };
        }

        /// <summary>Builds the subject for the requested operation and kind, seeding the store as needed.</summary>
        public Subject BuildSubject(Operation operation, SubjectKind kind)
        {
            switch (kind)
            {
                case SubjectKind.Owner:
                    // For leave, the owner is the acting user; for remove, the owner is the target.
                    return operation == Operation.Leave
                        ? new Subject(Owner, OwnerUserId, Owner.Id)
                        : new Subject(Owner, OwnerUserId, Owner.Id);

                case SubjectKind.ActiveMember:
                    return Registered(operation, "Member", promote: false, inactive: false);

                case SubjectKind.ActiveAdmin:
                    return Registered(operation, "Admin", promote: true, inactive: false);

                case SubjectKind.InactiveMember:
                    return Registered(operation, "Member", promote: false, inactive: true);

                case SubjectKind.InactiveAdmin:
                    return Registered(operation, "Admin", promote: true, inactive: true);

                case SubjectKind.ActiveGuest:
                {
                    SquadMembership guest = SquadMembership
                        .CreateGuest(SquadId, "Guest", skillTier: null, DateTimeOffset.UtcNow).Value!;
                    Store.AddCommittedMembership(guest);
                    // A guest cannot leave; removal is performed by the owner.
                    return new Subject(guest, OwnerUserId, guest.Id);
                }

                case SubjectKind.ForeignActiveMember:
                {
                    // Registered and active, but in a different squad; resolvable by identity only.
                    SquadMembership foreign = SquadMembership
                        .CreateRegistered(Guid.NewGuid(), Guid.NewGuid(), "Foreigner").Value!;
                    Store.AddCommittedMembership(foreign);
                    return new Subject(foreign, OwnerUserId, foreign.Id);
                }

                case SubjectKind.NonExistent:
                    return new Subject(Membership: null, OwnerUserId, Guid.NewGuid());

                default:
                    throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unhandled subject kind.");
            }
        }

        /// <summary>Invokes the real handler for the operation against this world's store.</summary>
        public DomainResult Invoke(Operation operation, Subject subject)
        {
            var memberships = new FakeSquadMembershipRepository(Store);
            var unitOfWork = new FakeSquadUnitOfWork(Store);

            return operation == Operation.Leave
                ? new LeaveSquadHandler(memberships, unitOfWork)
                    .HandleAsync(new LeaveSquadCommand(subject.ActingUserId, SquadId), CancellationToken.None)
                    .GetAwaiter().GetResult()
                : new RemoveMemberHandler(memberships, unitOfWork)
                    .HandleAsync(new RemoveMemberCommand(subject.ActingUserId, SquadId, subject.TargetMembershipId), CancellationToken.None)
                    .GetAwaiter().GetResult();
        }

        private Subject Registered(Operation operation, string name, bool promote, bool inactive)
        {
            Guid userId = Guid.NewGuid();
            SquadMembership membership = SquadMembership.CreateRegistered(SquadId, userId, name).Value!;
            if (promote)
            {
                membership.PromoteToAdmin();
            }

            if (inactive)
            {
                membership.Deactivate();
            }

            Store.AddCommittedMembership(membership);

            // For leave, the subject acts as itself; for remove, the owner acts on the subject.
            return operation == Operation.Leave
                ? new Subject(membership, userId, membership.Id)
                : new Subject(membership, OwnerUserId, membership.Id);
        }
    }
}
