namespace PitchMate.Domain.Rating;

/// <summary>
/// A completed match: two or more team results. <paramref name="GoalMargin"/> is consulted only when
/// the margin-of-victory lever is enabled.
/// </summary>
/// <param name="Teams">The teams in the match, in a stable order that is preserved by the update.</param>
/// <param name="GoalMargin">Optional non-negative goal margin; used only when the margin-of-victory lever is enabled.</param>
public sealed record MatchOutcome(IReadOnlyList<TeamResult> Teams, int? GoalMargin = null);
