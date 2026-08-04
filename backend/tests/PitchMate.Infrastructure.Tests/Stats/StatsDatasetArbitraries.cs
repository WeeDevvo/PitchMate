using FsCheck;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// FsCheck <see cref="Arbitrary{T}"/> registration for <see cref="StatsDatasetSpec"/>, backed by
/// <see cref="StatsDatasetGenerators.Dataset"/>. Reference it from a model-based stats property test
/// so it is fed rich generated datasets, e.g.:
/// <code>[Property(Arbitrary = new[] { typeof(StatsDatasetArbitraries) })]</code>
/// </summary>
public static class StatsDatasetArbitraries
{
    /// <summary>Rich stats datasets spanning multiple squads, all match states, and every membership shape.</summary>
    public static Arbitrary<StatsDatasetSpec> Dataset() => Arb.From(StatsDatasetGenerators.Dataset());
}
