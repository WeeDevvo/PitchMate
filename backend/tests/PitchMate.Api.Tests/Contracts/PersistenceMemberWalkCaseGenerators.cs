using FsCheck;
using FsCheck.Fluent;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// FsCheck arbitraries for <see cref="PersistenceMemberWalkCase"/>.
/// <para>
/// A contract shape cannot be generated — it is a type, fixed at compile time — so what is generated is
/// the <i>population</i> the rule is handed: which of the clean shapes, how many, which of the planted
/// shapes, and how many, including none. That is the dimension the property actually needs to range over:
/// the claim is that the walk reports exactly the planted roots out of an arbitrary mixture, and a
/// mixture is precisely what varies here.
/// </para>
/// <para>
/// Duplicates are collapsed because the rule's output is a worklist keyed on the offending root: handing
/// it the same contract twice would double the expected message count for no added coverage, and the
/// property's "reported once per planted root" conjunct would be asserting about the generator rather
/// than about the walk.
/// </para>
/// </summary>
public static class PersistenceMemberWalkCaseGenerators
{
    /// <summary>Arbitrary for a single generated clean/planted mixture.</summary>
    /// <returns>The arbitrary.</returns>
    public static Arbitrary<PersistenceMemberWalkCase> PersistenceMemberWalkCase()
    {
        Type[] clean = [.. PlantedPersistenceContracts.Clean];
        Type[] planted = [.. PlantedPersistenceContracts.Planted];

        return Arb.From(
            from cleanCount in Gen.Choose(1, clean.Length)
            from drawnClean in Gen.ArrayOf(Gen.Elements(clean), cleanCount)
            from plantedCount in Gen.Choose(0, planted.Length)
            from drawnPlanted in Gen.ArrayOf(Gen.Elements(planted), plantedCount)
            select new Contracts.PersistenceMemberWalkCase(
                [.. drawnClean.Distinct()],
                [.. drawnPlanted.Distinct()]));
    }
}
