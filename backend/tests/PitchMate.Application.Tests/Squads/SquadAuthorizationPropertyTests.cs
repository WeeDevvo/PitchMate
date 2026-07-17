using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Squads;
using PitchMate.Domain.Squads;
using DomainResult = PitchMate.Domain.Squads.Result;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Property-based tests for the pure <see cref="SquadAuthorization"/> gate (squads-and-membership
/// design Properties 8 and 9). Admin-only actions require an active owner or admin; owner-only actions
/// require the active owner. Every rejection returns the same uniform
/// <see cref="SquadErrorCode.Unauthorized"/> failure — so it never discloses the actor's role or
/// whether the squad exists — and, because the gate is pure, leaves the acting membership's role and
/// state unchanged. Each property runs at least 100 iterations.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class SquadAuthorizationPropertyTests
{
    /// <summary>The distinct kinds of actor an authorisation gate can be presented with.</summary>
    private enum ActorKind
    {
        ActiveOwner,
        ActiveAdmin,
        ActiveMember,
        InactiveOwner,
        InactiveAdmin,
        InactiveMember,
        ActiveGuest,
        InactiveGuest,
        NonMember
    }

    private static readonly ActorKind[] AllKinds = Enum.GetValues<ActorKind>();

    // Feature: squads-and-membership, Property 8: Admin-only actions are gated - RequireOwnerOrAdmin
    // succeeds only for an active owner or admin; every other actor (member, inactive membership,
    // guest, or non-member) is rejected with the uniform Unauthorized failure.
    // Validates: Requirements 4.2, 4.3, 4.6, 4.7, 10.8, 12.7, 13.7, 14.2, 17.6
    [Property(MaxTest = 200)]
    [Trait("Property", "8")]
    public Property AdminGateAdmitsOnlyActiveOwnerOrAdmin() =>
        Prop.ForAll(Arb.From(ActorKindGen()), kind =>
        {
            var acting = Build(kind);

            var result = SquadAuthorization.RequireOwnerOrAdmin(acting);

            var authorised = kind is ActorKind.ActiveOwner or ActorKind.ActiveAdmin;
            return authorised
                ? result.IsSuccess
                : IsUniformUnauthorized(result);
        });

    // Feature: squads-and-membership, Property 8: Admin-only actions are gated - a rejected admin-only
    // action leaves the acting membership's role and state unchanged (the gate is pure).
    // Validates: Requirements 4.2, 4.3, 4.6, 4.7
    [Property(MaxTest = 200)]
    [Trait("Property", "8")]
    public Property AdminGateRejectionLeavesActingUnchanged() =>
        Prop.ForAll(Arb.From(UnauthorisedForAdminGen()), kind =>
        {
            var acting = Build(kind);
            var (roleBefore, stateBefore) = Snapshot(acting);

            var result = SquadAuthorization.RequireOwnerOrAdmin(acting);
            var (roleAfter, stateAfter) = Snapshot(acting);

            return IsUniformUnauthorized(result)
                && roleBefore == roleAfter
                && stateBefore == stateAfter;
        });

    // Feature: squads-and-membership, Property 9: Owner-only actions are gated - RequireOwner succeeds
    // only for the active owner; every other actor (admin, member, inactive membership, guest, or
    // non-member) is rejected with the uniform Unauthorized failure.
    // Validates: Requirements 4.4, 4.5, 6.5, 17.6
    [Property(MaxTest = 200)]
    [Trait("Property", "9")]
    public Property OwnerGateAdmitsOnlyActiveOwner() =>
        Prop.ForAll(Arb.From(ActorKindGen()), kind =>
        {
            var acting = Build(kind);

            var result = SquadAuthorization.RequireOwner(acting);

            return kind is ActorKind.ActiveOwner
                ? result.IsSuccess
                : IsUniformUnauthorized(result);
        });

    // Feature: squads-and-membership, Property 9: Owner-only actions are gated - a rejected owner-only
    // action leaves the acting membership's role and state unchanged (the gate is pure).
    // Validates: Requirements 4.4, 4.5, 6.5, 17.6
    [Property(MaxTest = 200)]
    [Trait("Property", "9")]
    public Property OwnerGateRejectionLeavesActingUnchanged() =>
        Prop.ForAll(Arb.From(UnauthorisedForOwnerGen()), kind =>
        {
            var acting = Build(kind);
            var (roleBefore, stateBefore) = Snapshot(acting);

            var result = SquadAuthorization.RequireOwner(acting);
            var (roleAfter, stateAfter) = Snapshot(acting);

            return IsUniformUnauthorized(result)
                && roleBefore == roleAfter
                && stateBefore == stateAfter;
        });

    // Feature: squads-and-membership, Properties 8 and 9: gated actions never disclose existence - all
    // rejected actors, across both gates, yield an identical Unauthorized error code and message, so a
    // failure reveals neither the actor's role nor whether the squad exists.
    // Validates: Requirements 4.3, 4.5, 4.6, 4.7, 16.2
    [Property(MaxTest = 200)]
    [Trait("Property", "8")]
    [Trait("Property", "9")]
    public Property RejectionsAreIndistinguishable() =>
        Prop.ForAll(Arb.From(ActorKindGen()), Arb.From(ActorKindGen()), (adminKind, ownerKind) =>
        {
            var adminRejection = SquadAuthorization.RequireOwnerOrAdmin(Build(adminKind));
            var ownerRejection = SquadAuthorization.RequireOwner(Build(ownerKind));

            // Only compare the cases that actually fail; successes are covered by the gates above.
            if (adminRejection.IsSuccess || ownerRejection.IsSuccess)
            {
                return true;
            }

            return adminRejection.Error!.Code == SquadErrorCode.Unauthorized
                && ownerRejection.Error!.Code == SquadErrorCode.Unauthorized
                && adminRejection.Error!.Message == ownerRejection.Error!.Message;
        });

    private static bool IsUniformUnauthorized(DomainResult result) =>
        !result.IsSuccess && result.Error!.Code == SquadErrorCode.Unauthorized;

    private static (SquadRole? Role, MembershipState? State) Snapshot(SquadMembership? acting) =>
        acting is null ? (null, null) : (acting.Role, acting.State);

    /// <summary>Builds an acting membership in the requested state, or <see langword="null"/> for a non-member.</summary>
    private static SquadMembership? Build(ActorKind kind)
    {
        switch (kind)
        {
            case ActorKind.NonMember:
                return null;

            case ActorKind.ActiveOwner:
                return Owner();

            case ActorKind.InactiveOwner:
                var inactiveOwner = Owner();
                inactiveOwner.Deactivate();
                return inactiveOwner;

            case ActorKind.ActiveAdmin:
                return Admin();

            case ActorKind.InactiveAdmin:
                var inactiveAdmin = Admin();
                inactiveAdmin.Deactivate();
                return inactiveAdmin;

            case ActorKind.ActiveMember:
                return Member();

            case ActorKind.InactiveMember:
                var inactiveMember = Member();
                inactiveMember.Deactivate();
                return inactiveMember;

            case ActorKind.ActiveGuest:
                return Guest();

            case ActorKind.InactiveGuest:
                var inactiveGuest = Guest();
                inactiveGuest.Deactivate();
                return inactiveGuest;

            default:
                throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unhandled actor kind.");
        }
    }

    private static SquadMembership Owner() =>
        SquadMembership.CreateOwner(Guid.NewGuid(), Guid.NewGuid(), "Owner").Value!;

    private static SquadMembership Admin()
    {
        var member = SquadMembership.CreateRegistered(Guid.NewGuid(), Guid.NewGuid(), "Admin").Value!;
        member.PromoteToAdmin();
        return member;
    }

    private static SquadMembership Member() =>
        SquadMembership.CreateRegistered(Guid.NewGuid(), Guid.NewGuid(), "Member").Value!;

    private static SquadMembership Guest() =>
        SquadMembership.CreateGuest(Guid.NewGuid(), "Guest", skillTier: null, DateTimeOffset.UtcNow).Value!;

    private static Gen<ActorKind> ActorKindGen() => Gen.Elements(AllKinds);

    /// <summary>Kinds that are not an active owner or admin, i.e. every kind an admin-only gate must reject.</summary>
    private static Gen<ActorKind> UnauthorisedForAdminGen() =>
        Gen.Elements(AllKinds.Where(k => k is not (ActorKind.ActiveOwner or ActorKind.ActiveAdmin)).ToArray());

    /// <summary>Kinds that are not the active owner, i.e. every kind an owner-only gate must reject.</summary>
    private static Gen<ActorKind> UnauthorisedForOwnerGen() =>
        Gen.Elements(AllKinds.Where(k => k is not ActorKind.ActiveOwner).ToArray());
}
