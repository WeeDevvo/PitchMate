namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A request by an authenticated user to add a member or guest to a confirmed match's playing pool
/// (Requirement 7.1). The handler loads the squad-scoped match identified by
/// <paramref name="MatchId"/>, resolves the acting user's membership in that match's squad, and
/// permits only an active registered owner or admin (Requirement 14.1, 14.2). The membership
/// identified by <paramref name="MembershipId"/> is resolved and validated: it must be an active
/// membership, registered or guest, belonging to the match's squad, else the addition is rejected with a
/// validation error identifying the ineligible membership and the participant set is left unchanged
/// (Requirement 7.3, 7.7). Adding a membership that is already a participant is rejected as a
/// duplicate while retaining it as exactly one participant (Requirement 7.4).
/// <para>
/// <paramref name="SquadId"/> carries the squad named in the request path. It is <em>not</em> an
/// input to the authorisation decision — the acting membership is resolved from the squad the match
/// records — and serves only to refuse a request whose path squad is not the match's squad, with the
/// same uniform authorisation failure, mutating nothing (Requirement 7.3, 7.4, 7.6).
/// </para>
/// </summary>
/// <param name="ActingUserId">The authenticated user requesting the addition.</param>
/// <param name="SquadId">The squad named in the request path; must be the match's own squad.</param>
/// <param name="MatchId">The match the player is added to; must be in <c>Confirmed</c>.</param>
/// <param name="MembershipId">The active squad membership, registered or guest, to add as a participant.</param>
public sealed record AddParticipantCommand(
    Guid ActingUserId,
    Guid SquadId,
    Guid MatchId,
    Guid MembershipId);
