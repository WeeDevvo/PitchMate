namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A request by an authenticated organiser to adjust a match's working teams (Requirement 8.3). The
/// handler resolves the acting user's membership in the match's squad and permits only an active
/// registered owner or admin (Requirement 14.1, 14.2). The single <paramref name="Adjustment"/>
/// describes the edit to apply — a move, a re-roll, a rename, or a bib-team choice — which the handler
/// maps onto the <c>Match</c> aggregate's team-editing behaviour and commits atomically
/// (Requirement 8.2, 8.3, 8.4).
/// </summary>
/// <param name="ActingUserId">The authenticated user requesting the adjustment.</param>
/// <param name="MatchId">The match whose working teams are adjusted.</param>
/// <param name="Adjustment">The single team adjustment to apply.</param>
public sealed record AdjustTeamsCommand(Guid ActingUserId, Guid MatchId, TeamAdjustment Adjustment);
