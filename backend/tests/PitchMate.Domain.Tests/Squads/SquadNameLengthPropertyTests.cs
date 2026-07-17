using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Squads;

namespace PitchMate.Domain.Tests.Squads;

/// <summary>
/// Property-based tests for the length policies of Property 2 (squads-and-membership design
/// "Squad and display-name length policies reject invalid input"). Two policies are exercised:
/// <list type="bullet">
///   <item><description>
///     Squad name (Requirement 1.2): a name whose trimmed length is 0 (empty or whitespace-only) or
///     exceeds 80 characters is rejected with <see cref="SquadErrorCode.ValidationFailed"/> and
///     creates no squad; a name whose trimmed length is within 1..80 is accepted.
///   </description></item>
///   <item><description>
///     Membership display name (Requirement 1.6): a display name whose trimmed length is 0 or
///     exceeds 50 characters is rejected with <see cref="SquadErrorCode.ValidationFailed"/> by every
///     <see cref="SquadMembership"/> factory (owner, registered, guest) and creates no membership; a
///     display name whose trimmed length is within 1..50 is accepted.
///   </description></item>
/// </list>
/// Each property runs at least 100 iterations.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class SquadNameLengthPropertyTests
{
    /// <summary>Non-whitespace characters used to build name cores of a controlled trimmed length.</summary>
    private static readonly char[] NameChars =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.!'".ToCharArray();

    // ---- Squad name length policy (Requirement 1.2) --------------------------------------------

    // Feature: squads-and-membership, Property 2: Squad and display-name length policies reject
    // invalid input - a name whose trimmed length is 0 or greater than 80 is rejected with
    // ValidationFailed and creates no squad.
    // Validates: Requirements 1.2, 1.6
    [Property(MaxTest = 100)]
    [Trait("Property", "2")]
    public Property OutOfRangeNamesAreRejected() =>
        Prop.ForAll(Arb.From(InvalidLengthGen(Squad.NameMaxLength)), raw =>
        {
            var result = Squad.Create(raw);

            return !result.IsSuccess
                && result.Error!.Code == SquadErrorCode.ValidationFailed;
        });

    // Feature: squads-and-membership, Property 2: Squad and display-name length policies reject
    // invalid input - the boundary complement: a name whose trimmed length is within 1..80 is
    // accepted, confirming the policy rejects only out-of-range lengths.
    // Validates: Requirements 1.2, 1.6
    [Property(MaxTest = 100)]
    [Trait("Property", "2")]
    public Property InRangeNamesAreAccepted() =>
        Prop.ForAll(Arb.From(ValidLengthGen(Squad.NameMinLength, Squad.NameMaxLength)), raw =>
        {
            var result = Squad.Create(raw);
            return result.IsSuccess;
        });

    // ---- Membership display-name length policy (Requirement 1.6) -------------------------------

    // Feature: squads-and-membership, Property 2: Squad and display-name length policies reject
    // invalid input - a display name whose trimmed length is 0 or greater than 50 is rejected with
    // ValidationFailed by every membership factory and creates no membership.
    // Validates: Requirements 1.2, 1.6
    [Property(MaxTest = 100)]
    [Trait("Property", "2")]
    public Property OutOfRangeDisplayNamesAreRejected() =>
        Prop.ForAll(Arb.From(FactoryGen()), Arb.From(InvalidLengthGen(SquadMembership.DisplayNameMaxLength)), (factory, raw) =>
        {
            var result = CreateMembership(factory, raw);

            return !result.IsSuccess
                && result.Error!.Code == SquadErrorCode.ValidationFailed;
        });

    // Feature: squads-and-membership, Property 2: Squad and display-name length policies reject
    // invalid input - the boundary complement: a display name whose trimmed length is within 1..50
    // is accepted by every membership factory, confirming the policy rejects only out-of-range lengths.
    // Validates: Requirements 1.2, 1.6
    [Property(MaxTest = 100)]
    [Trait("Property", "2")]
    public Property InRangeDisplayNamesAreAccepted() =>
        Prop.ForAll(Arb.From(FactoryGen()), Arb.From(ValidLengthGen(SquadMembership.DisplayNameMinLength, SquadMembership.DisplayNameMaxLength)), (factory, raw) =>
        {
            var result = CreateMembership(factory, raw);
            return result.IsSuccess;
        });

    /// <summary>The three membership factories, all of which enforce the display-name length policy.</summary>
    private enum MembershipFactory { Owner, Registered, Guest }

    /// <summary>Constructs a membership through the chosen factory, supplying valid non-name arguments.</summary>
    private static PitchMate.Domain.Squads.Result<SquadMembership> CreateMembership(MembershipFactory factory, string displayName) => factory switch
    {
        MembershipFactory.Owner => SquadMembership.CreateOwner(Guid.NewGuid(), Guid.NewGuid(), displayName),
        MembershipFactory.Registered => SquadMembership.CreateRegistered(Guid.NewGuid(), Guid.NewGuid(), displayName),
        _ => SquadMembership.CreateGuest(Guid.NewGuid(), displayName, skillTier: null, DateTimeOffset.UtcNow),
    };

    private static Gen<MembershipFactory> FactoryGen() =>
        Gen.Elements(MembershipFactory.Owner, MembershipFactory.Registered, MembershipFactory.Guest);

    /// <summary>Generates a name that violates a length policy: trimmed length 0 or greater than <paramref name="maxLength"/>.</summary>
    private static Gen<string> InvalidLengthGen(int maxLength) =>
        Gen.OneOf(WhitespaceOnlyGen(), TooLongGen(maxLength));

    /// <summary>Generates an empty or whitespace-only string (trimmed length 0).</summary>
    private static Gen<string> WhitespaceOnlyGen() =>
        from chars in Gen.ListOf(Gen.Elements(' ', '\t', '\n'))
        select new string(chars.ToArray());

    /// <summary>Generates a name whose trimmed length exceeds <paramref name="maxLength"/> characters.</summary>
    private static Gen<string> TooLongGen(int maxLength) =>
        from extra in Gen.Choose(1, 120)
        from chars in Gen.ArrayOf(Gen.Elements(NameChars), maxLength + extra)
        select new string(chars);

    /// <summary>Generates a name whose trimmed length is within <paramref name="min"/>..<paramref name="max"/>, with optional whitespace padding.</summary>
    private static Gen<string> ValidLengthGen(int min, int max) =>
        from length in Gen.Choose(min, max)
        from chars in Gen.ArrayOf(Gen.Elements(NameChars), length)
        from lead in WhitespaceOnlyGen()
        from trail in WhitespaceOnlyGen()
        select lead + new string(chars) + trail;
}
