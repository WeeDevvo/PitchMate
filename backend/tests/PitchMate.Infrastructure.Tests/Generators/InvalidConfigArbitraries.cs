using FsCheck;
using PitchMate.Domain.Rating;

namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// FsCheck <see cref="Arbitrary{T}"/> registration that supplies <em>invalid</em>
/// <see cref="RatingEngineConfig"/> values (each violating exactly one validation rule), backed by
/// <see cref="RatingGenerators.InvalidConfig"/>. Kept separate from <see cref="RatingArbitraries"/>
/// (which produces valid configs) so a property test can opt explicitly into malformed configs, e.g.:
/// <code>[Property(Arbitrary = new[] { typeof(InvalidConfigArbitraries) })]</code>
/// Consumed by the invalid-configuration gating property (design Property 23 / Requirement 11.5).
/// </summary>
public static class InvalidConfigArbitraries
{
    /// <summary>An invalid <see cref="RatingEngineConfig"/> breaking one validation rule.</summary>
    public static Arbitrary<RatingEngineConfig> RatingEngineConfig() =>
        Arb.From(RatingGenerators.InvalidConfig());
}
