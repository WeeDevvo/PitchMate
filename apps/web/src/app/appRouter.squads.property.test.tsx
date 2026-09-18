/**
 * Property test for route-path uniqueness across the assembled application table
 * (task 15.3).
 *
 * The Squads_Feature registers nothing itself: it hands over two tables and
 * `src/app/appRouter.tsx` places them on opposite sides of the App_Shell — the
 * Squad_Route nested into the shell's `/app` layout route, the
 * Invite_Landing_Route at the application's top level (Requirement 18.5). Both
 * placements are a chance to register a path something else already owns, and a
 * collision does not fail loudly: `react-router` scores the two identically and
 * breaks the tie by registration order, so the loser simply stops being reachable
 * and the only symptom is a screen that quietly never appears. Requirement 18.10
 * rules that out — no path registered twice, and no path of this feature equal to
 * one of the Auth_Feature's, the App_Shell's, or the marketing landing route's.
 *
 * ### What is generated
 *
 * The requirement quantifies over the *assembled table*, so the axis is the
 * assembly itself — every option `createAppRoutes` accepts that a caller could
 * plausibly vary, none of which may change which paths exist:
 *
 * - the Auth_State the Session_Manager reports, because the Route_Guard sits
 *   inside the `/app` subtree the Squad_Route is nested into;
 * - which of the three injected Destination bodies are supplied. The Home body is
 *   the interesting one: it defaults to the Squads_Home, which is how exactly one
 *   screen resolves at the Default_Authenticated_Route (Requirement 18.6), and
 *   supplying or omitting it must add no route either way;
 * - the notification Poll_Interval, an ordinary pass-through value;
 * - **how many times the table is assembled.** `withNestedRoutes` copies the
 *   shell's table rather than mutating it, so a second assembly must register the
 *   same paths as the first. Were the copy dropped, the squads children would
 *   accumulate on a shared array and the second assembly would register
 *   `/app/squads/:squadId` twice — precisely the failure this requirement names,
 *   and one no single assembly could reveal.
 *
 * ### What is asserted, for each generated assembly
 *
 * | Requirement 18.10 clause | Assertion |
 * | --- | --- |
 * | no path registered more than once | no two entries of the flattened table share a {@link matchShape} |
 * | … including this feature's two | `/app/squads/:squadId` and `/join/:code` each appear exactly once |
 * | no collision with Auth_Feature, App_Shell, or landing paths | neither feature shape is among the shapes those tables register |
 * | (guarding vacuity) | the shapes registered are *exactly* the expected set, so a path that appeared from nowhere fails rather than passing unnoticed |
 *
 * ### Why paths are compared as shapes rather than as strings
 *
 * Two patterns can collide without being equal strings. `react-router` matches
 * case-insensitively, ignores a trailing separator, and cares about a dynamic
 * segment's *position*, not its name — so `/join/:code` and `/Join/:secret/`
 * would compete for the same addresses while comparing as different strings.
 * {@link matchShape} normalises all three away, which makes this property reject
 * a collision a string comparison would wave through. The splat `*` is left alone:
 * a splat and a dynamic segment rank differently and match differently, which is
 * exactly why the application's `*` and the shell's `/app/*` can coexist.
 *
 * ### What this property does not claim
 *
 * That each path reaches its own screen is the app-shell feature's Property 37
 * and this feature's routing integration tests; that an unregistered path under
 * `/app` — the Player_Stats_Route seam among them — falls to the shell's
 * `/app/*` handling is Requirement 9.7's. Nothing here renders: the claim is
 * about the table, so the table is all that is built.
 *
 * Feature: web-squads-screens, Property 48: Every registered route path is registered exactly once
 * Validates: Requirements 18.10
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { RouteObject } from 'react-router-dom';

import { AUTH_ROUTE_PATHS, type AuthState } from '../features/auth';
import {
  HOME_ROUTE,
  SHELL_DESTINATIONS,
  type ShellDestinationContent,
} from '../features/app-shell';
import {
  INVITE_LANDING_ROUTE,
  PLAYER_STATS_ROUTE,
  SQUAD_ROUTE,
} from '../features/squads';
import { APP_CATCH_ALL_ROUTE, LANDING_ROUTE } from './appRoutePaths';
import {
  assembleRoutes,
  registeredPaths,
  sessionManagerReporting,
} from './appRouterTestHarness';

// --- Comparing two route patterns -------------------------------------------

/**
 * The set of addresses a route pattern claims, as a comparable string.
 *
 * Two patterns collide exactly when they claim the same addresses, and
 * `react-router` decides that on three rules this normalisation applies: matching
 * is case-insensitive, a single trailing separator is not significant, and a
 * dynamic segment matches by position rather than by the name it was given. Every
 * `:name` segment therefore collapses to a bare `:`.
 *
 * The splat `*` is deliberately left as it stands. A splat matches the remainder
 * of a path and ranks below a dynamic segment, so it is not interchangeable with
 * one — and the application's own `*` and the shell's `/app/*` are two different
 * claims that must both survive this comparison.
 */
