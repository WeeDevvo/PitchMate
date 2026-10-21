/**
 * The Matches_Feature's route patterns and path builders.
 *
 * Both patterns are derived from the Squads_Feature's published `SQUAD_ROUTE`
 * rather than restated, so a match always sits beneath the squad it belongs to
 * and the two cannot drift. `react-router` ranks the static `matches/new`
 * segment above the dynamic `matches/:matchId`, so "new" is never read as an
 * identity.
 */
import { SQUAD_ROUTE, squadPath } from '../../squads';

/** The route parameter that names the match. */
export const MATCH_ROUTE_PARAMETER = 'matchId';

/** The create-match screen: `/app/squads/:squadId/matches/new`. */
export const NEW_MATCH_ROUTE = `${SQUAD_ROUTE}/matches/new`;

/** The match screen: `/app/squads/:squadId/matches/:matchId`. */
export const MATCH_ROUTE = `${SQUAD_ROUTE}/matches/:${MATCH_ROUTE_PARAMETER}`;

/** The create-match path for one squad. */
export function newMatchPath(squadId: string): string {
  return `${squadPath(squadId)}/matches/new`;
}

/** The path of one match within its squad. */
export function matchPath(squadId: string, matchId: string): string {
  return `${squadPath(squadId)}/matches/${encodeURIComponent(matchId)}`;
}
