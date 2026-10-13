namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A request by an authenticated user to confirm a match on one of its candidate days
/// (Requirement 6.1). The handler loads the match, resolves the acting user's membership in the
/// match's squad, and permits only an active registered owner or admin (Requirement 6.7). The match
/// must be in <c>GatheringAvailability</c>, <paramref name="Day"/> must resolve (by instant) to one
/// of the match's candidate days (Requirement 6.4), and that day's count of available active
/// registered members must meet the squad's <c>Minimum_Player_Threshold</c> (Requirement 6.1, 6.2).
/// On success the match transitions to <c>Confirmed</c>, the day becomes the confirmed day, and the
/// playing pool is seeded from the members whose response marks it (Requirement 6.5).
/// <para>
/// <paramref name="SquadId"/> carries the squad named in the request path. It is <em>not</em> an
/// input to the authorisation decision — the acting membership is resolved from the squad the match
/// records — and serves only to refuse a request whose path squad is not the match's squad, with the
/// same uniform authorisation failure, mutating nothing (Requirement 7.3, 7.4, 7.6).
/// </para>
/// </summary>
/// <param name="ActingUserId">The authenticated user requesting the confirmation.</param>
/// <param name="SquadId">The squad named in the request path; must be the match's own squad.</param>
/// <param name="MatchId">The match to confirm.</param>
/// <param name="Day">The candidate day to confirm on; must resolve, by instant, to one of the match's candidate days.</param>
public sealed record ConfirmMatchCommand(
    Guid ActingUserId,
    Guid SquadId,
    Guid MatchId,
    DateTimeOffset Day);
