using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;
using DomainResult = PitchMate.Domain.Squads.Result;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Property-based test for <see cref="TransferOwnershipHandler"/> (squads-and-membership design
/// Property 13, in-memory portion; the atomic-rollback and single-owner-index DB portion is task
/// 18.5 against Testcontainers PostgreSQL). It drives the real handler against the in-memory squad
/// fakes (no database), per the Application-layer testing strategy. Each property runs at least 100
/// iterations.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class OwnershipTransferProperties
{
    /// <summary>The relationship the acting user has to the squad when requesting a transfer.</summary>
    public enum ActorKind
    {
        Owner,
        Admin,
        Member,
        InactiveAdmin,
        NonMember
    }

    /// <summary>The kind of target an ownership transfer can be pointed at.</summary>
    public enum TargetKind
    {
        ActiveAdmin,
        ActiveMember,
        ActiveGuest,
        InactiveAdmin,
        ForeignActiveMember,
        Self,
        NonExistent
    }

    // Feature: squads-and-membership, Property 13: Ownership transfer is an atomic owner/admin swap -
    // when the active owner transfers to an active registered target in the same squad, the target
    // becomes Owner and the former owner becomes Admin together in a single commit, leaving exactly one
    // owner; any non-owner actor, or a non-existent/guest/inactive/foreign/self target, is rejected with
    // no change and the original owner retained.
    // Validates: Requirements 6.2, 6.3, 6.4
    [Property(MaxTest = 400)]
    [Trait("Property", "13")]
    public Property Property13_OwnershipTransferIsAtomicOwnerAdminSwap() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(Enum.GetValues<ActorKind>())),
            Arb.From(Gen.Elements(Enum.GetValues<TargetKind>())),
            (actorKind, targetKind) =>
            {
                var store = new SquadStore();
                Squad squad = Squad.Create("The Squad").Value!;
                store.AddCommittedSquad(squad);

                Guid ownerUserId = Guid.NewGuid();
                SquadMembership owner = SquadMembership.CreateOwner(squad.Id, ownerUserId, "Owner").Value!;
                store.AddCommittedMembership(owner);

                Guid actingUserId = BuildActor(store, squad.Id, ownerUserId, actorKind);
                Guid targetId = BuildTarget(store, squad.Id, owner, targetKind);

                // Snapshot every membership so a rejection can be shown to change nothing.
                var snapshots = store.Memberships
                    .Select(m => (m.Id, m.Role, m.State))
                    .ToList();

                var handler = new TransferOwnershipHandler(
                    new FakeSquadMembershipRepository(store),
                    new FakeSquadUnitOfWork(store));

                DomainResult result = handler
                    .HandleAsync(new TransferOwnershipCommand(actingUserId, squad.Id, targetId), CancellationToken.None)
                    .GetAwaiter()
                    .GetResult();

                bool expectedSuccess = actorKind == ActorKind.Owner
                    && targetKind is TargetKind.ActiveAdmin or TargetKind.ActiveMember;

                if (expectedSuccess)
                {
                    SquadMembership formerOwner = store.FindMembershipById(owner.Id)!;
                    SquadMembership newOwner = store.FindMembershipById(targetId)!;

                    int ownerCount = store
                        .ListMembershipsForSquad(squad.Id, activeOnly: false)
                        .Count(m => m.Role == SquadRole.Owner);

                    // The swap applied atomically: target is Owner, former owner is Admin, exactly one
                    // owner remains, and the pair committed in a single save (Requirement 6.1, 6.2).
                    return result.IsSuccess
                        && newOwner.Role == SquadRole.Owner
                        && newOwner.State == MembershipState.Active
                        && formerOwner.Role == SquadRole.Admin
                        && ownerCount == 1
                        && store.SaveCallCount == 1;
                }

                // Every rejected request leaves all memberships unchanged, keeps the original owner, and
                // never reaches the commit (Requirement 6.3, 6.4, 6.5).
                bool allUnchanged = snapshots.All(s =>
                {
                    SquadMembership current = store.FindMembershipById(s.Id)!;
                    return current.Role == s.Role && current.State == s.State;
                });

                bool originalOwnerRetained = store.FindMembershipById(owner.Id)!.Role == SquadRole.Owner;

                return !result.IsSuccess
                    && allUnchanged
                    && originalOwnerRetained
                    && store.SaveCallCount == 0;
            });

    /// <summary>Builds the acting user's relationship to the squad and returns the acting user identity.</summary>
    private static Guid BuildActor(SquadStore store, Guid squadId, Guid ownerUserId, ActorKind kind)
    {
        switch (kind)
        {
            case ActorKind.Owner:
                return ownerUserId;

            case ActorKind.Admin:
            {
                Guid userId = Guid.NewGuid();
                SquadMembership admin = SquadMembership.CreateRegistered(squadId, userId, "Admin actor").Value!;
                admin.PromoteToAdmin();
                store.AddCommittedMembership(admin);
                return userId;
            }

            case ActorKind.Member:
            {
                Guid userId = Guid.NewGuid();
                store.AddCommittedMembership(
                    SquadMembership.CreateRegistered(squadId, userId, "Member actor").Value!);
                return userId;
            }

            case ActorKind.InactiveAdmin:
            {
                Guid userId = Guid.NewGuid();
                SquadMembership admin = SquadMembership.CreateRegistered(squadId, userId, "Inactive actor").Value!;
                admin.PromoteToAdmin();
                admin.Deactivate();
                store.AddCommittedMembership(admin);
                return userId;
            }

            case ActorKind.NonMember:
                return Guid.NewGuid();

            default:
                throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unhandled actor kind.");
        }
    }

    /// <summary>Builds the transfer target for the requested kind, stages it, and returns its identity.</summary>
    private static Guid BuildTarget(SquadStore store, Guid squadId, SquadMembership owner, TargetKind kind)
    {
        switch (kind)
        {
            case TargetKind.ActiveAdmin:
            {
                SquadMembership admin = SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), "Admin target").Value!;
                admin.PromoteToAdmin();
                return Add(store, admin);
            }

            case TargetKind.ActiveMember:
                return Add(store, SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), "Member target").Value!);

            case TargetKind.ActiveGuest:
                return Add(store, SquadMembership.CreateGuest(squadId, "Guest target", skillTier: null, DateTimeOffset.UtcNow).Value!);

            case TargetKind.InactiveAdmin:
            {
                SquadMembership admin = SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), "Inactive target").Value!;
                admin.PromoteToAdmin();
                admin.Deactivate();
                return Add(store, admin);
            }

            case TargetKind.ForeignActiveMember:
                // Registered and active, but in a different squad; resolvable by identity only.
                return Add(store, SquadMembership.CreateRegistered(Guid.NewGuid(), Guid.NewGuid(), "Foreign target").Value!);

            case TargetKind.Self:
                return owner.Id;

            case TargetKind.NonExistent:
                return Guid.NewGuid();

            default:
                throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unhandled target kind.");
        }
    }

    private static Guid Add(SquadStore store, SquadMembership membership)
    {
        store.AddCommittedMembership(membership);
        return membership.Id;
    }
}