function matchShape(pattern: string): string {
  const lowered = pattern.toLowerCase();
  const trimmed = lowered.length > 1 ? lowered.replace(/\/+$/, '') : lowered;

  return trimmed
    .split('/')
    .map((segment) => (segment.startsWith(':') ? ':' : segment))
    .join('/');
}

// --- Who registers what ------------------------------------------------------

/**
 * The two paths this feature registers, read from the feature's barrel.
 *
 * The Squad_Route is handed over as the *relative* child `squads/:squadId` and
 * resolves to this absolute pattern once nested into the shell's `/app` layout
 * route, which is the form the flattened table reports.
 *
 * The Player_Stats_Route is absent because the feature registers no screen for it
 * (Requirement 9.6). It is imported all the same, to pin in the guard below that
 * this feature's two registered patterns are distinguishable from the seam that
 * extends one of them.
 */
const FEATURE_PATHS: readonly string[] = [SQUAD_ROUTE, INVITE_LANDING_ROUTE];

/**
 * Every path the other three contributors register: the marketing landing route,
 * the Auth_Feature's table, and the App_Shell's — its four Destinations plus its
 * own not-found child, which sits under `/app` and so claims `/app/*`.
 *
 * Read from each contributor's own exports rather than restated, and the shell's
 * not-found is *derived* from the two constants that produce it, so a path moving
 * moves this property's expectations with it instead of leaving the new path
 * compared against nothing.
 */
const OTHER_TABLE_PATHS: readonly string[] = [
  LANDING_ROUTE,
  ...AUTH_ROUTE_PATHS,
  ...SHELL_DESTINATIONS.map((destination) => destination.path),
  `${HOME_ROUTE}/${APP_CATCH_ALL_ROUTE}`,
  APP_CATCH_ALL_ROUTE,
];

/** Every shape the assembled table is expected to register, and nothing else. */
const EXPECTED_SHAPES: ReadonlySet<string> = new Set(
  [...FEATURE_PATHS, ...OTHER_TABLE_PATHS].map(matchShape),
);

// --- The generated assemblies ------------------------------------------------

/** A Destination whose body the application injects from outside the shell. */
type InjectedSlot = keyof ShellDestinationContent;

const INJECTED_SLOTS: readonly InjectedSlot[] = ['home', 'profile', 'settings'];

/** One way of assembling the application's route table. */
interface Assembly {
  /** The Auth_State the injected Session_Manager reports. */
  readonly authState: AuthState;
  /** Which injected Destination bodies are supplied; the rest are omitted. */
  readonly injected: readonly InjectedSlot[];
  /** The configured notification Poll_Interval in seconds, or none. */
  readonly pollIntervalSeconds: number | undefined;
  /** How many times the table is assembled from these same options. */
  readonly assemblies: number;
}

const assemblyArb: fc.Arbitrary<Assembly> = fc.record({
  authState: fc.constantFrom<AuthState>('authenticated', 'unauthenticated'),
  injected: fc.uniqueArray(fc.constantFrom(...INJECTED_SLOTS), {
    maxLength: INJECTED_SLOTS.length,
  }),
  pollIntervalSeconds: fc.option(fc.integer({ min: 1, max: 3_600 }), {
    nil: undefined,
  }),
  assemblies: fc.integer({ min: 1, max: 3 }),
});

/** The Destination_Content for the supplied slots, with the rest left out. */
function destinationContentFor(
  injected: readonly InjectedSlot[],
): ShellDestinationContent {
  const content: Record<string, unknown> = {};
  for (const slot of injected) {
    content[slot] = <p>{slot}</p>;
  }
  return content as ShellDestinationContent;
}

/** Assemble the real application table for one generated {@link Assembly}. */
function assemble(assembly: Assembly): RouteObject[] {
  return assembleRoutes({
    sessionManager: sessionManagerReporting(assembly.authState),
    destinationContent: destinationContentFor(assembly.injected),
    pollIntervalSeconds: assembly.pollIntervalSeconds,
  });
}

// --- Assertions --------------------------------------------------------------

/** The shape of every path the table registers, in registration order. */
function registeredShapes(routes: readonly RouteObject[]): string[] {
  return registeredPaths(routes).map(matchShape);
}

/** The shapes appearing more than once, which Requirement 18.10 forbids. */
function duplicatedShapes(shapes: readonly string[]): string[] {
  const seen = new Map<string, number>();
  for (const shape of shapes) {
    seen.set(shape, (seen.get(shape) ?? 0) + 1);
  }

  return [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([shape]) => shape)
    .sort();
}

