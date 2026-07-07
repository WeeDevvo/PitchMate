using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Auth;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Property-based test for <see cref="CreateSquadHandler"/> covering the owner display-name
/// derivation rule (squads-and-membership design Property 3). It drives the real handler against the
/// in-memory squad fakes (no database), per the Application-layer testing strategy.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class CreateSquadProperties
{
    // Feature: squads-and-membership, Property 3: Owner display name is the trimmed supplied value or
    // derived identity name - when a display name of trimmed length 1..50 is supplied the owner
    // membership stores that trimmed value; when none is supplied it stores the trimmed identity
    // display name of the creating user.
    // Validates: Requirements 1.4, 1.5
    [Property(MaxTest = 200, Arbitrary = new[] { typeof(OwnerNameGenerators) })]
    [Trait("Property", "3")]
    public Property Property3_OwnerDisplayNameIsTrimmedSuppliedOrDerived(OwnerNameInput input)
    {
        var store = new SquadStore();
        User user = User.Create(input.UserDisplayName, "owner@example.test");
        store.AddUser(user);

        var handler = new CreateSquadHandler(
            new FakeSquadRepository(store),
            new FakeSquadMembershipRepository(store),
            new FakeUserRepository(store),
            new FakeSquadUnitOfWork(store));

        Result<CreateSquadResult> result = handler
            .HandleAsync(new CreateSquadCommand(user.Id, input.SquadName, input.SuppliedDisplayName), CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        SquadMembership? owner = store.Memberships.Count == 1 ? store.Memberships[0] : null;

        // Creation succeeded, persisting exactly one squad and one owner membership atomically.
        bool succeeded = result.IsSuccess;
        bool oneSquad = store.Squads.Count == 1;
        bool oneMembership = store.Memberships.Count == 1;
        bool singleSave = store.SaveCallCount == 1;

        // The owner membership stores the expected display name: the trimmed supplied value, or the
        // trimmed identity display name when none was supplied (Requirement 1.4, 1.5).
        bool nameMatches = owner is not null && owner.DisplayName == input.ExpectedOwnerName;

        // The membership is an active, registered owner backed by the creating user (Requirement 1.1).
        bool ownerShape = owner is not null
            && owner.Role == SquadRole.Owner
            && owner.State == MembershipState.Active
            && owner.UserId == user.Id
            && !owner.IsGuest
            && result.Value!.OwnerMembershipId == owner.Id
            && result.Value!.SquadId == owner.SquadId;

        return (succeeded && oneSquad && oneMembership && singleSave && nameMatches && ownerShape).ToProperty();
    }
}

/// <summary>
/// A single squad-creation input for the owner display-name derivation property. It carries a valid
/// squad name, a valid identity display name for the creating user, the optional supplied owner
/// display name (<see langword="null"/> exercises derivation), and the display name the owner
/// membership is expected to store after trimming.
/// </summary>
/// <param name="SquadName">A raw squad name whose trimmed length is 1..80.</param>
/// <param name="UserDisplayName">The creating user's identity display name (valid for <see cref="User.Create"/>, trimmed length 1..50).</param>
/// <param name="SuppliedDisplayName">The optional supplied owner display name; <see langword="null"/> derives from the user.</param>
/// <param name="ExpectedOwnerName">The trimmed display name the owner membership should store.</param>
public sealed record OwnerNameInput(
    string SquadName,
    string UserDisplayName,
    string? SuppliedDisplayName,
    string ExpectedOwnerName);

/// <summary>
/// FsCheck arbitraries for the owner display-name derivation property. Smart generators constrain
/// inputs to the valid space: a squad name of trimmed length 1..80, an identity display name valid
/// for <see cref="User.Create"/> whose trimmed length is 1..50, and — with equal probability — either
/// a supplied owner display name (with case/whitespace decoration) or none, so both the supplied and
/// derived branches are exercised. The expected owner name is the trimmed form of whichever source
/// applies.
/// </summary>
public static class OwnerNameGenerators
{
    private static readonly char[] Alphabet =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".ToCharArray();

    /// <summary>Arbitrary for a single owner display-name derivation input.</summary>
    public static Arbitrary<OwnerNameInput> OwnerNameInput() => Arb.From(OwnerNameInputGen());

    private static Gen<OwnerNameInput> OwnerNameInputGen() =>
        from squadName in Decorate(Core(1, 80))
        from userCore in Core(1, 50)
        from userDecorated in Decorate(Gen.Constant(userCore))
        from supplied in Gen.Elements(true, false)
        from suppliedCore in Core(1, 50)
        from suppliedDecorated in Decorate(Gen.Constant(suppliedCore))
        select supplied
            ? new OwnerNameInput(squadName, userDecorated, suppliedDecorated, suppliedCore)
            : new OwnerNameInput(squadName, userDecorated, null, userDecorated.Trim());

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
