namespace PitchMate.Domain.Squads;

/// <summary>
/// Owned value type recording whether a single <see cref="SquadFeature"/> is enabled for a squad.
/// A squad holds exactly one flag per <see cref="SquadFeature"/> member.
/// </summary>
public sealed class SquadFeatureFlag
{
    /// <summary>The feature this flag governs.</summary>
    public SquadFeature Feature { get; private set; }

    /// <summary>Whether the feature is currently enabled for the squad.</summary>
    public bool IsEnabled { get; private set; }

    /// <summary>
    /// Creates a flag for the given feature, disabled by default (Requirement 1.3, 13.3).
    /// </summary>
    /// <param name="feature">The feature this flag governs.</param>
    /// <param name="isEnabled">The initial enabled state; disabled unless specified.</param>
    internal SquadFeatureFlag(SquadFeature feature, bool isEnabled = false)
    {
        Feature = feature;
        IsEnabled = isEnabled;
    }

    /// <summary>Parameterless constructor reserved for the persistence layer.</summary>
    private SquadFeatureFlag()
    {
    }

    /// <summary>Sets the enabled state of the feature.</summary>
    internal void Set(bool enabled) => IsEnabled = enabled;
}
