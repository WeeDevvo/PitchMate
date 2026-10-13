namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A request by an authenticated user to clear their own availability response for a match while it
/// is gathering availability, reverting the member to having no stored response (Requirement 4.3).
/// Clearing when the member has no stored response is a success that changes nothing.
/// <para>
/// The acting user is resolved from the authenticated subject, never a body value, and must be an
/// active registered member of the match's squad; a guest, inactive, or non-member is rejected with a
/// uniform authorisation failure and nothing is changed (Requirement 4.5, 7.6).
/// </para>
/// <para>
/// <paramref name="SquadId"/> carries the squad named in the request path. It is <em>not</em> an
/// input to the authorisation decision — the acting membership is resolved from the squad the match
/// records — and serves only to refuse a request whose path squad is not the match's squad, with the
/// same uniform authorisation failure, mutating nothing (Requirement 7.3, 7.4, 7.6).
/// </para>
/// </summary>
/// <param name="ActingUserId">The authenticated user clearing their response.</param>
/// <param name="SquadId">The squad named in the request path; must be the match's own squad.</param>
/// <param name="MatchId">The match whose response is cleared.</param>
public sealed record ClearAvailabilityResponseCommand(
    Guid ActingUserId,
    Guid SquadId,
    Guid MatchId);
