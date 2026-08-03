namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A request by an authenticated user to complete an in-progress match, applying its single rating
/// update and recording per-participant μ/σ snapshots atomically (Requirement 12.1, 12.2). The
/// handler loads the squad-scoped match identified by <paramref name="MatchId"/>, resolves the acting
/// user's membership in that match's squad, and permits only an active registered owner or admin
/// (Requirement 14.1, 14.2).
/// <para>
/// The match must be <c>InProgress</c> with a recorded result: completing derives the outcome from
/// the immutable kickoff lineup, applies exactly one rating update, transitions the match to
/// <c>Completed</c>, and writes one snapshot per participant. Completion is idempotent — a match that
/// is already <c>Completed</c> is a success that returns the originally recorded result and applies no
/// further rating update, so a retry from a flaky client carries the same identity and changes nothing
/// (Requirement 12.7, 13.2, 13.5).
/// </para>
/// </summary>
/// <param name="ActingUserId">The authenticated user requesting the completion.</param>
/// <param name="MatchId">The match to complete; must be <c>InProgress</c> with a recorded result, or already <c>Completed</c>.</param>
public sealed record CompleteMatchCommand(
    Guid ActingUserId,
    Guid MatchId);
