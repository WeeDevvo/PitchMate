import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  INVITE_LANDING_ROUTE,
  PLAYER_STATS_ROUTE,
  SQUAD_ROUTE,
  inviteLandingPath,
  playerStatsPath,
  squadPath,
} from './routePaths';

/**
 * Property tests for the Squads_Feature's route path patterns and their
 * construction functions, placed beside the module they cover as the design's
 * Testing Strategy asks, and running well above the 100-iteration floor (20.1).
 *
 * These carry the pure half of **Property 24: The Player_Stats_Route seam is
 * constructed once and recoverable** — the half that holds of the functions
 * themselves rather than of a rendered Player_Row. The whole property, including
 * the row's single keyboard-operable control and its accessible name, is carried
 * by `components/PlayerRow.seam.property.test.tsx`; what is stated here is the
 * claim a later feature depends on (9.2, 9.3): *a path built by the exported
 * function matches the exported pattern, and every identity put into it comes
 * back out of it unchanged.*
 *
 * The oracle is `matchRoutePattern` below — a small pattern matcher written from
 * the route patterns' own shape, not a second copy of the construction. It is
 * what makes the round trip a real claim: a construction that dropped a segment,
 * left a value unencoded, or ran the two identities together would still satisfy
 * a test that only compared strings, but it could not survive being matched back
 * against the pattern and having both identities recovered.
 *
 * Encoding is where this module earns its keep. Identities are opaque to the
 * feature, so a value carrying `/`, `?`, `#`, or `%` must not be able to change
 * the *shape* of the path it sits in. Generators therefore reach past the
 * well-formed identity into reserved characters, percent-escapes, non-ASCII text,
 * and lengths up to 512 — the invite-secret edges the design's Testing Strategy
 * names, since the invite path is built here too.
 *
 * Generators produce well-formed strings only. A lone surrogate is not a
 * well-formed string, `encodeURIComponent` rejects it, and neither a decoded path
 * segment nor a typed input can carry one, so it is outside the functions'
 * stated domain rather than an untested case.
 */

// --- the oracle: recovering a path's segments through its pattern -------------

/**
 * Matches a path against a route pattern, recovering each dynamic segment's
 * decoded value.
 *
 * Written from the patterns' shape — `/` separators, `:name` for a dynamic
 * segment, everything else literal — and deliberately strict in the two ways a
 * router is: the segment counts must agree, and a dynamic segment must carry a
 * non-empty value. An undecodable segment is a non-match rather than a throw, so
 * the oracle is total over every input.
 *
 * @returns the decoded dynamic segments by name, or `null` when the path does
 *   not match the pattern
 */
function matchRoutePattern(
  pattern: string,
  path: string,
): Readonly<Record<string, string>> | null {
  const patternSegments = pattern.split('/');
  const pathSegments = path.split('/');

  if (patternSegments.length !== pathSegments.length) {
    return null;
  }

  const parameters: Record<string, string> = {};

  for (let index = 0; index < patternSegments.length; index += 1) {
    const expected = patternSegments[index];
    const actual = pathSegments[index];

    if (!expected.startsWith(':')) {
      if (actual !== expected) {
        return null;
      }
      continue;
    }

    if (actual.length === 0) {
      // A dynamic segment requires a value: no router resolves `/join/`
      // against `/join/:code`.
      return null;
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(actual);
    } catch {
      return null;
    }

    parameters[expected.slice(1)] = decoded;
  }

  return parameters;
}

/** The names of a pattern's dynamic segments, in order. */
function dynamicSegmentNames(pattern: string): readonly string[] {
  return pattern
    .split('/')
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1));
}

// --- generators ---------------------------------------------------------------

const hexDigitArb = fc.constantFrom(...'0123456789abcdef'.split(''));

const hexRun = (length: number): fc.Arbitrary<string> =>
  fc.string({ unit: hexDigitArb, minLength: length, maxLength: length });

/**
 * A well-formed 36-character hyphenated identity in either letter case — the
 * form the squad and membership identities actually take.
 */
const identityArb: fc.Arbitrary<string> = fc
  .tuple(hexRun(8), hexRun(4), hexRun(4), hexRun(4), hexRun(12), fc.boolean())
  .map(([a, b, c, d, e, upper]) => {
    const identity = `${a}-${b}-${c}-${d}-${e}`;
    return upper ? identity.toUpperCase() : identity;
  });

/** The characters reserved in a URL, each of which must be encoded away. */
const RESERVED_CHARACTERS = ['/', '?', '#', '&', '=', '%', '+', ':', '@', ';', ','];

/**
 * Values that are not identities but that a segment may nonetheless have to
 * carry: reserved characters, percent-escapes already in the text, non-ASCII
 * scripts and emoji, path-traversal shapes, and whitespace. These are the
 * Invite_Secret edges — the invite path is built by this module too — and they
 * are the values that would let an unencoded construction change a path's shape.
 */
const awkwardSegmentArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.constantFrom(
      '/',
      '//',
      '?',
      '#',
      '%',
      '%2F',
      '%%',
      '%zz',
      'a/b',
      'a?b=c',
      'a#b',
      '../../etc/passwd',
      './.',
      'join',
      '/join/',
      'code with spaces',
      ' leading',
      'trailing ',
      '\t',
      '\n',
      'ünïcödé',
      '日本語',
      'Ω≈ç√',
      '🙈🙉🙊',
      'e'.repeat(512),
      '%'.repeat(64),
      '?a=1&b=2#c',
    ),
  },
  {
    weight: 3,
    arbitrary: fc.string({
      unit: fc.constantFrom(...RESERVED_CHARACTERS, 'a', '1', '-'),
      minLength: 1,
      maxLength: 64,
    }),
  },
  { weight: 3, arbitrary: fc.string({ minLength: 1, maxLength: 64 }) },
  { weight: 2, arbitrary: fc.string({ unit: 'grapheme', minLength: 1, maxLength: 64 }) },
  {
    weight: 1,
    // The lengths the design's Testing Strategy names for an Invite_Secret.
    arbitrary: fc
      .tuple(
        fc.constantFrom(1, 8, 12, 512),
        fc.string({ unit: 'grapheme-ascii', minLength: 1, maxLength: 1 }),
      )
      .map(([length, unit]) => unit.repeat(length)),
  },
);

/** Any non-empty segment value: an identity or one of the awkward values. */
const segmentArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: identityArb },
  { weight: 4, arbitrary: awkwardSegmentArb },
);

