/**
 * Property test for the assembled application router (task 15.2).
 *
 * Before `src/app/appRouter.tsx` existed the application registered `/` alone:
 * the Auth_Feature's route table was built and never mounted, so `/login`
 * resolved to no registered route. Requirement 15.6 fixes the shape of the fix —
 * **one** router carrying the marketing landing route, every Auth_Feature route
 * path, and the App_Shell routes, each registered **exactly once**, each
 * resolving to its own screen.
 *
 * ### What is generated
 *
 * One axis: the route path, drawn from the three tables that contribute to the
 * router — the landing route `/`, the Auth_Feature's `AUTH_ROUTE_PATHS`, and the
 * App_Shell's `SHELL_DESTINATIONS`. The paths are read from those tables rather
 * than restated here, so a table gaining or moving a path moves this property
 * with it instead of quietly leaving the new path unexercised. A guard before the
 * property asserts the expectation table covers every auth path and every
 * Destination path, so the generator can never shrink to a vacuous subset.
 *
 * ### What is asserted, for each generated path
 *
 * 1. **Exactly once.** The path appears once in the flattened route table.
 *    Flattening resolves a pathless layout route (the auth table's providers, the
 *    shell subtree's session providers) to its parent's path and an index child
 *    to the route it indexes, which is how `react-router` matches them — so
 *    `/app` registered as the shell layout route plus its index child counts as
 *    one registration, not two.
 * 2. **Its own screen.** Mounting the real assembled table at that path renders
 *    the one level-one heading of the screen that path belongs to: the landing
 *    page's value proposition, the auth screen's heading, or the Destination's
 *    content. A path resolving to a *different* registered screen — the failure
 *    mode Requirement 15.6 is about, where a stray catch-all or an overlapping
 *    path swallows a sibling — fails here, because every screen in the table
 *    heads itself distinctly.
 *
 * ### The auth table's own `*` child
 *
 * The Auth_Feature's table carries a `*` child inside its **pathless** layout
 * route, which registers the bare path `*` — the application catch-all's path.
 * `appRouter` drops that one child as it registers the subtree (see its module
 * note), so the auth table's contribution here is its five concrete paths. The
 * catch-all behaviour itself is Property 38's, not this property's.
 *
 * ### The injected seams
 *
 * The router is assembled by the production `createAppRoutes` through
 * `appRouterTestHarness`, with only the outside world stubbed: an authenticated
 * Session_Manager (so the Route_Guard
 * admits the shell routes), an Authenticated_Api_Client answering every
 * notification call at once (so nothing touches the network), an inert auth
 * backend facade, and Destination_Content for Home and Profile, which take their
 * bodies from outside the shell. Everything else — the landing route, the auth
 * table, the shell table, the providers, the catch-alls — is the real thing.
 *
 * Feature: app-shell, Property 37: The application router registers every route path exactly once
 * Validates: Requirements 15.6
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import fc from 'fast-check';
import { type RouteObject } from 'react-router-dom';

import {
  AUTH_ROUTE_PATHS,
  LOG_IN_HEADING,
  LOG_IN_ROUTE,
  RESET_CONFIRM_HEADING,
  RESET_CONFIRM_ROUTE,
  RESET_REQUEST_HEADING,
  RESET_REQUEST_ROUTE,
  SIGN_UP_HEADING,
  SIGN_UP_ROUTE,
  VERIFY_EMAIL_HEADING,
  VERIFY_EMAIL_ROUTE,
} from '../features/auth';
import { SHELL_DESTINATIONS, type DestinationId } from '../features/app-shell';
import { landingContent } from '../features/landing/content/landingContent';
import { LANDING_ROUTE } from './appRoutePaths';
import {
  assembleRoutes,
  HOME_CONTENT_HEADING,
  PROFILE_CONTENT_HEADING,
  renderAt,
  resetThemeAttribute,
} from './appRouterTestHarness';

// --- The screens the three tables contribute --------------------------------

/** A registered route path together with the level-one heading it must reach. */
interface RegisteredScreen {
  /** The registered route path. */
  readonly path: string;
  /** The level-one heading of the screen that path resolves to. */
  readonly heading: string;
}

/**
 * The level-one heading each Destination's content renders.
 *
 * Home and Profile take their bodies from outside the shell, so their headings
 * are the ones injected below. Notifications and Settings are supplied by the
 * shell itself and head themselves with the Destination's registered label
 * (Requirements 3.8, 3.9), which is read from `SHELL_DESTINATIONS` rather than
 * restated.
 */
