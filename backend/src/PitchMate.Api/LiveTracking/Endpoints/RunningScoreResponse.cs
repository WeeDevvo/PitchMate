using PitchMate.Application.LiveTracking.UseCases;
using PitchMate.Domain.Matches;

namespace PitchMate.Api.LiveTracking.Endpoints;

/// <summary>
/// The response of a running-score read, mirroring the Application <see cref="GetRunningScoreResult"/>
/// (Requirement 6.1): the match's identity and its current per-team goal tally, one
/// <see cref="TeamScore"/> per working team, each mirroring that team's count of effective
/// <c>GoalScored</c> events — 0 for a team with no effective goals (Requirement 6.4). The tally is
/// derived from the set of effective events at request time, so it reflects any retractions in force
/// and is independent of the order events were recorded or synced (Requirement 6.2).
/// </summary>
/// <param name="MatchId">The identity of the match whose running score was read.</param>
/// <param name="TeamScores">The current per-team goal tally, one entry per working team.</param>
public sealed record RunningScoreResponse(
    Guid MatchId,
    IReadOnlyList<TeamScore> TeamScores)
{
    /// <summary>
    /// Maps an Application <see cref="GetRunningScoreResult"/> onto its response shape.
    /// </summary>
    /// <param name="result">The running-score result to map.</param>
    /// <returns>The equivalent <see cref="RunningScoreResponse"/>.</returns>
    public static RunningScoreResponse From(GetRunningScoreResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        return new RunningScoreResponse(result.MatchId, result.TeamScores);
    }
}
