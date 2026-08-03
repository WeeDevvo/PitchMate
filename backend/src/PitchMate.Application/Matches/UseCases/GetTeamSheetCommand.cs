namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A request by an authenticated user to read a match's <see cref="Domain.Matches.TeamSheet"/> —
/// the match location, confirmed day, and each team with its name, bib flag, and roster of
/// participant display names in roster order (Requirement 9.1, 9.2). The team sheet is returned
/// only when the requester holds an active membership in the match's squad; any other requester
/// (an inactive membership, a non-member, or a request for a match that does not exist within a
/// squad the requester belongs to) receives a single uniform authorisation failure that discloses
/// no content and does not reveal whether the match exists (Requirement 9.4, 9.5).
/// </summary>
/// <param name="RequestingUserId">The authenticated user requesting the team sheet.</param>
/// <param name="MatchId">The match whose team sheet is requested.</param>
public sealed record GetTeamSheetCommand(Guid RequestingUserId, Guid MatchId);
