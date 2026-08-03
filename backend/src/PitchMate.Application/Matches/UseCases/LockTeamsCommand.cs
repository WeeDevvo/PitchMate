namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A request by an authenticated user to lock the working teams of a match, producing the team
/// sheet and capturing the immutable kickoff lineup (Requirement 8.5, 8.6, 8.7, 9.3, 10.1). The
/// handler loads the squad-scoped match, resolves the acting user's membership in that match's
/// squad, and permits only an active registered owner or admin; every other actor (a plain member,
/// an inactive membership, a guest, or a non-member) — and a request for a match that cannot be
/// found — is rejected with a single uniform authorisation failure that discloses neither the squad
/// nor whether the match exists (Requirement 14.1, 14.2).
/// <para>
/// The lock itself is enforced by the <c>Match</c> aggregate: each team must hold 5..8 players
/// (uneven such as 7v6 allowed), exactly one team must be flagged to wear bibs, and team names must
/// be 1..50 characters trimmed and distinct case-insensitively. On success the match transitions to
/// <c>TeamsRolled</c> and captures the kickoff lineup; on failure the unmet rule is named and the
/// match is left unchanged (Requirement 8.5, 8.6, 8.7, 2.3).
/// </para>
/// </summary>
/// <param name="ActingUserId">The authenticated user requesting the lock.</param>
/// <param name="MatchId">The match whose working teams are locked.</param>
public sealed record LockTeamsCommand(Guid ActingUserId, Guid MatchId);
