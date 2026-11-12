namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A request by an authenticated user to unlock a match's locked teams before kickoff, so players can
/// be added or removed and the teams re-locked. Only an active registered owner or admin may unlock;
/// every other actor, and a request for a match that cannot be found, is rejected with the single
/// uniform authorisation failure that discloses neither the squad nor whether the match exists.
/// </summary>
/// <param name="ActingUserId">The authenticated user requesting the unlock.</param>
/// <param name="MatchId">The match whose teams are unlocked.</param>
public sealed record UnlockTeamsCommand(Guid ActingUserId, Guid MatchId);
