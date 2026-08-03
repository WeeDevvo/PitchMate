using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Matches;
using PitchMate.Domain.Squads;
using GateResult = PitchMate.Domain.Matches.Result;
using MatchErrorCode = PitchMate.Domain.Matches.MatchErrorCode;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// Property-based tests for the pure <see cref="MatchAuthorization"/> gate (match-lifecycle design
/// Property 19 and Requirement 14). Organising actions require an active registered owner or admin;
/// squad-scoped reads require any active member. Every rejection returns the same uniform
/// <see cref="MatchErrorCode.Unauthorized"/> failure — so it never discloses the actor's role or
/// whether the squad or match exists — and, because the gate is pure, leaves the acting membership's
/// role and state unchanged. Each property runs at least 100 iterations.
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class MatchAuthorizationPropertyTests
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

    // Feature: match-lifecycle, Requirement 14.1, 14.2: organising actions require an active owner or
    // admin - RequireOrganiser succeeds only for an active registered owner or admin; every other
    // actor (member, inactive membership, guest, or non-member) is rejected with the uniform
    // Unauthorized failure.
    // Validates: Requirements 14.1, 14.2
    [Property(MaxTest = 200)]
    public Property OrganiserGateAdmitsOnlyActiveOwnerOrAdmin() =>
        Prop.ForAll(Arb.From(ActorKindGen()), kind =>
        {
            var acting = Build(kind);

            var result = MatchAuthorization.RequireOrganiser(acting);

            var authorised = kind is ActorKind.ActiveOwner or ActorKind.ActiveAdmin;
            return authorised
                ? result.IsSuccess
                : IsUniformUnauthorized(result);
        });

    // Feature: match-lifecycle, Requirement 14.1, 14.2: a rejected organising action leaves the acting
    // membership's role and state unchanged (the gate is pure).
    // Validates: Requirements 14.1, 14.2
    [Property(MaxTest = 200)]
    public Property OrganiserGateRejectionLeavesActingUnchanged() =>
        Prop.ForAll(Arb.From(UnauthorisedForOrganiserGen()), kind =>
        {
            var acting = Build(kind);
            var (roleBefore, stateBefore) = Snapshot(acting);

            var result = MatchAuthorization.RequireOrganiser(acting);
            var (roleAfter, stateAfter) = Snapshot(acting);

            return IsUniformUnauthorized(result)
                && roleBefore == roleAfter
                && stateBefore == stateAfter;
        });

    // Feature: match-lifecycle, Requirement 14.3, 14.4: squad-scoped reads require an active member -
    // RequireActiveMember succeeds for any active membership (owner, admin, member, or guest); an
    // inactive membership or a non-member is rejected with the uniform Unauthorized failure so the
    // rejection conceals whether the match exists.
    // Validates: Requirements 14.3, 14.4
    [Property(MaxTest = 200)]
    public Property ActiveMemberGateAdmitsAnyActiveMember() =>
        Prop.ForAll(Arb.From(ActorKindGen()), kind =>
        {
            var acting = Build(kind);

            var result = MatchAuthorization.RequireActiveMember(acting);

            var authorised = kind is ActorKind.ActiveOwner
                or ActorKind.ActiveAdmin
                or ActorKind.ActiveMember
                or ActorKind.ActiveGuest;
            return authorised
                ? result.IsSuccess
                : IsUniformUnauthorized(result);
        });

    // Feature: match-lifecycle, Requirement 14.1, 14.2, 14.3, 14.4: gated actions never disclose
    // existence - all rejected actors, across both gates, yield an identical Unauthorized error code
    // and message, so a failure reveals neither the actor's role nor whether the squad or match exists.
    // Validates: Requirements 14.1, 14.2, 14.3, 14.4
    [Property(MaxTest = 200)]
    public Property RejectionsAreIndistinguishable() =>
        Prop.ForAll(Arb.From(ActorKindGen()), Arb.From(ActorKindGen()), (organiserKind, readerKind) =>
        {
            var organiserRejection = MatchAuthorization.RequireOrganiser(Build(organiserKind));
            var readerRejection = MatchAuthorization.RequireActiveMember(Build(readerKind));

            // Only compare the cases that actually fail; successes are covered by the gates above.
            if (organiserRejection.IsSuccess || readerRejection.IsSuccess)
            {
                return true;
            }

            return organiserRejection.Error!.Code == MatchErrorCode.Unauthorized
                && readerRejection.Error!.Code == MatchErrorCode.Unauthorized
                && organiserRejection.Error!.Message == readerRejection.Error!.Message;
        });

    private static bool IsUniformUnauthorized(GateResult result) =>
        !result.IsSuccess && result.Error!.Code == MatchErrorCode.Unauthorized;

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

    /// <summary>Kinds that are not an active owner or admin, i.e. every kind the organiser gate must reject.</summary>
    private static Gen<ActorKind> UnauthorisedForOrganiserGen() =>
        Gen.Elements(AllKinds.Where(k => k is not (ActorKind.ActiveOwner or ActorKind.ActiveAdmin)).ToArray());
}
