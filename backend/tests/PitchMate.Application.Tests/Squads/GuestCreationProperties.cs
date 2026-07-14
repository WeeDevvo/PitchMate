using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;
using SkillTier = PitchMate.Domain.Rating.SkillTier;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Property-based test for <see cref="CreateGuestHandler"/> covering guest creation
/// (squads-and-membership design Property 29). It drives the real handler against the in-memory squad
/// fakes (no database), per the Application-layer testing strategy.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class GuestCreationProperties
{
    private static readonly DateTimeOffset Now = new(2026, 1, 15, 9, 30, 0, TimeSpan.Zero);

    // Feature: squads-and-membership, Property 29: Guest creation records a compliant, seeded, audited
    // guest - for any guest creation by an active owner or admin with a unique display name of trimmed
    // length 1..50 and a recorded lawful-basis acknowledgement, exactly one active guest membership is
    // created with no user reference and no role, storing the supplied SkillTier when one is given and
    // none otherwise, recording the acknowledgement instant read from the clock, and persisting
    // atomically with a single save; a creation missing the lawful-basis acknowledgement is rejected
    // and creates no membership.
    // Validates: Requirements 14.1, 14.4, 14.5, 14.7, 14.10
    [Property(MaxTest = 200, Arbitrary = new[] { typeof(GuestCreationGenerators) })]
    [Trait("Property", "29")]
    public Property Property29_GuestCreationRecordsCompliantSeededAuditedGuest(GuestCreationInput input)
    {
        var store = new SquadStore();
        Squad squad = Squad.Create("The Squad").Value!;
        store.AddCommittedSquad(squad);

        // Seed the acting owner or admin so authorisation passes for a valid creation.
        Guid actingUserId = Guid.NewGuid();
        SquadMembership acting = input.ActorIsOwner
            ? SquadMembership.CreateOwner(squad.Id, actingUserId, "Boss").Value!
            : SquadMembership.CreateRegistered(squad.Id, actingUserId, "Gaffer").Value!;
        if (!input.ActorIsOwner)
        {
            acting.PromoteToAdmin();
        }

        store.AddCommittedMembership(acting);

        var handler = new CreateGuestHandler(
            new FakeSquadRepository(store),
            new FakeSquadMembershipRepository(store),
            new FakeSquadUnitOfWork(store),
            new SquadFakeClock(Now));

        Result<CreateGuestResult> result = handler
            .HandleAsync(
                new CreateGuestCommand(
                    actingUserId,
                    squad.Id,
                    input.SuppliedDisplayName,
                    input.SkillTier,
                    input.LawfulBasisAcknowledged),
                CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        SquadMembership? guest = store.Memberships.SingleOrDefault(m => m.IsGuest);

        if (!input.LawfulBasisAcknowledged)
        {
            // A creation missing the lawful-basis acknowledgement is rejected and creates no guest
            // (Requirement 14.4).
            bool rejected = !result.IsSuccess
                && result.Error!.Code == SquadErrorCode.ValidationFailed
                && guest is null
                && store.SaveCallCount == 0;
            return rejected.ToProperty();
        }

        // Creation succeeded, persisting exactly one guest membership atomically (Requirement 14.1).
        bool succeeded = result.IsSuccess;
        bool exactlyOneGuest = guest is not null;
        bool singleSave = store.SaveCallCount == 1;

        // The guest is active, is a guest with no user reference and no role (Requirement 14.1).
        bool guestShape = guest is not null
            && guest.IsGuest
            && guest.State == MembershipState.Active
            && guest.UserId is null
            && guest.Role is null
            && guest.SquadId == squad.Id
            && result.Value!.GuestMembershipId == guest.Id;

        // The trimmed display name and optional skill-tier seed are recorded exactly
        // (Requirement 14.5, 14.7).
        bool nameMatches = guest is not null && guest.DisplayName == input.ExpectedDisplayName;
        bool tierMatches = guest is not null && guest.SkillTier == input.SkillTier;

        // The lawful-basis acknowledgement instant is recorded from the clock (Requirement 14.10).
        bool acknowledgementStamped = guest is not null && guest.LawfulBasisAcknowledgedAt == Now;

        return (succeeded
            && exactlyOneGuest
            && singleSave
            && guestShape
            && nameMatches
            && tierMatches
            && acknowledgementStamped).ToProperty();
    }
}

/// <summary>
/// A single guest-creation input for Property 29. It carries whether the acting requester is the owner
/// or an admin, the raw (whitespace-decorated) supplied display name and the trimmed value the guest
/// should store, an optional skill-tier seed (<see langword="null"/> exercises the no-seed branch), and
/// whether the lawful-basis acknowledgement is recorded (<see langword="false"/> exercises the
/// rejection branch).
/// </summary>
/// <param name="ActorIsOwner">Whether the acting requester is the owner (otherwise an admin).</param>
/// <param name="SuppliedDisplayName">A raw display name whose trimmed length is 1..50, possibly padded with whitespace.</param>
/// <param name="ExpectedDisplayName">The trimmed display name the guest membership should store.</param>
/// <param name="SkillTier">An optional cold-start skill-tier seed, or <see langword="null"/> for none.</param>
/// <param name="LawfulBasisAcknowledged">Whether the lawful-basis acknowledgement is recorded.</param>
public sealed record GuestCreationInput(
    bool ActorIsOwner,
    string SuppliedDisplayName,
    string ExpectedDisplayName,
    SkillTier? SkillTier,
    bool LawfulBasisAcknowledged);

/// <summary>
/// FsCheck arbitraries for Property 29. Smart generators constrain inputs to the valid space: an
/// owner-or-admin actor, a display name of trimmed length 1..50 decorated with surrounding whitespace
/// (so trimming has an observable effect), an optional skill tier drawn from the defined values or
/// none, and a lawful-basis acknowledgement flag that exercises both the success and the rejection
/// branch.
/// </summary>
public static class GuestCreationGenerators
{
    private static readonly char[] Alphabet =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".ToCharArray();

    /// <summary>Arbitrary for a single guest-creation input.</summary>
    public static Arbitrary<GuestCreationInput> GuestCreationInput() => Arb.From(GuestCreationInputGen());

    private static Gen<GuestCreationInput> GuestCreationInputGen() =>
        from actorIsOwner in Gen.Elements(true, false)
        from core in Core(1, 50)
        from decorated in Decorate(Gen.Constant(core))
        from tier in TierGen()
        from acknowledged in Gen.Elements(true, false)
        select new GuestCreationInput(actorIsOwner, decorated, core, tier, acknowledged);

    /// <summary>Generates a defined <see cref="SkillTier"/> value or <see langword="null"/> for no seed.</summary>
    private static Gen<SkillTier?> TierGen() =>
        Gen.Elements<SkillTier?>(null, SkillTier.Beginner, SkillTier.Average, SkillTier.Strong);

    /// <summary>A non-empty token of <paramref name="minLength"/>..<paramref name="maxLength"/> letters/digits (no surrounding whitespace).</summary>
    private static Gen<string> Core(int minLength, int maxLength) =>
        from length in Gen.Choose(minLength, maxLength)
        from chars in ListOfLength(length, Gen.Elements(Alphabet))
        select new string(chars.ToArray());

    /// <summary>Adds 0..3 leading and trailing spaces around a core so trimming has an observable effect.</summary>
    private static Gen<string> Decorate(Gen<string> core) =>
        from value in core
        from lead in Gen.Choose(0, 3)
        from trail in Gen.Choose(0, 3)
        select new string(' ', lead) + value + new string(' ', trail);

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