// Feature: web-squads-screens, Property 24 (pure half): a constructed path
// matches its pattern and every identity in it is recoverable
// Validates: Requirements 9.2, 9.3, 20.1
describe('routePaths — a constructed path matches its pattern and round-trips its segments', () => {
  it('recovers the squad identity from squadPath through SQUAD_ROUTE', () => {
    fc.assert(
      fc.property(segmentArb, (squadId) => {
        const parameters = matchRoutePattern(SQUAD_ROUTE, squadPath(squadId));

        expect(parameters).not.toBeNull();
        expect(parameters).toEqual({ squadId });
      }),
      { numRuns: 500 },
    );
  });

  it('recovers both identities from playerStatsPath through PLAYER_STATS_ROUTE', () => {
    fc.assert(
      fc.property(segmentArb, segmentArb, (squadId, membershipId) => {
        const parameters = matchRoutePattern(
          PLAYER_STATS_ROUTE,
          playerStatsPath(squadId, membershipId),
        );

        // Both identities, each unchanged and each in its own segment: this is
        // the claim the later player-stats feature registers against (9.2, 9.3).
        expect(parameters).not.toBeNull();
        expect(parameters).toEqual({ squadId, membershipId });
      }),
      { numRuns: 500 },
    );
  });

  it('keeps the two identities distinct, so swapping them yields a different path', () => {
    fc.assert(
      fc.property(segmentArb, segmentArb, (first, second) => {
        const built = playerStatsPath(first, second);
        const swapped = playerStatsPath(second, first);

        if (first === second) {
          expect(swapped).toBe(built);
          return;
        }

        // A construction that ran the identities together, or that placed either
        // in the other's segment, would fail here.
        expect(swapped).not.toBe(built);
        expect(matchRoutePattern(PLAYER_STATS_ROUTE, swapped)).toEqual({
          squadId: second,
          membershipId: first,
        });
      }),
      { numRuns: 500 },
    );
  });

  it('recovers the invite secret from inviteLandingPath through INVITE_LANDING_ROUTE', () => {
    fc.assert(
      fc.property(segmentArb, (secret) => {
        const parameters = matchRoutePattern(
          INVITE_LANDING_ROUTE,
          inviteLandingPath(secret),
        );

        expect(parameters).not.toBeNull();
        expect(parameters).toEqual({ code: secret });
      }),
      { numRuns: 500 },
    );
  });

  it('is deterministic: the same identities always build the same path', () => {
    fc.assert(
      fc.property(segmentArb, segmentArb, (squadId, membershipId) => {
        expect(squadPath(squadId)).toBe(squadPath(squadId));
        expect(playerStatsPath(squadId, membershipId)).toBe(
          playerStatsPath(squadId, membershipId),
        );
        expect(inviteLandingPath(squadId)).toBe(inviteLandingPath(squadId));
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: web-squads-screens, Property 24 (pure half): encoding fixes a built
// path's shape, whatever the segment values carry
// Validates: Requirements 9.2, 20.1
describe('routePaths — a segment value cannot change the shape of its path', () => {
  it('builds a path with exactly the segment count its pattern declares', () => {
    fc.assert(
      fc.property(segmentArb, segmentArb, (squadId, membershipId) => {
        const cases: readonly (readonly [string, string])[] = [
          [SQUAD_ROUTE, squadPath(squadId)],
          [PLAYER_STATS_ROUTE, playerStatsPath(squadId, membershipId)],
          [INVITE_LANDING_ROUTE, inviteLandingPath(squadId)],
        ];

        for (const [pattern, path] of cases) {
          // A `/` inside a value would add a segment; a `?` or `#` would end the
          // path early once a browser read it. Encoding rules both out.
          expect(path.split('/')).toHaveLength(pattern.split('/').length);
          expect(path.startsWith('/')).toBe(true);
          expect(path).not.toContain('?');
          expect(path).not.toContain('#');
        }
      }),
      { numRuns: 500 },
    );
  });

  it('keeps each pattern\u2019s literal segments literal', () => {
    fc.assert(
      fc.property(segmentArb, segmentArb, (squadId, membershipId) => {
        const cases: readonly (readonly [string, string])[] = [
          [SQUAD_ROUTE, squadPath(squadId)],
          [PLAYER_STATS_ROUTE, playerStatsPath(squadId, membershipId)],
          [INVITE_LANDING_ROUTE, inviteLandingPath(squadId)],
        ];

        for (const [pattern, path] of cases) {
          const patternSegments = pattern.split('/');
          const pathSegments = path.split('/');

          patternSegments.forEach((expected, index) => {
            if (!expected.startsWith(':')) {
              expect(pathSegments[index]).toBe(expected);
            }
          });
        }
      }),
      { numRuns: 300 },
    );
  });

  it('never lets a squads path be read as the other squads pattern', () => {
    fc.assert(
      fc.property(segmentArb, segmentArb, (squadId, membershipId) => {
        // The Squad_Route and the Player_Stats_Route differ by two segments, so
        // no value in either can make one resolve as the other — which is what
        // keeps the App_Shell's not-found handling responsible for the stats
        // path rather than the Squad_Screen (9.6, 9.7).
        expect(matchRoutePattern(PLAYER_STATS_ROUTE, squadPath(squadId))).toBeNull();
        expect(
          matchRoutePattern(SQUAD_ROUTE, playerStatsPath(squadId, membershipId)),
        ).toBeNull();
        expect(matchRoutePattern(INVITE_LANDING_ROUTE, squadPath(squadId))).toBeNull();
        expect(
          matchRoutePattern(SQUAD_ROUTE, inviteLandingPath(squadId)),
        ).toBeNull();
      }),
      { numRuns: 500 },
    );
  });

  it('builds an unresolvable path for an empty value rather than a shorter one', () => {
    fc.assert(
      fc.property(segmentArb, (value) => {
        // These functions construct; they do not validate. An empty identity
        // yields an empty dynamic segment, which no pattern matches — a route
        // that does not resolve rather than one that resolves to the wrong
        // screen. The syntactic guard is `isSquadIdentifier` (6.6).
        expect(squadPath('')).toBe('/app/squads/');
        expect(matchRoutePattern(SQUAD_ROUTE, squadPath(''))).toBeNull();

        expect(
          matchRoutePattern(PLAYER_STATS_ROUTE, playerStatsPath('', value)),
        ).toBeNull();
        expect(
          matchRoutePattern(PLAYER_STATS_ROUTE, playerStatsPath(value, '')),
        ).toBeNull();
        expect(matchRoutePattern(INVITE_LANDING_ROUTE, inviteLandingPath(''))).toBeNull();
      }),
      { numRuns: 200 },
    );
  });
});

describe('routePaths — the exported patterns are the ones the router registers', () => {
  it('states each pattern and each dynamic segment name literally', () => {
    // The patterns are the contract a later feature registers against and the
    // shell reads a Squad_Scope from, so they are asserted literally here: the
    // generated properties read them from the module and so could not catch a
    // renamed segment or a moved prefix on their own (9.3, 18.5).
    expect(SQUAD_ROUTE).toBe('/app/squads/:squadId');
    expect(PLAYER_STATS_ROUTE).toBe('/app/squads/:squadId/players/:membershipId');
    expect(INVITE_LANDING_ROUTE).toBe('/join/:code');

    // `squadId` is the name the App_Shell publishes its Squad_Scope from.
    expect(dynamicSegmentNames(SQUAD_ROUTE)).toEqual(['squadId']);
    expect(dynamicSegmentNames(PLAYER_STATS_ROUTE)).toEqual(['squadId', 'membershipId']);
    expect(dynamicSegmentNames(INVITE_LANDING_ROUTE)).toEqual(['code']);

    // The Player_Stats_Route sits beneath the Squad_Route, and the invite
    // landing route sits outside `/app` entirely (18.5).
    expect(PLAYER_STATS_ROUTE.startsWith(`${SQUAD_ROUTE}/`)).toBe(true);
    expect(INVITE_LANDING_ROUTE.startsWith('/app')).toBe(false);
  });

  it('builds a known identity into the path a reader can check by eye', () => {
    const squadId = '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b';
    const membershipId = '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5c';

    expect(squadPath(squadId)).toBe(`/app/squads/${squadId}`);
    expect(playerStatsPath(squadId, membershipId)).toBe(
      `/app/squads/${squadId}/players/${membershipId}`,
    );
    expect(inviteLandingPath('abc123')).toBe('/join/abc123');

    // A reserved character is encoded away rather than passed through.
    expect(inviteLandingPath('a/b?c#d')).toBe('/join/a%2Fb%3Fc%23d');
  });
});
