namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A request by an authenticated user to read a match's availability tally — for each candidate
/// day, the count and identities of the active registered members whose current response marks
/// that day (Requirement 5.1). The tally is returned only when the requester holds an active
/// membership in the match's squad; any other requester (an inactive membership, a non-member, or
/// a request for a match that does not exist within a squad the requester belongs to) receives a
/// single uniform authorisation failure that discloses neither the tally nor whether the match
/// exists (Requirement 5.5, 5.6, 5.7).
/// <para>
/// <paramref name="SquadId"/> carries the squad named in the request path. It is <em>not</em> an
/// input to the authorisation decision — the requesting membership is resolved from the squad the
/// match records — and serves only to refuse a request whose path squad is not the match's squad,
/// with the same uniform authorisation failure the endpoint conceals as a not-found
/// (Requirement 7.3, 7.4, 7.6).
/// </para>
/// </summary>
/// <param name="RequestingUserId">The authenticated user requesting the availability tally.</param>
/// <param name="SquadId">The squad named in the request path; must be the match's own squad.</param>
/// <param name="MatchId">The match whose availability tally is requested.</param>
public sealed record GetAvailabilityTallyCommand(Guid RequestingUserId, Guid SquadId, Guid MatchId);
