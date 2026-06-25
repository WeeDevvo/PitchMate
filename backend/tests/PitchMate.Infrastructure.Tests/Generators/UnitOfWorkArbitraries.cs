using FsCheck;

namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// FsCheck <see cref="Arbitrary{T}"/> registrations for the Unit-of-Work property inputs, backed by
/// the generators in <see cref="UnitOfWorkGenerators"/>. Reference this class from a property test to
/// feed it valid inputs, e.g.:
/// <code>[Property(Arbitrary = new[] { typeof(UnitOfWorkArbitraries) })]</code>
/// </summary>
public static class UnitOfWorkArbitraries
{
    /// <summary>Inputs for the Unit-of-Work change-count property (design Property 18).</summary>
    public static Arbitrary<UnitOfWorkChangeCountInput> UnitOfWorkChangeCountInput() =>
        Arb.From(UnitOfWorkGenerators.ChangeCountGen());

    /// <summary>Inputs for the Unit-of-Work atomic-rollback property (design Property 19).</summary>
    public static Arbitrary<UnitOfWorkRollbackInput> UnitOfWorkRollbackInput() =>
        Arb.From(UnitOfWorkGenerators.RollbackGen());
}
