namespace PitchMate.Api.Matches.Endpoints;

/// <summary>
/// The body of a move-participant team adjustment (Requirement 8.3). Moves the participant
/// <paramref name="SquadMembershipId"/> onto the working team <paramref name="ToTeamId"/>, preserving
/// the exact partition of participants across teams. The acting admin is resolved from the access
/// token, never from the body.
/// </summary>
/// <param name="SquadMembershipId">The identity of the participant to move.</param>
/// <param name="ToTeamId">The identity of the destination working team.</param>
public sealed record MoveParticipantRequest(Guid SquadMembershipId, Guid ToTeamId);
