namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A member's request to join a confirmed match as a player themselves.
/// </summary>
/// <param name="ActingUserId">The authenticated user joining; must be an active registered member of the match's squad.</param>
/// <param name="SquadId">The squad named in the request path; must be the match's own squad.</param>
/// <param name="MatchId">The match to join; must be in <c>Confirmed</c>.</param>
public sealed record JoinMatchCommand(Guid ActingUserId, Guid SquadId, Guid MatchId);
