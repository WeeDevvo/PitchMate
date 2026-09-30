using FsCheck;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// FsCheck <see cref="Arbitrary{T}"/> registration for the two-squad, mixed-state datasets of
/// <see cref="StandingScopeDatasetGenerators.Dataset"/>. Referenced by the membership-standing scope
/// property test (api-response-contracts Property 20, task 6.2):
/// <code>[Property(Arbitrary = new[] { typeof(StandingScopeDatasetArbitraries) })]</code>
/// <para>
/// It is deliberately separate from <see cref="StatsDatasetArbitraries"/>: the stats suite wants
/// one-to-three-squad datasets weighted toward completed matches, whereas this property needs the
/// exact two-squad shape whose completed rosters nest, so the non-vacuity guarantees documented on
/// <see cref="StandingScopeDatasetGenerators"/> hold in every generated case. No shrinker is supplied,
/// so a failing case is reported as generated rather than being re-seeded repeatedly while shrinking.
/// </para>
/// </summary>
public static class StandingScopeDatasetArbitraries
{
    /// <summary>Two-squad datasets with nesting completed rosters and uncounted non-completed lineups.</summary>
    public static Arbitrary<StatsDatasetSpec> Dataset() => Arb.From(StandingScopeDatasetGenerators.Dataset());
}