/** How many times `path`'s shape is registered by the flattened table. */
function registrationsOf(shapes: readonly string[], path: string): number {
  const shape = matchShape(path);
  return shapes.filter((registered) => registered === shape).length;
}

// --- The property ------------------------------------------------------------

describe('appRouter — Property 48 (every route path registered exactly once)', () => {
  it('distinguishes the patterns whose collisions this property is about', () => {
    // The normalisation erases exactly what `react-router` ignores: a dynamic
    // segment's name, the casing, and a trailing separator.
    expect(matchShape('/join/:code')).toBe(matchShape('/Join/:secret/'));
    expect(matchShape(SQUAD_ROUTE)).toBe(matchShape('/APP/squads/:id'));

    // And nothing more. A splat is not a dynamic segment, the two catch-alls are
    // different claims, and the Player_Stats_Route seam extends the Squad_Route
    // rather than competing with it.
    expect(matchShape(APP_CATCH_ALL_ROUTE)).not.toBe(
      matchShape(`${HOME_ROUTE}/${APP_CATCH_ALL_ROUTE}`),
    );
    expect(matchShape(SQUAD_ROUTE)).not.toBe(matchShape(PLAYER_STATS_ROUTE));
    expect(matchShape(SQUAD_ROUTE)).not.toBe(matchShape(INVITE_LANDING_ROUTE));
    expect(matchShape('/app/:section')).not.toBe(matchShape(SQUAD_ROUTE));

    // The two declared lists are disjoint and each free of internal repeats, so
    // "no collision" below is a claim with content rather than a comparison of a
    // list against itself.
    const featureShapes = FEATURE_PATHS.map(matchShape);
    const otherShapes = OTHER_TABLE_PATHS.map(matchShape);

    expect(new Set(featureShapes).size).toBe(FEATURE_PATHS.length);
    expect(new Set(otherShapes).size).toBe(OTHER_TABLE_PATHS.length);
    expect(featureShapes.filter((shape) => otherShapes.includes(shape))).toEqual(
      [],
    );

    // Guard: the expectation set is exactly what the default assembly registers,
    // in both directions — a contributor gaining a path fails here rather than
    // going unexamined, and a path this property expects but no table registers
    // fails here rather than being asserted about vacuously.
    expect(new Set(registeredShapes(assembleRoutes()))).toEqual(EXPECTED_SHAPES);
  });

  // Feature: web-squads-screens, Property 48: Every registered route path is registered exactly once
  // Validates: Requirements 18.10
  it('registers every path once, this feature colliding with no other table', () => {
    fc.assert(
      fc.property(assemblyArb, (assembly) => {
        const shapes = registeredShapes(assemble(assembly));

        // 18.10: no route path registered more than once, anywhere in the table.
        expect(duplicatedShapes(shapes)).toEqual([]);

        // 18.10: and the registered paths are exactly the expected ones, so the
        // absence of duplicates is not the absence of routes.
        expect(new Set(shapes)).toEqual(EXPECTED_SHAPES);

        // 18.10: this feature's two paths are registered, each exactly once …
        for (const path of FEATURE_PATHS) {
          expect(registrationsOf(shapes, path)).toBe(1);
        }

        // … and neither claims the addresses of a path the Auth_Feature, the
        // App_Shell, or the marketing landing route registers.
        const otherShapes = new Set(OTHER_TABLE_PATHS.map(matchShape));
        for (const path of FEATURE_PATHS) {
          expect(otherShapes.has(matchShape(path))).toBe(false);
        }

        // Nesting this feature's Squad_Route into the shell's `/app` layout route
        // displaced none of those paths either: each is still registered once.
        for (const path of OTHER_TABLE_PATHS) {
          expect(registrationsOf(shapes, path)).toBe(1);
        }
      }),
      { numRuns: 100 },
    );
  }, 60_000);

  // Feature: web-squads-screens, Property 48: Every registered route path is registered exactly once
  // Validates: Requirements 18.10
  it('registers the identical paths however many times the table is assembled', () => {
    fc.assert(
      fc.property(assemblyArb, (assembly) => {
        const first = registeredPaths(assemble(assembly));

        for (let attempt = 1; attempt < assembly.assemblies; attempt += 1) {
          // Order included: a repeated assembly must reproduce the table, not
          // merely the set of paths in it. An accumulating mutation would show up
          // as a repeated `/app/squads/:squadId`, which `duplicatedShapes` then
          // catches as well.
          const again = registeredPaths(assemble(assembly));

          expect(again).toEqual(first);
          expect(duplicatedShapes(again.map(matchShape))).toEqual([]);
        }
      }),
      { numRuns: 100 },
    );
  }, 60_000);
});
