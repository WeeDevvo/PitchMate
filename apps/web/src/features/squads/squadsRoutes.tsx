/**
 * The Squads_Feature's two route tables.
 *
 * The feature registers **nothing**. It builds two tables and hands them over;
 * the single application router at `src/app/appRouter.tsx` is the only module
 * that registers a route, and this feature declares no router of its own
 * (Requirement 18.4). What lives here is therefore the pairing of a path pattern
 * with the element that answers it, and nothing else — no provider, no guard, no
 * client construction.
 *
 * ### Why two tables rather than one
 *
 * The two feature routes belong on opposite sides of the App_Shell
 * (Requirement 18.5):
 *
 * | Path | Table | Behind the Route_Guard | Inside the shell frame |
 * | --- | --- | --- | --- |
 * | `/app/squads/:squadId` | {@link createSquadsShellRoutes} | yes | yes |
 * | `/join/:code` | {@link createSquadsPublicRoutes} | **no** | **no** |
 *
 * The Squad_Route is returned as **children of the shell's `/app` layout route**,
 * which is what puts it behind the Route_Guard and within the frame without this
 * feature restating either: `appRouter.tsx` nests these children into the table
 * `createShellRoutes` returns, so the guard, the providers, and the Shell_Frame
 * that wrap the shell's own Destinations wrap the Squad_Screen too.
 *
 * The Invite_Landing_Route is returned as a **top-level** route because its whole
 * purpose is to work for a visitor with no session: inside the guard it would
 * bounce to `/login` and lose the Invite_Secret, and inside the frame it would
 * render authenticated chrome to a stranger.
 *
 * Nothing here registers the Squads_Home. It is the shell's injected Home_Slot
 * content rather than a route, so exactly one screen resolves at the
 * Default_Authenticated_Route (Requirement 18.6) — `appRouter.tsx` passes it
 * through `createShellRoutes`' `destinationContent.home`.
 *
 * Nothing here registers the Player_Stats_Route either. That path is a seam a
 * later feature fills (Requirement 9.6); while it is unregistered, a request for
 * it falls to the shell's `/app/*` not-found handling, because `react-router`
 * ranks a dynamic segment above a splat and no dynamic route of this feature
 * matches it (Requirement 9.7).
 *
 * ### The child path is derived, not retyped
 *
 * `lib/routePaths.ts` owns every pattern of this feature, and a child of a layout
 * route is expressed relative to that route. Rather than spell the relative form
 * a second time — where it could drift from the pattern the path builders and the
 * later player-stats registration use — it is derived from {@link SQUAD_ROUTE} and
 * the shell's own {@link HOME_ROUTE}. One pattern, one place, whichever form a
 * consumer needs.
 *
 * Requirements: 9.6, 9.7, 18.4, 18.5, 18.6
 */
import type { ReactNode } from 'react';
import type { RouteObject } from 'react-router-dom';

import { HOME_ROUTE } from '../app-shell';
import type { SquadsApi } from './api/squadsApi';
import { INVITE_LANDING_ROUTE, SQUAD_ROUTE } from './lib/routePaths';
import { InviteLandingScreen } from './screens/InviteLandingScreen';
import { SquadScreen } from './screens/SquadScreen';

/**
 * A pattern beneath the App_Shell's route prefix, expressed relative to it — the
 * form a child of the shell's layout route takes.
 *
 * A pattern that does not sit beneath the prefix is returned unchanged, which
 * keeps the function total; the only caller passes one that does, and the
 * accompanying test pins the derived value.
 *
 * @param pattern an absolute route pattern from `lib/routePaths.ts`
 * @returns the pattern with the shell's prefix and its separator removed
 */
function relativeToShellPrefix(pattern: string): string {
  const prefix = `${HOME_ROUTE}/`;

  return pattern.startsWith(prefix) ? pattern.slice(prefix.length) : pattern;
}

/**
 * The Squad_Route as a child of the shell's `/app` layout route — `'squads/:squadId'`.
 *
 * The dynamic segment keeps the name `squadId` that {@link SQUAD_ROUTE} gives it,
 * which is what lets the Squad_Screen publish the App_Shell's Squad_Scope from the
 * route with no other wiring.
 */
const SQUAD_ROUTE_CHILD_PATH = relativeToShellPrefix(SQUAD_ROUTE);

/**
 * What both route tables are given by the application wiring.
 *
 * The feature constructs no Api_Client and no facade of its own
 * (Requirement 16.2): `appRouter.tsx` builds one Squads_Api from the
 * Authenticated_Api_Client and hands the same instance to every screen, the
 * unauthenticated Invite_Landing_Route included — `PreviewInvite` is anonymous
 * and needs no bearer, and `RedeemInvite` only ever runs while authenticated.
 */
export interface SquadsRoutesOptions {
  /** The Squads_Api facade every screen of the feature calls the backend through. */
  readonly api: SquadsApi;

  /**
   * The body of the Squad_Screen's matches Placeholder_Section, threaded through
   * so the later match-lifecycle feature fills the section without editing a
   * squads file (Requirement 15.3). Omit to render the placeholder statement.
   */
  readonly matchesContent?: ReactNode;

  /** The body of the Squad_Screen's stats Placeholder_Section. See {@link matchesContent}. */
  readonly statsContent?: ReactNode;
}

/**
 * Build the feature's routes that belong **inside** the App_Shell — the
 * Squad_Route, as children to nest into the shell's `/app` layout route
 * (Requirement 18.5).
 *
 * @example
 *   const shellRoutes = withNestedRoutes(
 *     createShellRoutes({ apiClient, signOut, destinationContent: { home: <SquadsHome api={api} /> } }),
 *     HOME_ROUTE,
 *     createSquadsShellRoutes({ api }),
 *   );
 *
 * Requirements: 15.3, 18.4, 18.5
 */
export function createSquadsShellRoutes({
  api,
  matchesContent,
  statsContent,
}: SquadsRoutesOptions): RouteObject[] {
  return [
    {
      path: SQUAD_ROUTE_CHILD_PATH,
      element: (
        <SquadScreen
          api={api}
          matchesContent={matchesContent}
          statsContent={statsContent}
        />
      ),
    },
  ];
}

/**
 * Build the feature's routes that belong **outside** both the Route_Guard and the
 * shell frame — the Invite_Landing_Route (Requirement 18.5).
 *
 * Spread the result into the application router's top-level route list, ahead of
 * the application catch-all and alongside the landing and auth subtrees.
 *
 * @example
 *   const router = createBrowserRouter([
 *     { path: '/', element: <LandingPage /> },
 *     ...createAuthRoutes(authOptions),
 *     ...shellRoutes,
 *     ...createSquadsPublicRoutes({ api }),
 *     { path: '*', element: <AppNotFound /> },
 *   ]);
 *
 * Requirements: 18.4, 18.5
 */
export function createSquadsPublicRoutes({
  api,
}: SquadsRoutesOptions): RouteObject[] {
  return [
    {
      path: INVITE_LANDING_ROUTE,
      element: <InviteLandingScreen api={api} />,
    },
  ];
}