function destinationHeading(destination: {
  readonly id: DestinationId;
  readonly label: string;
}): string {
  switch (destination.id) {
    case 'home':
      return HOME_CONTENT_HEADING;
    case 'profile':
      return PROFILE_CONTENT_HEADING;
    default:
      return destination.label;
  }
}

/**
 * Every path the landing route, the auth table, and the shell table register,
 * with the screen each must reach.
 */
const REGISTERED_SCREENS: readonly RegisteredScreen[] = [
  { path: LANDING_ROUTE, heading: landingContent.hero.headline },

  { path: SIGN_UP_ROUTE, heading: SIGN_UP_HEADING },
  { path: LOG_IN_ROUTE, heading: LOG_IN_HEADING },
  { path: RESET_REQUEST_ROUTE, heading: RESET_REQUEST_HEADING },
  { path: RESET_CONFIRM_ROUTE, heading: RESET_CONFIRM_HEADING },
  { path: VERIFY_EMAIL_ROUTE, heading: VERIFY_EMAIL_HEADING },

  ...SHELL_DESTINATIONS.map((destination) => ({
    path: destination.path,
    heading: destinationHeading(destination),
  })),
];

// --- Flattening the assembled table -----------------------------------------

/** Join a parent's resolved path with a relative child path segment. */
function joinPath(parentPath: string, childPath: string): string {
  return `${parentPath.replace(/\/$/, '')}/${childPath}`;
}

/**
 * Every path the assembled table registers, one entry per matchable route.
 *
 * A route contributes a path only where a screen sits: a layout route with
 * children contributes through its children, an index child contributes the path
 * of the route it indexes, and a pathless layout route contributes its parent's
 * path — which is how `react-router` matches each of them. A child path starting
 * with `/` is already absolute (the auth screens and the shell Destinations are
 * registered that way); anything else is joined onto its parent, or taken as it
 * stands at the top level, where the application catch-all `*` sits.
 *
 * Over the assembled table it yields exactly: `/`, the five auth paths, `/app`
 * and its three Destination paths, `/app/*`, and `*`.
 */
function registeredPaths(
  routes: readonly RouteObject[],
  parentPath = '',
): string[] {
  const paths: string[] = [];

  for (const route of routes) {
    const ownPath =
      route.path === undefined
        ? parentPath
        : route.path.startsWith('/') || parentPath === ''
          ? route.path
          : joinPath(parentPath, route.path);

    if (route.children === undefined || route.children.length === 0) {
      paths.push(ownPath);
    } else {
      paths.push(...registeredPaths(route.children, ownPath));
    }
  }

  return paths;
}

// --- Rendering --------------------------------------------------------------

/** The level-one headings currently rendered, in document order. */
function levelOneHeadings(): string[] {
  return screen
    .getAllByRole('heading', { level: 1 })
    .map((heading) => heading.textContent?.trim() ?? '');
}

afterEach(() => {
  // The shell's and the auth table's Theme_Providers apply the resolved Theme to
  // the document element, which outlives an unmount.
  resetThemeAttribute();
});

// --- The property ------------------------------------------------------------

describe('appRouter — Property 37 (every route path registered exactly once)', () => {
  it('covers every Auth_Feature route path and every Destination path', () => {
    // Guard: the generator below draws from REGISTERED_SCREENS, so a path missing
    // from it would be silently unexercised rather than failing.
    const covered = new Set(REGISTERED_SCREENS.map((entry) => entry.path));

    expect(covered.size).toBe(REGISTERED_SCREENS.length);
    for (const path of AUTH_ROUTE_PATHS) {
      expect(covered).toContain(path);
    }
    for (const destination of SHELL_DESTINATIONS) {
      expect(covered).toContain(destination.path);
    }
    expect(covered).toContain(LANDING_ROUTE);
  });

  // Feature: app-shell, Property 37: The application router registers every route path exactly once
  // Validates: Requirements 15.6
  it('registers each path once and resolves it to its own screen', async () => {
    const routes = assembleRoutes();
    const declared = registeredPaths(routes);

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...REGISTERED_SCREENS),
        async (registered) => {
          // 1. Exactly once in the assembled table.
          expect(
            declared.filter((path) => path === registered.path),
          ).toHaveLength(1);

          // 2. Resolves to its own screen, and to no other registered screen.
          try {
            await renderAt(routes, registered.path);
            expect(levelOneHeadings()).toEqual([registered.heading]);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});
