/**
 * The Player_Stats_Feature's one route table.
 *
 * The feature registers **nothing**. It builds a table and hands it over; the
 * single application router at `src/app/appRouter.tsx` is the only module that
 * registers a route, and this feature declares no router of its own
 * (Requirement 14.7). What lives here is therefore the pairing of a path pattern
 * with the element that answers it, and nothing else — no provider, no guard, no
 * client construction.
 *
 * ### One table, inside the shell
 *
 * The Player_Stats_Route belongs behind the Route_Guard and inside the shell
 * frame (Requirement 1.1), so the table is returned as **children of the shell's
 * `/app` layout route**: `appRouter.tsx` nests these children into the table
 * `createShellRoutes` returns, which is what puts the screen behind the guard
 * and within the frame without this feature restating either. The shell's
 * navigation, notification surface, and account menu are therefore present
 * around the screen, and the Squad_Scope the screen publishes reaches the shell
 * surfaces that read it.
 *
 * There is no public counterpart to this table. Every surface of this feature is
 * squad-scoped and member-only, so none of it is reachable without a session.
 *
 * ### The pattern is imported, and the child path derived
 *
 * The Squads_Feature's barrel owns {@link PLAYER_STATS_ROUTE} — it is the seam
 * that feature published for this one, and the same value its Player_Rows build
 * their paths from. Requirement 1.2 has this feature *obtain* the pattern and
 * declare none of its own, so the pattern the rows link to and the pattern
 * registered here cannot drift apart.
 *
 * A child of a layout route is expressed relative to that route, and rather than
 * spell that relative form a second time it is derived from the imported pattern
 * and the shell's own {@link HOME_ROUTE} by {@link relativeToShellPrefix} — the
 * same derivation `squadsRoutes.tsx` already uses, for the same reason. One
 * pattern, one place, whichever form a consumer needs; and no literal matching
 * the Player_Stats_Route or the Squad_Route appears in this feature
 * (Requirement 1.7).
 *
 * The dynamic segments keep the names {@link PLAYER_STATS_ROUTE} gives them,
 * which is what lets the screen read its subject from the route alone and
 * publish the Squad_Scope with no argument: the squad segment is named `squadId`,
 * matching the App_Shell's own `SQUAD_SCOPE_ROUTE_PARAMETER`.
 *
 * Registering this pattern takes the path away from the shell's `/app/*`
 * not-found handling — `react-router` ranks a two-dynamic-segment pattern above
 * both `squads/:squadId` and the splat — without a shell or squads file
 * changing.
 *
 * Requirements: 1.1, 1.2, 1.7, 14.1, 14.7
 */
import type { RouteObject } from 'react-router-dom';

import { HOME_ROUTE } from '../app-shell';
import { PLAYER_STATS_ROUTE } from '../squads';
import type { PlayerStatsApi } from './api/playerStatsApi';
import { PlayerStatsScreen } from './screens/PlayerStatsScreen';

/**
 * A pattern beneath the App_Shell's route prefix, expressed relative to it — the
 * form a child of the shell's layout route takes.
 *
 * A pattern that does not sit beneath the prefix is returned unchanged, which
 * keeps the function total; the only caller passes one that does, and the
 * accompanying test pins the derived value.
 *
 * @param pattern an absolute route pattern, here the Squads_Feature's
 *   {@link PLAYER_STATS_ROUTE}
 * @returns the pattern with the shell's prefix and its separator removed
 */
function relativeToShellPrefix(pattern: string): string {
  const prefix = `${HOME_ROUTE}/`;

  return pattern.startsWith(prefix) ? pattern.slice(prefix.length) : pattern;
}

/**
 * The Player_Stats_Route as a child of the shell's `/app` layout route —
 * `'squads/:squadId/players/:membershipId'`.
 *
 * Derived from the imported pattern, never retyped.
 */
const PLAYER_STATS_CHILD_PATH = relativeToShellPrefix(PLAYER_STATS_ROUTE);

/**
 * What the route table is given by the application wiring.
 *
 * The feature constructs no Api_Client and no facade of its own
 * (Requirement 12.1): `appRouter.tsx` builds one Player_Stats_Api from the
 * Authenticated_Api_Client and hands the instance in.
 */
export interface PlayerStatsRoutesOptions {
  /** The Player_Stats_Api facade the screen calls the backend through. */
  readonly api: PlayerStatsApi;
}

/**
 * Build the feature's routes, as children to nest into the App_Shell's `/app`
 * layout route (Requirement 1.1).
 *
 * @example
 *   const shellRoutes = withNestedRoutes(
 *     createShellRoutes({ apiClient, signOut, destinationContent }),
 *     HOME_ROUTE,
 *     [
 *       ...createSquadsShellRoutes({ api: squadsApi }),
 *       ...createPlayerStatsShellRoutes({ api: playerStatsApi }),
 *     ],
 *   );
 *
 * Requirements: 1.1, 1.2, 14.7
 */
export function createPlayerStatsShellRoutes({
  api,
}: PlayerStatsRoutesOptions): RouteObject[] {
  return [
    {
      path: PLAYER_STATS_CHILD_PATH,
      element: <PlayerStatsScreen api={api} />,
    },
  ];
}
