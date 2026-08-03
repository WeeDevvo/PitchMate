namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A request by an authenticated user to remove a previously added participant from a confirmed
/// match's playing pool (Requirement 7.2). The handler loads the squad-scoped match identified by
/// <paramref name="MatchId"/>, resolves the acting user's membership in that match's squad, and
/// permits only an active registered owner or admin (Requirement 14.1, 14.2). The registered or guest
/// participant backed by <paramref name="SquadMembershipId"/> is removed; a membership that is not
/// currently a participant is rejected with a not-a-participant error, leaving the participant set
/// unchanged (Requirement 7.5).
/// </summary>
/// <param name="ActingUserId">The authenticated user requesting the removal.</param>
/// <param name="MatchId">The match the participant is removed from; must be in <c>Confirmed</c>.</param>
/// <param name="SquadMembershipId">The participating squad membership to remove.</param>
public sealed record RemoveParticipantCommand(
    Guid ActingUserId,
    Guid MatchId,
    Guid SquadMembershipId);
