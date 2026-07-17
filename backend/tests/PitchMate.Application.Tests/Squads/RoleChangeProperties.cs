using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;
using DomainResult = PitchMate.Domain.Squads.Result;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Property-based tests for the role-management use cases <see cref="PromoteToAdminHandler"/> and
/// <see cref="DemoteToMemberHandler"/> (squads-and-membership design Properties 10 and 11). They drive
/// the real handlers against the in-memory squad fakes (no database), per the Application-layer
/// testing strategy. The acting membership is always an active owner (authorised), so these
/// properties isolate target eligibility and change-isolation; the authorisation gate itself is
/// covered by Properties 8 and 9. Each property runs at least 100 iterations.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class RoleChangeProperties
{
    /// <summary>The role-management operation under test.</summary>
    public enum Operation
    {
        Promote,
        Demote
    }

    /// <summary>The kind of target a promotion/demotion can be pointed at.</summary>
    public enum TargetKind
    {
        ActiveMember,
        ActiveAdmin,
        ActiveGuest,
        InactiveMember,
        InactiveAdmin,
        ForeignActiveMember,
        SelfOwner,
        NonExistent
    }

    // Feature: squads-and-membership, Property 10: Promotion and demotion transition only eligible
    // active members - a promotion succeeds only for an active registered Member (making it Admin) and
    // a demotion succeeds only for an active registered Admin (making it Member); every other target
    // (guest, wrong current role, inactive, owner, foreign-squad, or non-existent) is rejected and left
    // unchanged.
    // Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8
    [Property(MaxTest = 300)]
    [Trait("Property", "10")]
    public Property Property10_TransitionOnlyEligibleActiveMembers() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(Enum.GetValues<Operation>())),
            Arb.From(Gen.Elements(Enum.GetValues<TargetKind>())),
            (operation, targetKind) =>
            {
                var store = new SquadStore();
                Squad squad = Squad.Create("The Squad").Value!;
                store.AddCommittedSquad(squad);

                Guid actingUserId = Guid.NewGuid();
                SquadMembership owner = SquadMembership.CreateOwner(squad.Id, actingUserId, "Owner").Value!;
                store.AddCommittedMembership(owner);

                Guid targetId = BuildTarget(store, squad.Id, owner, targetKind);

                SquadMembership? before = store.FindMembershipById(targetId);
                SquadRole? roleBefore = before?.Role;
                MembershipState? stateBefore = before?.State;

                DomainResult result = Invoke(store, operation, actingUserId, squad.Id, targetId);

                bool expectedSuccess = (operation, targetKind) switch
                {
                    (Operation.Promote, TargetKind.ActiveMember) => true,
                    (Operation.Demote, TargetKind.ActiveAdmin) => true,
                    _ => false,
                };

                SquadMembership? after = store.FindMembershipById(targetId);

                if (expectedSuccess)
                {
                    SquadRole expectedRole = operation == Operation.Promote ? SquadRole.Admin : SquadRole.Member;

                    // The transition applied to the target, which stays active, and the save committed once.
                    return result.IsSuccess
                        && after is not null
                        && after.Role == expectedRole
                        && after.State == MembershipState.Active;
                }

                // Every ineligible target is rejected and left exactly as it was (Requirement 5.8).
                bool unchanged = after is null
                    ? before is null // non-existent target: nothing was created
                    : after.Role == roleBefore && after.State == stateBefore;

                return !result.IsSuccess && unchanged;
            });

    // Feature: squads-and-membership, Property 11: A successful role change touches only the target -
    // when a promotion or demotion succeeds, every other membership in the squad (and in other squads)
    // retains its role and state; only the target's role changes.
    // Validates: Requirements 5.1, 5.3, 5.8
    [Property(MaxTest = 200)]
    [Trait("Property", "11")]
    public Property Property11_SuccessfulChangeTouchesOnlyTheTarget() =>
        Prop.ForAll(Arb.From(Gen.Elements(Enum.GetValues<Operation>())), operation =>
        {
            var store = new SquadStore();
            Squad squad = Squad.Create("The Squad").Value!;
            store.AddCommittedSquad(squad);

            Guid actingUserId = Guid.NewGuid();
            SquadMembership owner = SquadMembership.CreateOwner(squad.Id, actingUserId, "Owner").Value!;
            store.AddCommittedMembership(owner);

            // The target is chosen to make the operation succeed.
            SquadMembership target = operation == Operation.Promote
                ? SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), "Target").Value!
                : Admin(squad.Id, "Target");
            store.AddCommittedMembership(target);

            // Bystanders whose role/state must be untouched by the change.
            var bystanders = new List<SquadMembership>
            {
                SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), "Member A").Value!,
                Admin(squad.Id, "Admin B"),
                SquadMembership.CreateGuest(squad.Id, "Guest C", skillTier: null, DateTimeOffset.UtcNow).Value!,
                Inactive(SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), "Left D").Value!),
                // A member of a different squad must also be untouched.
                SquadMembership.CreateRegistered(Guid.NewGuid(), Guid.NewGuid(), "Elsewhere E").Value!,
            };
            foreach (SquadMembership bystander in bystanders)
            {
                store.AddCommittedMembership(bystander);
            }

            var snapshots = bystanders
                .Concat(new[] { owner })
                .Select(m => (m.Id, m.Role, m.State))
                .ToList();

            DomainResult result = Invoke(store, operation, actingUserId, squad.Id, target.Id);

            SquadRole expectedRole = operation == Operation.Promote ? SquadRole.Admin : SquadRole.Member;
            bool targetChanged = result.IsSuccess
                && store.FindMembershipById(target.Id)!.Role == expectedRole;

            bool othersUnchanged = snapshots.All(s =>
            {
                SquadMembership current = store.FindMembershipById(s.Id)!;
                return current.Role == s.Role && current.State == s.State;
            });

            return (targetChanged && othersUnchanged).ToProperty();
        });

    private static DomainResult Invoke(SquadStore store, Operation operation, Guid actingUserId, Guid squadId, Guid targetId)
    {
        var memberships = new FakeSquadMembershipRepository(store);
        var unitOfWork = new FakeSquadUnitOfWork(store);

        return operation == Operation.Promote
            ? new PromoteToAdminHandler(memberships, unitOfWork)
                .HandleAsync(new PromoteToAdminCommand(actingUserId, squadId, targetId), CancellationToken.None)
                .GetAwaiter().GetResult()
            : new DemoteToMemberHandler(memberships, unitOfWork)
                .HandleAsync(new DemoteToMemberCommand(actingUserId, squadId, targetId), CancellationToken.None)
                .GetAwaiter().GetResult();
    }

    /// <summary>Builds the target for the requested kind, stages it in the store, and returns its identity.</summary>
    private static Guid BuildTarget(SquadStore store, Guid squadId, SquadMembership owner, TargetKind kind)
    {
        switch (kind)
        {
            case TargetKind.ActiveMember:
                return Add(store, SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), "Member").Value!);

            case TargetKind.ActiveAdmin:
                return Add(store, Admin(squadId, "Admin"));

            case TargetKind.ActiveGuest:
                return Add(store, SquadMembership.CreateGuest(squadId, "Guest", skillTier: null, DateTimeOffset.UtcNow).Value!);

            case TargetKind.InactiveMember:
                return Add(store, Inactive(SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), "Member").Value!));

            case TargetKind.InactiveAdmin:
                return Add(store, Inactive(Admin(squadId, "Admin")));

            case TargetKind.ForeignActiveMember:
                // A member of a different squad; resolvable by identity but not of the acting squad.
                return Add(store, SquadMembership.CreateRegistered(Guid.NewGuid(), Guid.NewGuid(), "Foreigner").Value!);

            case TargetKind.SelfOwner:
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

    private static SquadMembership Admin(Guid squadId, string name)
    {
        SquadMembership member = SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), name).Value!;
        member.PromoteToAdmin();
        return member;
    }

    private static SquadMembership Inactive(SquadMembership membership)
    {
        membership.Deactivate();
        return membership;
    }
}
