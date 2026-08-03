namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A request by an authenticated user to start a match — transitioning it from
/// <c>TeamsRolled</c> to <c>InProgress</c> so play can begin and a result can later be recorded
/// (Requirement 11.1, 2.3). The handler loads the squad-scoped match, resolves the acting user's
/// membership in that match's squad, and permits only an active registered owner or admin; every
/// other actor (a plain member, an inactive membership, a guest, or a non-member) — and a request
/// for a match that cannot be found — is rejected with a single uniform authorisation failure that
/// discloses neither the squad nor whether the match exists (Requirement 14.1, 14.2).
/// <para>
/// The transition itself is enforced by the <c>Match</c> aggregate: <c>Match.Start</c> asserts the
/// match is in <c>TeamsRolled</c> and, on success, moves it to <c>InProgress</c> while retaining the
/// immutable kickoff lineup captured at team lock; on failure it names the required and current
/// state and leaves the match unchanged (Requirement 11.1, 2.3).
/// </para>
/// </summary>
/// <param name="ActingUserId">The authenticated user requesting the start.</param>
/// <param name="MatchId">The match to transition into play.</param>
public sealed record StartMatchCommand(Guid ActingUserId, Guid MatchId);
