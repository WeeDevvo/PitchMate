using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Squads;

namespace PitchMate.Domain.Tests.Squads;

/// <summary>
/// Property-based tests for feature-flag isolation on <see cref="Squad"/> (squads-and-membership
/// design Property 28). Setting a feature stores exactly the requested value and reads it back
/// unchanged, while leaving every other feature's state untouched. For any sequence of set
/// operations, each feature reflects the last value written to it (and stays disabled if never
/// written). Each property runs at least 100 iterations.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class SquadFeatureFlagPropertyTests
{
    /// <summary>The full set of defined features, used to check untouched flags stay put.</summary>
    private static readonly SquadFeature[] AllFeatures = Enum.GetValues<SquadFeature>();

    // Feature: squads-and-membership, Property 28: Feature flags are set independently and read back
    // exactly - after applying a sequence of set operations, IsFeatureEnabled(feature) returns the
    // last value written to that feature, and features never written remain disabled.
    // Validates: Requirements 13.2, 13.4, 13.5, 13.6
    [Property(MaxTest = 100)]
    [Trait("Property", "28")]
    public Property SetValuesReadBackAsLastWritten() =>
        Prop.ForAll(Arb.From(OperationsGen()), operations =>
        {
            var squad = Squad.Create("Test Squad").Value!;

            // Track the expected state independently, starting from the all-disabled default.
            var expected = AllFeatures.ToDictionary(f => f, _ => false);

            foreach (var (feature, enabled) in operations)
            {
                squad.SetFeature(feature, enabled);
                expected[feature] = enabled;
            }

            // Every feature reads back exactly the last value written (or the disabled default).
            return AllFeatures.All(f => squad.IsFeatureEnabled(f) == expected[f]);
        });

    // Feature: squads-and-membership, Property 28: Feature flags are set independently and read back
    // exactly - setting one feature never changes any other feature's state.
    // Validates: Requirements 13.2, 13.4, 13.5, 13.6
    [Property(MaxTest = 100)]
    [Trait("Property", "28")]
    public Property SettingOneFeatureLeavesOthersUnchanged() =>
        Prop.ForAll(Arb.From(SingleSetGen()), op =>
        {
            var squad = Squad.Create("Test Squad").Value!;

            // Capture the state of the other features before the set.
            var othersBefore = AllFeatures
                .Where(f => f != op.Feature)
                .ToDictionary(f => f, squad.IsFeatureEnabled);

            squad.SetFeature(op.Feature, op.Enabled);

            return squad.IsFeatureEnabled(op.Feature) == op.Enabled
                && othersBefore.All(kvp => squad.IsFeatureEnabled(kvp.Key) == kvp.Value);
        });

    /// <summary>A single set operation targeting a feature with a requested enabled state.</summary>
    private sealed record SetOp(SquadFeature Feature, bool Enabled);

    /// <summary>Generates a sequence of 0..20 set operations over the defined features.</summary>
    private static Gen<List<SetOp>> OperationsGen() =>
        from count in Gen.Choose(0, 20)
        from ops in Gen.ListOf(SingleSetGen(), count)
        select ops.ToList();

    /// <summary>Generates a single set operation over an arbitrary defined feature and boolean.</summary>
    private static Gen<SetOp> SingleSetGen() =>
        from feature in Gen.Elements(AllFeatures)
        from enabled in Gen.Elements(true, false)
        select new SetOp(feature, enabled);
}
