namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A member's request to leave a confirmed match they are playing in.
/// </summary>
/// <param name="ActingUserId">The authenticated user leaving; must be an active registered member of the match's squad.</param>
/// <param name="SquadId">The squad named in the request path; must be the match's own squad.</param>
/// <param name="MatchId">The match to leave; must be in <c>Confirmed</c>.</param>
public sealed record LeaveMatchCommand(Guid ActingUserId, Guid SquadId, Guid MatchId);
