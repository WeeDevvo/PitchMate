using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Squads;

namespace PitchMate.Domain.Tests.Squads;

/// <summary>
/// Property-based tests for the in-memory portion of squad creation (squads-and-membership design
/// Property 1). Creating a squad from a valid name stores the trimmed name and initialises every
/// <see cref="SquadFeature"/> disabled. The owner/active-owner portion of Property 1 is validated
/// against the database in the infrastructure tests. Each property runs at least 100 iterations.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class SquadCreationPropertyTests
{
    /// <summary>Letters, digits, and punctuation used to build name cores (no leading/trailing whitespace).</summary>
    private static readonly char[] NameChars =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.!'".ToCharArray();

    // Feature: squads-and-membership, Property 1: Squad creation produces one active owner and all
    // features disabled (in-memory portion) - a valid name creates a squad whose stored Name equals
    // the trimmed input.
    // Validates: Requirements 1.1, 1.3, 13.3
    [Property(MaxTest = 100)]
    [Trait("Property", "1")]
    public Property CreationStoresTrimmedName() =>
        Prop.ForAll(Arb.From(PaddedNameGen()), padded =>
        {
            var result = Squad.Create(padded.Raw);

            return result.IsSuccess
                && result.Value!.Name == padded.ExpectedTrimmed;
        });

    // Feature: squads-and-membership, Property 1: Squad creation produces one active owner and all
    // features disabled (in-memory portion) - a newly created squad reports every defined
    // SquadFeature as disabled, with exactly one flag per feature.
    // Validates: Requirements 1.1, 1.3, 13.3
    [Property(MaxTest = 100)]
    [Trait("Property", "1")]
    public Property CreationDisablesEveryFeature() =>
        Prop.ForAll(Arb.From(PaddedNameGen()), padded =>
        {
            var result = Squad.Create(padded.Raw);
            if (!result.IsSuccess)
            {
                return false;
            }

            var squad = result.Value!;
            var features = Enum.GetValues<SquadFeature>();

            // One flag per feature, and every feature reads back disabled.
            return squad.Features.Count == features.Length
                && squad.Features.All(f => !f.IsEnabled)
                && features.All(f => !squad.IsFeatureEnabled(f));
        });

    /// <summary>A raw (possibly whitespace-padded) name and the trimmed value it must produce.</summary>
    private sealed record PaddedName(string Raw, string ExpectedTrimmed);

    /// <summary>
    /// Generates a valid name whose trimmed length is 1..80, optionally wrapped in leading and
    /// trailing whitespace. The core carries no edge whitespace, so <c>Raw.Trim()</c> equals the core.
    /// </summary>
    private static Gen<PaddedName> PaddedNameGen() =>
        from core in NameCoreGen(1, 80)
        from lead in WhitespaceGen()
        from trail in WhitespaceGen()
        select new PaddedName(lead + core + trail, core);

    /// <summary>Generates a non-empty core of <paramref name="min"/>..<paramref name="max"/> non-whitespace characters.</summary>
    private static Gen<string> NameCoreGen(int min, int max) =>
        from length in Gen.Choose(min, max)
        from chars in Gen.ArrayOf(Gen.Elements(NameChars), length)
        select new string(chars);

    /// <summary>Generates a possibly-empty run of whitespace characters.</summary>
    private static Gen<string> WhitespaceGen() =>
        from chars in Gen.ListOf(Gen.Elements(' ', '\t', '\n'))
        select new string(chars.ToArray());
}
