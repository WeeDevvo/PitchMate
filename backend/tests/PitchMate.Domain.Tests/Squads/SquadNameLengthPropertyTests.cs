using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Squads;

namespace PitchMate.Domain.Tests.Squads;

/// <summary>
/// Property-based tests for the squad-name length policy (squads-and-membership design Property 2).
/// A name whose trimmed length is 0 characters (empty or whitespace-only) or exceeds 80 characters
/// is rejected with a validation error and creates no squad; a name whose trimmed length is within
/// 1..80 is accepted. The display-name (1..50) half of Property 2 is validated on
/// <c>SquadMembership</c> once that entity exists (task 3). Each property runs at least 100
/// iterations.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class SquadNameLengthPropertyTests
{
    /// <summary>Non-whitespace characters used to build name cores of a controlled trimmed length.</summary>
    private static readonly char[] NameChars =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.!'".ToCharArray();

    // Feature: squads-and-membership, Property 2: Squad and display-name length policies reject
    // invalid input - a name whose trimmed length is 0 or greater than 80 is rejected with
    // ValidationFailed and creates no squad.
    // Validates: Requirements 1.2, 1.6
    [Property(MaxTest = 100)]
    [Trait("Property", "2")]
    public Property OutOfRangeNamesAreRejected() =>
        Prop.ForAll(Arb.From(InvalidNameGen()), raw =>
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
        Prop.ForAll(Arb.From(ValidNameGen()), raw =>
        {
            var result = Squad.Create(raw);
            return result.IsSuccess;
        });

    /// <summary>Generates a name that violates the length policy: trimmed length 0 or greater than 80.</summary>
    private static Gen<string> InvalidNameGen() =>
        Gen.OneOf(WhitespaceOnlyGen(), TooLongGen());

    /// <summary>Generates an empty or whitespace-only string (trimmed length 0).</summary>
    private static Gen<string> WhitespaceOnlyGen() =>
        from chars in Gen.ListOf(Gen.Elements(' ', '\t', '\n'))
        select new string(chars.ToArray());

    /// <summary>Generates a name whose trimmed length exceeds 80 characters.</summary>
    private static Gen<string> TooLongGen() =>
        from extra in Gen.Choose(1, 120)
        from chars in Gen.ArrayOf(Gen.Elements(NameChars), Squad.NameMaxLength + extra)
        select new string(chars);

    /// <summary>Generates a name whose trimmed length is within the accepted 1..80 range, with optional padding.</summary>
    private static Gen<string> ValidNameGen() =>
        from length in Gen.Choose(Squad.NameMinLength, Squad.NameMaxLength)
        from chars in Gen.ArrayOf(Gen.Elements(NameChars), length)
        from lead in WhitespaceOnlyGen()
        from trail in WhitespaceOnlyGen()
        select lead + new string(chars) + trail;
}
