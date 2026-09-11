import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  DESTINATION_LABEL_MAX_LENGTH,
  DESTINATION_LABEL_MIN_LENGTH,
  DESTINATION_PATH_MAX_LENGTH,
  DESTINATION_PATH_MIN_LENGTH,
  HOME_ROUTE,
  SHELL_DESTINATIONS,
  destinationLabel,
  type DestinationId,
} from './destinations';

/**
 * Property tests for the App_Shell's Destination registry, placed beside the
 * module they cover as Requirement 14.2 asks and run above the 100-iteration
 * floor.
 *
 * `lib/destinations.ts` is the registry every other pure module and every
 * navigation surface reads: the route resolver matches against its paths
 * (Requirements 3.11–3.13), the Primary_Navigation renders its labels, and the
 * Unavailable_State and the `/app` not-found indication head themselves with
 * `destinationLabel` (Requirement 3.8). The registry's shape is therefore an
 * invariant of the whole feature rather than of one screen, which is what these
 * properties state:
 *
 *  - *`destinationLabel` is a total function of the registry* — for every
 *    registered identifier it yields exactly the label the registry holds, and
 *    for every value that is not a registered identifier it raises rather than
 *    inventing a label (Requirements 3.1, 3.8);
 *  - *the registry's shape holds for every entry and every pair* — each label is
 *    1 to 24 characters and each path 1 to 128 of the allowed alphabet, and no
 *    two entries share an identifier or a path even under the resolver's case-
 *    and trailing-separator-insensitive matching (Requirements 3.1, 3.2);
 *  - *path shape* — Home sits at `/app` and every other Destination is `/app`
 *    plus exactly one further segment, so no shell path can reach outside `/app`
 *    (Requirement 3.2).
 *
 * `destinations.test.ts` beside this file states the same rules as examples over
 * the four entries as they stand today, and holds the drift guard pinning
 * `HOME_ROUTE` to the Auth_Feature's `DEFAULT_AUTHENTICATED_ROUTE` — a check
 * that must import the Auth_Feature and so cannot live in the module itself.
 * These properties are what keep the rules true of an entry added later.
 *
 * Validates: Requirements 3.1, 3.2, 3.8, 14.2
 */

/** Only lowercase ASCII letters, digits, hyphens, and `/` separators (3.2). */
const ALLOWED_PATH_CHARACTERS = /^[a-z0-9\-/]+$/;

/** The registered identifiers, drawn from the registry rather than restated. */
const registeredIdArb: fc.Arbitrary<DestinationId> = fc.constantFrom(
  ...SHELL_DESTINATIONS.map((destination) => destination.id),
);

/** Any registered entry. */
const registeredArb = fc.constantFrom(...SHELL_DESTINATIONS);

/** The identifiers the registry holds, for rejecting everything else. */
const registeredIds = new Set<string>(
  SHELL_DESTINATIONS.map((destination) => destination.id),
);

/**
 * Values that are *not* registered identifiers: near-misses in the wrong letter
 * case, plurals and singulars of the real names, empty and whitespace strings,
 * and values of other types entirely. The near-misses matter most — a lookup
 * that normalised case would wrongly answer them.
 */
const unregisteredArb: fc.Arbitrary<unknown> = fc
  .oneof(
    {
      weight: 3,
      arbitrary: fc.constantFrom<unknown>(
        '',
        ' ',
        'Home',
        'HOME',
        'home ',
        ' home',
        'homes',
        'Notifications',
        'notification',
        'Settings',
        'setting',
        'Profile',
        'profiles',
        'squads',
        'app',
        '/app',
        undefined,
        null,
        0,
        1,
        true,
        false,
        [],
        ['home'],
        {},
        { id: 'home' },
      ),
    },
    { weight: 2, arbitrary: fc.string() },
    { weight: 1, arbitrary: fc.anything() },
  )
  .filter((candidate) => typeof candidate !== 'string' || !registeredIds.has(candidate));

/** Case- and trailing-separator-insensitive comparison key for a route path. */
function pathKey(path: string): string {
  const lowered = path.toLowerCase();
  return lowered.length > 1 && lowered.endsWith('/') ? lowered.slice(0, -1) : lowered;
}

