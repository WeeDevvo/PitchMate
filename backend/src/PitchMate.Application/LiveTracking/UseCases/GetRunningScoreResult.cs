using PitchMate.Domain.Matches;

namespace PitchMate.Application.LiveTracking.UseCases;

/// <summary>
/// The outcome of a successful running-score read: the match's identity and the current per-team goal
/// tally, one <see cref="TeamScore"/> per working team, each mirroring that team's count of effective
/// <c>GoalScored</c> events — 0 for a team with no effective goals (Requirement 6.1, 6.4). The tally is
/// derived from the set of effective events at request time, so it reflects any retractions in force and
/// is independent of the order events were recorded or synced (Requirement 6.2, 13.3).
/// </summary>
/// <param name="MatchId">The identity of the match whose running score was read.</param>
/// <param name="TeamScores">The current per-team goal tally, one entry per working team.</param>
public sealed record GetRunningScoreResult(
    Guid MatchId,
    IReadOnlyList<TeamScore> TeamScores);
