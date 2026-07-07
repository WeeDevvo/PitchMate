using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Property-based tests for the squad read use cases <see cref="GetSquadHandler"/> and
/// <see cref="ListMySquadsHandler"/> (squads-and-membership design Properties 32 and 33). They drive
/// the real handlers against the in-memory squad fakes (no database), per the Application-layer
/// testing strategy. Each property runs at least 100 iterations.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class SquadReadProperties
{
    /// <summary>The relationship a requesting user can have to the squad whose data they request.</summary>
    public enum ReadScenario
    {
        ActiveMember,
        InactiveMember,
        NonMember,
        ActiveMemberOfDeletedSquad
    }

    // Feature: squads-and-membership, Property 32: Squad data reads are gated to active members - the
    // data is returned only to an authenticated user holding an Active membership in that squad; a
    // requester holding only an Inactive membership or no membership (and a member of a pending-deletion
    // squad) is rejected with a uniform authorisation failure that discloses no squad data and does not
    // reveal whether the squad exists.
    // Validates: Requirements 16.1, 16.2, 13.8
    [Property(MaxTest = 200)]
    [Trait("Property", "32")]
    public Property Property32_SquadDataReadsAreGatedToActiveMembers() =>
        Prop.ForAll(Arb.From(Gen.Elements(Enum.GetValues<ReadScenario>())), scenario =>
        {
            var store = new SquadStore();
            Guid requestingUserId = Guid.NewGuid();

            Squad squad = Squad.Create("The Squad").Value!;
            bool softDeleted = scenario == ReadScenario.ActiveMemberOfDeletedSquad;
            store.AddCommittedSquad(squad, softDeleted);

            // An owner (a different user) gives the squad members to disclose.
            store.AddCommittedMembership(
                SquadMembership.CreateOwner(squad.Id, Guid.NewGuid(), "The Owner").Value!);

            // Add the requesting user's membership according to the scenario.
            switch (scenario)
            {
                case ReadScenario.ActiveMember:
                case ReadScenario.ActiveMemberOfDeletedSquad:
                    store.AddCommittedMembership(
                        SquadMembership.CreateRegistered(squad.Id, requestingUserId, "Requester").Value!);
                    break;

                case ReadScenario.InactiveMember:
                    SquadMembership inactive =
                        SquadMembership.CreateRegistered(squad.Id, requestingUserId, "Requester").Value!;
                    inactive.Deactivate();
                    store.AddCommittedMembership(inactive);
                    break;

                case ReadScenario.NonMember:
                    // No membership for the requesting user.
                    break;
            }

            var handler = new GetSquadHandler(
                new FakeSquadRepository(store),
                new FakeSquadMembershipRepository(store));

            Result<SquadData> result = handler
                .HandleAsync(new GetSquadCommand(requestingUserId, squad.Id), CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            if (scenario == ReadScenario.ActiveMember)
            {
                // The active member is served the squad's data, including its members and features.
                return result.IsSuccess
                    && result.Value!.SquadId == squad.Id
                    && result.Value!.Name == squad.Name
                    && result.Value!.Members.Any(m => m.MembershipId != Guid.Empty)
                    && result.Value!.Features.Count == Enum.GetValues<SquadFeature>().Length;
            }

            // Every other requester is rejected uniformly and receives no squad data.
            return !result.IsSuccess
                && result.Value is null
                && result.Error!.Code == SquadErrorCode.Unauthorized;
        });

    // Feature: squads-and-membership, Property 33: The user's squad list is exactly their non-deleted
    // memberships - listing a user's squads returns exactly the set of squads in which that user holds a
    // membership, excluding soft-deleted squads, and no other squad.
    // Validates: Requirements 16.4
    [Property(MaxTest = 200, Arbitrary = new[] { typeof(SquadListGenerators) })]
    [Trait("Property", "33")]
    public Property Property33_SquadListIsExactlyNonDeletedMemberships(IReadOnlyList<SquadSpec> specs)
    {
        var store = new SquadStore();
        Guid userId = Guid.NewGuid();
        var expected = new HashSet<Guid>();

        foreach (SquadSpec spec in specs)
        {
            Squad squad = Squad.Create("Squad").Value!;
            store.AddCommittedSquad(squad, spec.SoftDeleted);

            if (spec.UserIsMember)
            {
                SquadMembership membership =
                    SquadMembership.CreateRegistered(squad.Id, userId, "Member").Value!;
                if (!spec.ActiveMembership)
                {
                    membership.Deactivate();
                }

                store.AddCommittedMembership(membership);

                // The user holds a membership; the squad is expected unless it is soft-deleted.
                if (!spec.SoftDeleted)
                {
                    expected.Add(squad.Id);
                }
            }
            else
            {
                // Noise: a squad in which only another user is a member must never appear.
                store.AddCommittedMembership(
                    SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), "Other").Value!);
            }
        }

        var handler = new ListMySquadsHandler(
            new FakeSquadRepository(store),
            new FakeSquadMembershipRepository(store));

        Result<IReadOnlyList<MySquadSummary>> result = handler
            .HandleAsync(new ListMySquadsCommand(userId), CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        if (!result.IsSuccess)
        {
            return false.ToProperty();
        }

        var returnedIds = result.Value!.Select(s => s.SquadId).ToList();

        // The returned set equals exactly the user's non-deleted memberships, with no duplicates or extras.
        bool noDuplicates = returnedIds.Count == returnedIds.Distinct().Count();
        bool setMatches = new HashSet<Guid>(returnedIds).SetEquals(expected);

        return (noDuplicates && setMatches).ToProperty();
    }
}

/// <summary>
/// One squad in the squad-list property: whether the user holds a membership in it, whether that
/// membership is active, and whether the squad is soft-deleted.
/// </summary>
/// <param name="UserIsMember">Whether the listing user holds a membership in the squad.</param>
/// <param name="ActiveMembership">Whether the user's membership is active (vs inactive).</param>
/// <param name="SoftDeleted">Whether the squad is soft-deleted (must be excluded from the list).</param>
public sealed record SquadSpec(bool UserIsMember, bool ActiveMembership, bool SoftDeleted);

/// <summary>
/// FsCheck arbitraries for the squad-list property. Generates a small list (0..8) of squad
/// specifications spanning the meaningful combinations — member vs non-member, active vs inactive
/// membership, and deleted vs live — so the returned set can be checked against the user's non-deleted
/// memberships exactly.
/// </summary>
public static class SquadListGenerators
{
    /// <summary>Arbitrary for a list of squad specifications.</summary>
    public static Arbitrary<IReadOnlyList<SquadSpec>> SquadSpecs() => Arb.From(SquadSpecsGen());

    private static Gen<IReadOnlyList<SquadSpec>> SquadSpecsGen() =>
        from count in Gen.Choose(0, 8)
        from specs in ListOfLength(count, SquadSpecGen())
        select (IReadOnlyList<SquadSpec>)specs;

    private static Gen<SquadSpec> SquadSpecGen() =>
        from isMember in Gen.Elements(true, false)
        from active in Gen.Elements(true, false)
        from deleted in Gen.Elements(true, false)
        select new SquadSpec(isMember, active, deleted);

    private static Gen<List<T>> ListOfLength<T>(int length, Gen<T> element)
    {
        if (length <= 0)
        {
            return Gen.Constant(new List<T>());
        }

        return from head in element
               from tail in ListOfLength(length - 1, element)
               select Prepend(head, tail);
    }

    private static List<T> Prepend<T>(T head, List<T> tail)
    {
        var result = new List<T>(tail.Count + 1) { head };
        result.AddRange(tail);
        return result;
    }
}
