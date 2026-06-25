using FsCheck;

namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// FsCheck <see cref="Arbitrary{T}"/> registrations for the soft-delete property inputs, backed by
/// the generators in <see cref="SoftDeleteGenerators"/>. Reference this class from a property test
/// to feed it valid inputs, e.g.:
/// <code>[Property(Arbitrary = new[] { typeof(SoftDeleteArbitraries) })]</code>
/// </summary>
public static class SoftDeleteArbitraries
{
    /// <summary>Inputs for the soft-delete transition property (design Property 8).</summary>
    public static Arbitrary<SoftDeleteTransitionInput> SoftDeleteTransitionInput() =>
        Arb.From(SoftDeleteGenerators.TransitionGen());

    /// <summary>Inputs for the soft-delete query-visibility property (design Property 9).</summary>
    public static Arbitrary<SoftDeleteVisibilityInput> SoftDeleteVisibilityInput() =>
        Arb.From(SoftDeleteGenerators.VisibilityGen());

    /// <summary>Inputs for the soft-delete idempotence property (design Property 11).</summary>
    public static Arbitrary<SoftDeleteIdempotenceInput> SoftDeleteIdempotenceInput() =>
        Arb.From(SoftDeleteGenerators.IdempotenceGen());

    /// <summary>Inputs for the restore round-trip property (design Property 12).</summary>
    public static Arbitrary<RestoreRoundTripInput> RestoreRoundTripInput() =>
        Arb.From(SoftDeleteGenerators.RestoreGen());
}