describe('destinationLabel is a total function of the Destination registry', () => {
  it('yields exactly the label the registry holds, for every registered identifier', () => {
    fc.assert(
      fc.property(registeredArb, (destination) => {
        // Read back from the registry entry, not from a restated table: the
        // surfaces that head themselves with a Destination's name take the
        // label from here, so the two can never disagree (Requirement 3.8).
        expect(destinationLabel(destination.id)).toBe(destination.label);
      }),
      { numRuns: 200 },
    );
  });

  it('yields a label of 1 to 24 characters, trimmed, for every registered identifier', () => {
    fc.assert(
      fc.property(registeredIdArb, (id) => {
        const label = destinationLabel(id);

        expect(label.length).toBeGreaterThanOrEqual(DESTINATION_LABEL_MIN_LENGTH);
        expect(label.length).toBeLessThanOrEqual(DESTINATION_LABEL_MAX_LENGTH);
        expect(label.trim()).toBe(label);
      }),
      { numRuns: 200 },
    );
  });

  it('is deterministic: the same identifier always yields the same label', () => {
    fc.assert(
      fc.property(registeredIdArb, (id) => {
        expect(destinationLabel(id)).toBe(destinationLabel(id));
      }),
      { numRuns: 200 },
    );
  });

  it('raises rather than inventing a label for a value that is not a registered identifier', () => {
    fc.assert(
      fc.property(unregisteredArb, (candidate) => {
        // The parameter is typed to the four identifiers, so reaching this
        // throw means the registry lost an entry — a defect, not a state with a
        // safe fallback. What matters is that no *label* is ever returned for an
        // unregistered value, which a silent `undefined` would have allowed to
        // reach a heading.
        expect(() => destinationLabel(candidate as DestinationId)).toThrow(Error);
      }),
      { numRuns: 500 },
    );
  });
});

describe('the Destination registry holds its shape for every entry and every pair', () => {
  it('gives every entry a label within bounds and a path within the allowed alphabet', () => {
    fc.assert(
      fc.property(registeredArb, ({ label, path }) => {
        expect(label.length).toBeGreaterThanOrEqual(DESTINATION_LABEL_MIN_LENGTH);
        expect(label.length).toBeLessThanOrEqual(DESTINATION_LABEL_MAX_LENGTH);

        expect(path.length).toBeGreaterThanOrEqual(DESTINATION_PATH_MIN_LENGTH);
        expect(path.length).toBeLessThanOrEqual(DESTINATION_PATH_MAX_LENGTH);
        expect(path).toMatch(ALLOWED_PATH_CHARACTERS);
      }),
      { numRuns: 200 },
    );
  });

  it('never gives two distinct entries the same identifier or the same path', () => {
    fc.assert(
      fc.property(registeredArb, registeredArb, (first, second) => {
        if (first.id === second.id) {
          // Same identifier means the same entry: the registry holds each once.
          expect(second).toBe(first);
          return;
        }

        expect(second.path).not.toBe(first.path);
        // Distinct even under the resolver's case- and trailing-separator-
        // insensitive matching, so two Destinations can never resolve to the
        // same requested path (Requirements 3.1, 3.12, 3.13).
        expect(pathKey(second.path)).not.toBe(pathKey(first.path));
      }),
      { numRuns: 500 },
    );
  });

  it('places Home at /app and every other Destination exactly one segment below it', () => {
    fc.assert(
      fc.property(registeredArb, ({ id, path }) => {
        if (id === 'home') {
          expect(path).toBe(HOME_ROUTE);
          return;
        }

        expect(path.startsWith(`${HOME_ROUTE}/`)).toBe(true);

        const furtherSegments = path
          .slice(HOME_ROUTE.length + 1)
          .split('/')
          .filter((segment) => segment.length > 0);

        expect(furtherSegments).toHaveLength(1);
        expect(path).toBe(`${HOME_ROUTE}/${furtherSegments[0]}`);
      }),
      { numRuns: 200 },
    );
  });
});
