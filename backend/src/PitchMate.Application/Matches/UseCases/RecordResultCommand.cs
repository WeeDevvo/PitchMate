using PitchMate.Domain.Matches;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A request by an authenticated organiser to record the outcome of a played match while it is in
/// <see cref="MatchState.InProgress"/> (Requirement 11.2, 11.3). The handler loads the squad-scoped
/// match, resolves the acting user's membership in the match's squad, and permits only an active
/// registered owner or admin (Requirement 14.1, 14.2).
/// <para>
/// A <see cref="ResultFidelity.Basic"/> result is always accepted; a <see cref="ResultFidelity.Rich"/>
/// result is accepted only where the match's squad has the <c>LiveMatchTracking</c> feature enabled,
/// and is otherwise rejected with a live-tracking-disabled error (Requirement 11.4, 11.5). The
/// <paramref name="TeamScores"/> carry one whole-number final score (0..99) per match team; their
/// range, completeness, and team membership are validated on the <c>Match</c> aggregate, which
/// identifies the offending score and stores nothing on failure (Requirement 11.6, 11.7).
/// </para>
/// </summary>
/// <param name="ActingUserId">The authenticated user recording the result.</param>
/// <param name="MatchId">The match whose result is recorded; must be <see cref="MatchState.InProgress"/>.</param>
/// <param name="Fidelity">The fidelity at which the result is recorded; <c>Rich</c> is gated by the squad's live-tracking feature.</param>
/// <param name="TeamScores">The proposed per-team final scores, one per match team; validated by the aggregate.</param>
public sealed record RecordResultCommand(
    Guid ActingUserId,
    Guid MatchId,
    ResultFidelity Fidelity,
    IReadOnlyList<TeamScore> TeamScores);
