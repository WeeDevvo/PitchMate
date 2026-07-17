using FsCheck;

namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// FsCheck <see cref="Arbitrary{T}"/> registrations for the squad DB-invariant property inputs
/// (task 18.5), backed by <see cref="SquadDbInvariantGenerators"/>. Reference this class from a
/// property test to feed it valid scenarios, e.g.:
/// <code>[Property(Arbitrary = new[] { typeof(SquadDbInvariantArbitraries) })]</code>
/// </summary>
public static class SquadDbInvariantArbitraries
{
    /// <summary>Scenarios for the squad DB-invariant properties (Properties 1, 13, 14, 30, 34, 36, 38).</summary>
    public static Arbitrary<SquadDbScenario> SquadDbScenario() =>
        Arb.From(SquadDbInvariantGenerators.ScenarioGen());
}
