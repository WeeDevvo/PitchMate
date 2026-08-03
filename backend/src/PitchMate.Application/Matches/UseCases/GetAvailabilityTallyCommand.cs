namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A request by an authenticated user to read a match's availability tally — for each candidate
/// day, the count and identities of the active registered members whose current response marks
/// that day (Requirement 5.1). The tally is returned only when the requester holds an active
/// membership in the match's squad; any other requester (an inactive membership, a non-member, or
/// a request for a match that does not exist within a squad the requester belongs to) receives a
/// single uniform authorisation failure that discloses neither the tally nor whether the match
/// exists (Requirement 5.5, 5.6, 5.7).
/// </summary>
/// <param name="RequestingUserId">The authenticated user requesting the availability tally.</param>
/// <param name="MatchId">The match whose availability tally is requested.</param>
public sealed record GetAvailabilityTallyCommand(Guid RequestingUserId, Guid MatchId);
