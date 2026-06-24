namespace PitchMate.Domain.Rating;

/// <summary>
/// A completed match for replay: two or more replay teams referencing players by opaque index.
/// <paramref name="GoalMargin"/> is consulted only when the margin-of-victory lever is enabled.
/// </summary>
/// <param name="Teams">The teams in the match, in a stable order that is preserved by the update.</param>
/// <param name="GoalMargin">Optional non-negative goal margin; used only when the margin-of-victory lever is enabled.</param>
public sealed record ReplayMatch(IReadOnlyList<ReplayTeam> Teams, int? GoalMargin = null);
