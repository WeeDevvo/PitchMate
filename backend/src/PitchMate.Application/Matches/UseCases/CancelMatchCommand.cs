namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A request by an authenticated user to cancel a match that will not go ahead (Requirement 15).
/// The handler loads the squad-scoped match, resolves the acting user's membership in that match's
/// squad, and permits only an active registered owner or admin; every other actor (a plain member,
/// an inactive membership, a guest, or a non-member) — and a request for a match that cannot be
/// found — is rejected with a single uniform authorisation failure that discloses neither the squad
/// nor whether the match exists and leaves the match unchanged (Requirement 15.4, 2.4, 14.1, 14.2).
/// <para>
/// The cancellation itself is enforced by the <c>Match</c> aggregate: it is permitted only while the
/// match is in <c>GatheringAvailability</c>, <c>Confirmed</c>, or <c>TeamsRolled</c>, and is rejected
/// from the terminal or in-play states <c>InProgress</c>, <c>Completed</c>, and <c>Cancelled</c> with
/// an error naming the current state, leaving the match unchanged. Cancellation applies no rating
/// update and writes no rating snapshot (Requirement 15.1, 15.2, 15.3).
/// </para>
/// </summary>
/// <param name="ActingUserId">The authenticated user requesting the cancellation.</param>
/// <param name="MatchId">The match to cancel.</param>
public sealed record CancelMatchCommand(Guid ActingUserId, Guid MatchId);
