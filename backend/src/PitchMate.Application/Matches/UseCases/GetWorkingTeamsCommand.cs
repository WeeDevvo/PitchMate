namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A request by an authenticated user to read a match's working teams (match-read-models
/// Requirement 4.1). Only an organiser of the match's squad — an active, non-guest owner or admin —
/// is answered; anyone else, and a match that is absent, soft-deleted or in a squad that is not
/// visible, receives the single uniform authorisation failure (Requirements 5.2, 5.13).
/// </summary>
/// <param name="RequestingUserId">The authenticated user requesting the working teams.</param>
/// <param name="MatchId">The match named in the request path.</param>
public sealed record GetWorkingTeamsCommand(Guid RequestingUserId, Guid MatchId);
