/**
 * Route-path registration scan over the assembled application table (task 17.6).
 *
 * The Squads_Feature registers nothing itself: it hands over two tables and
 * `src/app/appRouter.tsx` places them on opposite sides of the App_Shell — the
 * Squad_Route nested into the shell's `/app` layout route, the
 * Invite_Landing_Route at the application's top level (Requirement 18.5).
 * Requirement 18.10 is the rule that keeps those placements safe: no path this
 * feature registers may collide with one the Auth_Feature, the App_Shell, or the
 * marketing landing route already registers. A collision is silent —
 * `react-router` scores two identical patterns the same and breaks the tie by
 * registration order — so the loser simply stops being reachable, with no error
 * anywhere.
 *
 * ### What this scan is, next to Property 48
 *
 * Property 48 (`appRouter.squads.property.test.tsx`) quantifies over *how* the
 * table is assembled — the reported Auth_State, which Destination bodies are
 * injected, how many times the table is built — and compares the result against
 * an **expected set of patterns** declared from each contributor's exports. That
 * is a strong claim, and it is a claim about a table assembled through the test
 * harness's stubbed seams.
 *
 * This scan makes the narrower claim over a wider subject:
 *
 * - it asserts over `createAppRoutes()` **with no seam supplied at all**, which is
 *   the assembly `main.tsx` performs — the real auth config read from the build
 *   environment, the real unauthenticated backend facade, the real
 *   browser-storage Session_Manager (bootstrapped from an empty store), the real
 *   Authenticated_Api_Client, and the Squads_Home defaulted into the shell's
 *   Home_Slot. Nothing renders and no call is issued, so none of that reaches the
 *   network: the subject is the table, and the table is all that is built;
 * - it declares **no expected set**. Uniqueness is read off the table itself, so
 *   a path nobody predicted still has to be registered once. Where Property 48
 *   would fail because a new path is not in its expectation set, this fails only
 *   where a path is genuinely registered twice — and names it.
 *
 * ### Non-vacuity
 *
 * A walk that resolved nothing would satisfy "no duplicates" trivially, so the
 * scan also pins that the walk found the paths it is meant to be about: the first
 * test fixes the resolution rules against a miniature table of the same shape as
 * the production one, and the second asserts that every contributor's paths — the
 * landing route, the five auth paths, the four Destination paths, both catch-alls,
 * and **this feature's `/app/squads/:squadId` and `/join/:code`** — are each
 * present exactly once, with a count at least as large as those contributors
 * together demand.
 *
 * Requirements: 18.10
 */
import { describe, expect, it } from 'vitest';
import type { RouteObject } from 'react-router-dom';

import { AUTH_ROUTE_PATHS } from '../features/auth';
import { HOME_ROUTE, SHELL_DESTINATIONS } from '../features/app-shell';
import { INVITE_LANDING_ROUTE, SQUAD_ROUTE } from '../features/squads';
import { APP_CATCH_ALL_ROUTE, LANDING_ROUTE } from './appRoutePaths';
import { createAppRoutes } from './appRouter';
import { registeredPaths } from './appRouterTestHarness';

/**
 * The paths registered more than once, as `path (n×)`, so a failure names the
 * offending pattern rather than reporting only that a count was wrong.
 */
function duplicatedPaths(paths: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const path of paths) {
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([path, count]) => `${path} (${count}×)`)
    .sort();
}

/** How many times `path` appears in the flattened table. */
function registrationsOf(paths: readonly string[], path: string): number {
  return paths.filter((registered) => registered === path).length;
}

describe('appRouter — route-path registration scan', () => {
  it('resolves a full path for every matchable route of a table of the production shape', () => {
    // The same arrangement the application assembles, as plain data: a top-level
    // route, a pathless layout route (the session providers) wrapping a layout
    // route with an index child, a *relative* child of that layout route (how the
    // squads feature hands over its Squad_Route), and the application catch-all.
    const table: RouteObject[] = [
      { path: '/' },
      {
        children: [
          {
            path: '/app',
            children: [
              { index: true },
              { path: '/app/settings' },
              { path: 'squads/:squadId' },
              { path: '*' },
            ],
          },
        ],
      },
      { path: '/join/:code' },
      { path: '*' },
    ];

    // An index child resolves to the path of the route it indexes, an absolute
    // child stands as it is, a relative child is joined onto its parent, and the
    // `*` child of `/app` claims `/app/*` rather than the bare `*`.
    expect(registeredPaths(table)).toEqual([
      '/',
      '/app',
      '/app/settings',
      '/app/squads/:squadId',
      '/app/*',
      '/join/:code',
      '*',
    ]);

    // And the detector below reports a repeat rather than always reporting none:
    // this table registers `/app/*` and the bare `*` as two different claims, so
    // an empty report there has to be a real absence of duplicates.
    expect(duplicatedPaths(registeredPaths(table))).toEqual([]);
    expect(duplicatedPaths([...registeredPaths(table), '/app'])).toEqual([
      '/app (2×)',
    ]);
  });

  it('registers every path of the unstubbed production assembly exactly once', () => {
    const paths = registeredPaths(createAppRoutes());

    // 18.10: nothing registered twice, anywhere in the assembled table.
    expect(duplicatedPaths(paths)).toEqual([]);

    // Non-vacuity: the walk resolved a path for every contributor's routes, not
    // an empty or truncated list that no duplicate could appear in. The bound is
    // derived from the contributors' own exports — the landing route, the auth
    // paths, the Destination paths, and this feature's two — so a contributor
    // gaining a path raises it rather than leaving the new path unexamined.
    expect(paths.length).toBeGreaterThanOrEqual(
      1 + AUTH_ROUTE_PATHS.length + SHELL_DESTINATIONS.length + 2,
    );
    for (const path of paths) {
      expect(path.length).toBeGreaterThan(0);
    }

    // … and each named path is there, once: this feature's two included, which is
    // what puts its two tables genuinely in the scan's scope.
    for (const path of [
      LANDING_ROUTE,
      ...AUTH_ROUTE_PATHS,
      ...SHELL_DESTINATIONS.map((destination) => destination.path),
      HOME_ROUTE,
      `${HOME_ROUTE}/${APP_CATCH_ALL_ROUTE}`,
      SQUAD_ROUTE,
      INVITE_LANDING_ROUTE,
      APP_CATCH_ALL_ROUTE,
    ]) {
      expect(registrationsOf(paths, path)).toBe(1);
    }
  });
});
