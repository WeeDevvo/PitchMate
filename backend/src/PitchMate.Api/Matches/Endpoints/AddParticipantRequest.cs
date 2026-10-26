namespace PitchMate.Api.Matches.Endpoints;

/// <summary>
/// The body of an add-participant request. The <paramref name="MembershipId"/> must identify an
/// active membership, registered or guest, belonging to the match's squad, validated by the
/// <c>Match</c> aggregate. The acting admin is resolved from the access token, never from the body.
/// </summary>
/// <param name="MembershipId">The active squad membership to add as a participant.</param>
public sealed record AddParticipantRequest(Guid MembershipId);
