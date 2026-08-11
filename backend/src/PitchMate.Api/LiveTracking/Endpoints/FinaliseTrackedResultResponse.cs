using PitchMate.Application.LiveTracking.UseCases;
using PitchMate.Domain.Matches;

namespace PitchMate.Api.LiveTracking.Endpoints;

/// <summary>
/// The response of a finalise-tracked-result request, mirroring the Application
/// <see cref="FinaliseTrackedResultResult"/> (Requirement 8.1): the finalised match's identity, the
/// per-team final scores recorded as the <c>Rich</c> match result — each mirroring that working team's
/// running score, 0 for a team with no effective goals (Requirement 8.1, 8.5) — and whether the
/// underlying match-lifecycle completion was an idempotent no-op on an already-completed match.
/// <para>
/// A live-tracked match applies exactly one rating update over its immutable kickoff lineup on
/// completion, owned by match-lifecycle; <see cref="AlreadyCompleted"/> is <see langword="true"/> when
/// a repeated finalise observed an already-completed match and applied no further rating update, and
/// <see langword="false"/> on the first completing finalise (Requirement 8.3).
/// </para>
/// </summary>
/// <param name="MatchId">The identity of the finalised match.</param>
/// <param name="TeamScores">The per-team final scores recorded as the <c>Rich</c> result, one per working team.</param>
/// <param name="AlreadyCompleted"><see langword="true"/> when the completion was an idempotent no-op that applied no further rating update.</param>
public sealed record FinaliseTrackedResultResponse(
    Guid MatchId,
    IReadOnlyList<TeamScore> TeamScores,
    bool AlreadyCompleted)
{
    /// <summary>
    /// Maps an Application <see cref="FinaliseTrackedResultResult"/> onto its response shape.
    /// </summary>
    /// <param name="result">The finalise result to map.</param>
    /// <returns>The equivalent <see cref="FinaliseTrackedResultResponse"/>.</returns>
    public static FinaliseTrackedResultResponse From(FinaliseTrackedResultResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        return new FinaliseTrackedResultResponse(result.MatchId, result.TeamScores, result.AlreadyCompleted);
    }
}
