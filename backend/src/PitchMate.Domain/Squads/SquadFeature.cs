namespace PitchMate.Domain.Squads;

/// <summary>
/// The closed set of optional capabilities a squad can opt into. The MVP defines a single feature.
/// </summary>
public enum SquadFeature
{
    /// <summary>Live match tracking (running score, goal events, goalkeeper stints).</summary>
    LiveMatchTracking = 1
}
