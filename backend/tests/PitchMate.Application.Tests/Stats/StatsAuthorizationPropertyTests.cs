using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Stats;
using PitchMate.Domain.Squads;
using StatsResult = PitchMate.Application.Stats.Result;

namespace PitchMate.Application.Tests.Stats;

/// <summary>
/// Property-based tests for the pure <see cref="StatsAuthorization"/> gate (stats-and-summaries design
/// Property 1: Existence-concealing authorisation).
/// <para>
/// For any requester and any target squad and membership, authorisation succeeds <b>iff</b> the
/// requester holds an <see cref="MembershipState.Active"/> <see cref="SquadMembership"/> in that squad;
/// in every other case — an inactive membership, a non-member (null membership), or a requester whose
/// only membership is in a different squad (also resolved to null here) — the gate returns a single
/// uniform <see cref="StatsErrorCode.Unauthorized"/> failure that is byte-for-byte identical (same
/// <see cref="StatsErrorCode"/> and same message), disclosing neither existence nor any statistical
/// data (Requirement 1.1, 1.2, 1.4, 1.6, 3.6). Each property runs at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "stats-and-summaries")]
public class StatsAuthorizationPropertyTests
{
    /// <summary>The distinct kinds of requester the authorisation gate can be presented with.</summary>
    private enum ActorKind
    {
        ActiveOwner,
        ActiveAdmin,
        ActiveMember,
        ActiveGuest,
        InactiveOwner,
        InactiveAdmin,
        InactiveMember,
        InactiveGuest,

        /// <summary>No membership resolved in the target squad — a non-member, or a member of a different squad.</summary>
        NonMember
    }

    private static readonly ActorKind[] AllKinds = Enum.GetValues<ActorKind>();

    /// <summary>The only kind that is an active member of the target squad and therefore authorised.</summary>
    private static bool IsAuthorised(ActorKind kind) => kind is ActorKind.ActiveOwner
        or ActorKind.ActiveAdmin
        or ActorKind.ActiveMember
        or ActorKind.ActiveGuest;

    // Feature: stats-and-summaries, Property 1: Existence-concealing authorisation - RequireActiveMember
    // succeeds iff the requester holds an Active membership in the target squad; every other requester
    // (an inactive membership, or no membership at all) is rejected with the uniform Unauthorized
    // failure, disclosing nothing about squad or membership existence.
    // Validates: Requirements 1.1, 1.2, 1.4, 1.6, 3.6
    [Property(MaxTest = 100)]
    [Trait("Property", "1")]
    public Property RequireActiveMemberAdmitsOnlyAnActiveMembership() =>
        Prop.ForAll(Arb.From(ActorKindGen()), kind =>
        {
            var requester = Build(kind);

            var result = StatsAuthorization.RequireActiveMember(requester);

            return IsAuthorised(kind)
                ? result.IsSuccess
                : IsUniformUnauthorized(result);
        });

    // Feature: stats-and-summaries, Property 1: Existence-concealing authorisation - every rejected
    // requester, regardless of why it is rejected (inactive of any role, guest, or non-member), yields
    // a byte-for-byte identical StatsError (same code and same message), so no failing case is
    // distinguishable from another and existence is never disclosed.
    // Validates: Requirements 1.2, 1.6, 3.6
    [Property(MaxTest = 100)]
    [Trait("Property", "1")]
    public Property AllFailuresProduceOneIdenticalUniformError() =>
        Prop.ForAll(Arb.From(UnauthorisedKindGen()), kind =>
        {
            // The canonical failure: a non-member (null membership) — the "does not exist" baseline.
            var canonical = StatsAuthorization.RequireActiveMember(null);
            var result = StatsAuthorization.RequireActiveMember(Build(kind));

            return IsUniformUnauthorized(canonical)
                && IsUniformUnauthorized(result)
                // StatsError is a value record: equal code AND equal message across all failing cases.
                && result.Error == canonical.Error;
        });

    private static bool IsUniformUnauthorized(StatsResult result) =>
        !result.IsSuccess && result.Error is { Code: StatsErrorCode.Unauthorized };

    /// <summary>Builds a requester membership in the requested state, or <see langword="null"/> for a non-member.</summary>
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

    /// <summary>Every kind that is not an active member of the target squad, i.e. every kind the gate must reject.</summary>
    private static Gen<ActorKind> UnauthorisedKindGen() =>
        Gen.Elements(AllKinds.Where(k => !IsAuthorised(k)).ToArray());
}
