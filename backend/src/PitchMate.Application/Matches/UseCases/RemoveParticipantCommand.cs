namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A request by an authenticated user to remove a previously added participant from a confirmed
/// match's playing pool (Requirement 7.2). The handler loads the squad-scoped match identified by
/// <paramref name="MatchId"/>, resolves the acting user's membership in that match's squad, and
/// permits only an active registered owner or admin (Requirement 14.1, 14.2). The registered or guest
/// participant backed by <paramref name="SquadMembershipId"/> is removed; a membership that is not
/// currently a participant is rejected with a not-a-participant error, leaving the participant set
/// unchanged (Requirement 7.5).
/// <para>
/// <paramref name="SquadId"/> carries the squad named in the request path. It is <em>not</em> an
/// input to the authorisation decision — the acting membership is resolved from the squad the match
/// records — and serves only to refuse a request whose path squad is not the match's squad, with the
/// same uniform authorisation failure, mutating nothing (Requirement 7.3, 7.4, 7.6).
/// </para>
/// </summary>
/// <param name="ActingUserId">The authenticated user requesting the removal.</param>
/// <param name="SquadId">The squad named in the request path; must be the match's own squad.</param>
/// <param name="MatchId">The match the participant is removed from; must be in <c>Confirmed</c>.</param>
/// <param name="SquadMembershipId">The participating squad membership to remove.</param>
public sealed record RemoveParticipantCommand(
    Guid ActingUserId,
    Guid SquadId,
    Guid MatchId,
    Guid SquadMembershipId);
