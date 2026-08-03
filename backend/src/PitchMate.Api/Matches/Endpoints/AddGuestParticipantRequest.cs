namespace PitchMate.Api.Matches.Endpoints;

/// <summary>
/// The body of an add-guest-participant request (Requirement 7.1). The
/// <paramref name="GuestMembershipId"/> must identify an active guest membership belonging to the
/// match's squad, validated by the handler and the <c>Match</c> aggregate. The acting admin is
/// resolved from the access token, never from the body.
/// </summary>
/// <param name="GuestMembershipId">The active guest squad membership to add as a participant.</param>
public sealed record AddGuestParticipantRequest(Guid GuestMembershipId);
