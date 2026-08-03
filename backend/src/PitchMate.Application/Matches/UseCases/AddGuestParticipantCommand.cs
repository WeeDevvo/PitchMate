namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A request by an authenticated user to add a guest to a confirmed match's playing pool
/// (Requirement 7.1). The handler loads the squad-scoped match identified by
/// <paramref name="MatchId"/>, resolves the acting user's membership in that match's squad, and
/// permits only an active registered owner or admin (Requirement 14.1, 14.2). The membership
/// identified by <paramref name="GuestMembershipId"/> is resolved and validated: it must be an
/// active guest membership belonging to the match's squad, else the addition is rejected with a
/// validation error identifying the ineligible membership and the participant set is left unchanged
/// (Requirement 7.3, 7.7). Adding a membership that is already a participant is rejected as a
/// duplicate while retaining it as exactly one participant (Requirement 7.4).
/// </summary>
/// <param name="ActingUserId">The authenticated user requesting the addition.</param>
/// <param name="MatchId">The match the guest is added to; must be in <c>Confirmed</c>.</param>
/// <param name="GuestMembershipId">The active guest squad membership to add as a participant.</param>
public sealed record AddGuestParticipantCommand(
    Guid ActingUserId,
    Guid MatchId,
    Guid GuestMembershipId);
