using FsCheck;

namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// FsCheck <see cref="Arbitrary{T}"/> registration for the database-evaluated chronological-ordering
/// property input, backed by <see cref="ChronologicalOrderingGenerators"/>. Reference this class from
/// a property test to feed it valid inputs, e.g.:
/// <code>[Property(Arbitrary = new[] { typeof(ChronologicalOrderingArbitraries) })]</code>
/// </summary>
public static class ChronologicalOrderingArbitraries
{
    /// <summary>Inputs for the database-evaluated chronological-ordering property (design Property 24).</summary>
    public static Arbitrary<ChronologicalOrderingInput> ChronologicalOrderingInput() =>
        Arb.From(ChronologicalOrderingGenerators.ChronologicalOrderingGen());
}
