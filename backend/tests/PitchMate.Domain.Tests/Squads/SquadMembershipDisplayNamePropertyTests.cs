using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Squads;

namespace PitchMate.Domain.Tests.Squads;

/// <summary>
/// Property-based tests for display-name normalisation and uniqueness comparison on
/// <see cref="SquadMembership"/> (squads-and-membership design Property 6). The normalised key is
/// the trimmed, case-insensitively lower-cased display value, so names that differ only by
/// surrounding whitespace or letter case compare equal; <see cref="SquadMembership.Rename"/> rejects
/// a name the collision predicate reports as taken and leaves the current name unchanged, and
/// accepts a free name while recomputing the normalised key. Squad-wide create/rename rejection on
/// collision is enforced by the handler and database index; this validates the entity-level
/// comparison it relies on. Each property runs at least 100 iterations.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class SquadMembershipDisplayNamePropertyTests
{
    private static readonly char[] LetterChars =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".ToCharArray();

    // Feature: squads-and-membership, Property 6: Display-name uniqueness within a squad - the stored
    // normalised key equals the trimmed, lower-cased display name for every constructed membership.
    // Validates: Requirements 3.1, 3.3, 14.8
    [Property(MaxTest = 100)]
    [Trait("Property", "6")]
    public Property NormalisedKeyIsTrimmedLowerCase() =>
        Prop.ForAll(Arb.From(CoreNameGen()), core =>
        {
            var padded = "  " + core + "  ";
            var membership = SquadMembership.CreateRegistered(Guid.NewGuid(), Guid.NewGuid(), padded).Value!;

            return membership.DisplayName == core.Trim()
                && membership.DisplayNameNormalized == core.Trim().ToLowerInvariant();
        });

    // Feature: squads-and-membership, Property 6: Display-name uniqueness within a squad - two names
    // differing only by surrounding whitespace and letter case normalise to the same key, so the
    // comparison the uniqueness rule uses treats them as the same name.
    // Validates: Requirements 3.1, 3.2, 11.8
    [Property(MaxTest = 100)]
    [Trait("Property", "6")]
    public Property CaseAndWhitespaceVariantsCompareEqual() =>
        Prop.ForAll(Arb.From(CoreNameGen()), core =>
        {
            var first = SquadMembership.CreateRegistered(Guid.NewGuid(), Guid.NewGuid(), core).Value!;
            var variant = "  " + Flip(core) + "\t";
            var second = SquadMembership.CreateRegistered(Guid.NewGuid(), Guid.NewGuid(), variant).Value!;

            return first.DisplayNameNormalized == second.DisplayNameNormalized;
        });

    // Feature: squads-and-membership, Property 6: Display-name uniqueness within a squad - Rename is
    // rejected with DisplayNameInUse when the collision predicate reports the normalised target as
    // taken, and the membership keeps its original display name.
    // Validates: Requirements 3.1, 3.2, 3.3, 11.8, 14.8
    [Property(MaxTest = 100)]
    [Trait("Property", "6")]
    public Property RenameRejectsCollidingName() =>
        Prop.ForAll(Arb.From(TwoDistinctCoresGen()), pair =>
        {
            var (original, taken) = pair;
            var membership = SquadMembership.CreateRegistered(Guid.NewGuid(), Guid.NewGuid(), original).Value!;

            // The squad already holds `taken` (compared case-insensitively) on another membership.
            bool IsNameTaken(string normalized) => normalized == taken.Trim().ToLowerInvariant();

            // Attempt to rename to a whitespace/case variant of the taken name.
            var result = membership.Rename("  " + Flip(taken) + " ", IsNameTaken);

            return !result.IsSuccess
                && result.Error!.Code == SquadErrorCode.DisplayNameInUse
                && membership.DisplayName == original.Trim()
                && membership.DisplayNameNormalized == original.Trim().ToLowerInvariant();
        });

    // Feature: squads-and-membership, Property 6: Display-name uniqueness within a squad - Rename to a
    // free name succeeds and recomputes the normalised key from the new trimmed value.
    // Validates: Requirements 3.1, 3.2
    [Property(MaxTest = 100)]
    [Trait("Property", "6")]
    public Property RenameAcceptsFreeName() =>
        Prop.ForAll(Arb.From(TwoDistinctCoresGen()), pair =>
        {
            var (original, next) = pair;
            var membership = SquadMembership.CreateRegistered(Guid.NewGuid(), Guid.NewGuid(), original).Value!;

            // Nothing collides with the new name.
            var result = membership.Rename(next, _ => false);

            return result.IsSuccess
                && membership.DisplayName == next.Trim()
                && membership.DisplayNameNormalized == next.Trim().ToLowerInvariant();
        });

    /// <summary>Toggles the case of each ASCII letter so a variant differs in case but shares the normalised key.</summary>
    private static string Flip(string value) =>
        new(Array.ConvertAll(value.ToCharArray(), c =>
            char.IsUpper(c) ? char.ToLowerInvariant(c) : char.ToUpperInvariant(c)));

    /// <summary>Generates a 1..40 letter core (no whitespace) so padding never changes the trimmed length past the limit.</summary>
    private static Gen<string> CoreNameGen() =>
        from length in Gen.Choose(1, 40)
        from chars in Gen.ArrayOf(Gen.Elements(LetterChars), length)
        select new string(chars);

    /// <summary>Generates two letter cores whose normalised (trimmed, lower-cased) forms differ.</summary>
    private static Gen<(string, string)> TwoDistinctCoresGen() =>
        from first in CoreNameGen()
        from second in CoreNameGen()
        where first.ToLowerInvariant() != second.ToLowerInvariant()
        select (first, second);
}
