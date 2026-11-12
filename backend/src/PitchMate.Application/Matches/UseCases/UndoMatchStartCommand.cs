namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A request by an authenticated user to undo a match's kickoff, made by mistake, while nothing has
/// been recorded for it yet. Only an active registered owner or admin may undo; every other actor,
/// and a request for a match that cannot be found, is rejected with the single uniform authorisation
/// failure that discloses neither the squad nor whether the match exists.
/// </summary>
/// <param name="ActingUserId">The authenticated user requesting the undo.</param>
/// <param name="MatchId">The match whose kickoff is undone.</param>
public sealed record UndoMatchStartCommand(Guid ActingUserId, Guid MatchId);
