using PitchMate.Domain.Matches;

namespace PitchMate.Application.LiveTracking.UseCases;

/// <summary>
/// The outcome of a successful tracked-result finalisation: the finalised match's identity, the
/// per-team final scores that were recorded as the <c>Rich</c> match result — each mirroring that
/// working team's running score, 0 for a team with no effective goals (Requirement 8.1, 8.5) — and
/// whether the underlying match-lifecycle completion was an idempotent no-op on an already-completed
/// match.
/// <para>
/// A live-tracked match applies exactly one rating update over its immutable kickoff lineup on
/// completion; that update is owned by match-lifecycle, so <see cref="AlreadyCompleted"/> is
/// <see langword="true"/> when a repeated finalise observed an already-completed match and applied no
/// further rating update, and <see langword="false"/> on the first completing finalise
/// (Requirement 8.3).
/// </para>
/// </summary>
/// <param name="MatchId">The identity of the finalised match.</param>
/// <param name="TeamScores">The per-team final scores recorded as the <c>Rich</c> result, one per working team.</param>
/// <param name="AlreadyCompleted"><see langword="true"/> when the completion was an idempotent no-op that applied no further rating update.</param>
public sealed record FinaliseTrackedResultResult(
    Guid MatchId,
    IReadOnlyList<TeamScore> TeamScores,
    bool AlreadyCompleted);
