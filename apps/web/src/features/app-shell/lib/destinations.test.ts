/**
 * Example-based tests for the App_Shell's Destination registry.
 *
 * Requirement 3.1 fixes the registry's shape: exactly four Destinations, each
 * with a stable identifier unique across the registry, a visible label of 1 to
 * 24 characters inclusive, and a distinct route path. Requirement 3.2 fixes the
 * shape of those paths: the Home_Destination sits at the Auth_Feature's
 * Default_Authenticated_Route, every other Destination is that path plus exactly
 * one further segment, and every path is 1 to 128 characters of lowercase ASCII
 * letters, digits, hyphens, and `/` separators — so no shell path can collide
 * with an Auth_Feature route path or with the marketing landing route path `/`.
 *
 * This file is also the drift guard for the one value `lib/destinations.ts`
 * deliberately copies rather than imports. That module must stay free of React,
 * the DOM, and `@pitchmate/api-client` (Requirement 14.16), and the Auth_Feature
 * barrel transitively carries all three — so `HOME_ROUTE` is declared as a
 * literal there and pinned to `DEFAULT_AUTHENTICATED_ROUTE` here, where
 * importing the Auth_Feature's single public entry point is allowed.
 *
 * Requirements: 3.1, 3.2
 */

import { describe, expect, it } from 'vitest';

import {
  AUTH_ROUTE_PATHS,
  DEFAULT_AUTHENTICATED_ROUTE,
} from '../../auth';
import {
  DESTINATION_LABEL_MAX_LENGTH,
  DESTINATION_LABEL_MIN_LENGTH,
  DESTINATION_PATH_MAX_LENGTH,
  DESTINATION_PATH_MIN_LENGTH,
  HOME_ROUTE,
  NOTIFICATIONS_ROUTE,
  PROFILE_ROUTE,
  SETTINGS_ROUTE,
  SHELL_DESTINATIONS,
  type DestinationId,
} from './destinations';

/** The marketing landing route path the shell must never collide with (3.2). */
const LANDING_ROUTE = '/';

/** The identifiers the registry is required to carry, in registration order. */
const EXPECTED_IDS: readonly DestinationId[] = [
  'home',
  'notifications',
  'settings',
  'profile',
];

/** Only lowercase ASCII letters, digits, hyphens, and `/` separators (3.2). */
const ALLOWED_PATH_CHARACTERS = /^[a-z0-9\-/]+$/;

/** Case- and trailing-separator-insensitive comparison key for a route path. */
function pathKey(path: string): string {
  const lowered = path.toLowerCase();
  return lowered.length > 1 && lowered.endsWith('/')
    ? lowered.slice(0, -1)
    : lowered;
}

describe('SHELL_DESTINATIONS', () => {
  it('registers exactly four Destinations (3.1)', () => {
    expect(SHELL_DESTINATIONS).toHaveLength(4);
  });

  it('carries the four stable identifiers, each exactly once (3.1)', () => {
    const ids = SHELL_DESTINATIONS.map((destination) => destination.id);

    expect(ids).toEqual(EXPECTED_IDS);
    expect(new Set(ids).size).toBe(SHELL_DESTINATIONS.length);
  });

  it('labels every Destination with 1 to 24 characters inclusive (3.1)', () => {
    expect(DESTINATION_LABEL_MIN_LENGTH).toBe(1);
    expect(DESTINATION_LABEL_MAX_LENGTH).toBe(24);

    for (const destination of SHELL_DESTINATIONS) {
      expect(destination.label.length).toBeGreaterThanOrEqual(
        DESTINATION_LABEL_MIN_LENGTH,
      );
      expect(destination.label.length).toBeLessThanOrEqual(
        DESTINATION_LABEL_MAX_LENGTH,
      );
      expect(destination.label.trim()).toBe(destination.label);
    }
  });

  it('gives every Destination a distinct route path (3.1)', () => {
    const paths = SHELL_DESTINATIONS.map((destination) => destination.path);

    expect(new Set(paths).size).toBe(paths.length);
    // Distinct even under the resolver's case- and trailing-separator-insensitive
    // matching, so two Destinations can never resolve to the same path (3.1).
    expect(new Set(paths.map(pathKey)).size).toBe(paths.length);
  });

  it('exposes the same paths through the exported route constants (3.2)', () => {
    expect(SHELL_DESTINATIONS.map((destination) => destination.path)).toEqual([
      HOME_ROUTE,
      NOTIFICATIONS_ROUTE,
      SETTINGS_ROUTE,
      PROFILE_ROUTE,
    ]);
  });

  it('bounds every route path to 1 to 128 characters of the allowed alphabet (3.2)', () => {
    expect(DESTINATION_PATH_MIN_LENGTH).toBe(1);
    expect(DESTINATION_PATH_MAX_LENGTH).toBe(128);

    for (const { path } of SHELL_DESTINATIONS) {
      expect(path.length).toBeGreaterThanOrEqual(DESTINATION_PATH_MIN_LENGTH);
      expect(path.length).toBeLessThanOrEqual(DESTINATION_PATH_MAX_LENGTH);
      expect(path).toMatch(ALLOWED_PATH_CHARACTERS);
    }
  });

  it('places Home at the shell root and every other Destination one segment below it (3.2)', () => {
    for (const { id, path } of SHELL_DESTINATIONS) {
      if (id === 'home') {
        expect(path).toBe(HOME_ROUTE);
        continue;
      }

      expect(path.startsWith(`${HOME_ROUTE}/`)).toBe(true);

      const furtherSegments = path
        .slice(HOME_ROUTE.length + 1)
        .split('/')
        .filter((segment) => segment.length > 0);

      expect(furtherSegments).toHaveLength(1);
      expect(path).toBe(`${HOME_ROUTE}/${furtherSegments[0]}`);
    }
  });
});

describe('the Home_Destination route path', () => {
  it('equals the Auth_Feature Default_Authenticated_Route (3.2)', () => {
    // The drift guard: `lib/destinations.ts` copies this value rather than
    // importing it, so that the module stays React-, DOM-, and api-client-free.
    expect(HOME_ROUTE).toBe(DEFAULT_AUTHENTICATED_ROUTE);
  });
});

describe('Destination route paths against the rest of the application', () => {
  it('collides with no route path registered by the Auth_Feature (3.2)', () => {
    const authKeys = new Set(AUTH_ROUTE_PATHS.map(pathKey));

    expect(authKeys.size).toBe(AUTH_ROUTE_PATHS.length);

    for (const { path } of SHELL_DESTINATIONS) {
      expect(authKeys.has(pathKey(path))).toBe(false);
    }
  });

  it('never equals the marketing landing route path (3.2)', () => {
    for (const { path } of SHELL_DESTINATIONS) {
      expect(path).not.toBe(LANDING_ROUTE);
      expect(pathKey(path)).not.toBe(LANDING_ROUTE);
    }
  });
});
