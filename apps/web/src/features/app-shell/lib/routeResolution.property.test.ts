import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  HOME_ROUTE,
  SHELL_DESTINATIONS,
  type DestinationDefinition,
} from './destinations';
import { resolveDestination, type RouteResolution } from './routeResolution';

/**
 * Property tests for the pure requested-path-to-Destination resolver, placed
 * beside the module they cover as Requirement 14.2 asks, and run well above the
 * 100-iteration floor.
 *
 * These carry **Property 1: Route resolution is total, single-valued, and
 * normalising**:
 *
 *  - *totality* — any value at all yields exactly one of the two stated outcome
 *    shapes and raises nothing (Requirements 3.12, 14.12);
 *  - *normalisation* — a single trailing `/`, a different ASCII letter case, or
 *    both together resolve identically (Requirement 3.13);
 *  - *single-valuedness with longest-match preference* — when a resolved
 *    Destination is returned, its route path is a whole-segment prefix of the
 *    requested path and no registered Destination matching more whole leading
 *    segments also matches (Requirements 3.11, 14.14).
 *
 * The concrete named cases (`/app/settings`, `/app/settings/`, `/app/Settings`)
 * live in `routeResolution.test.ts`; this file states the universal claims.
 *
 * One asymmetry is deliberate and worth stating plainly: the assertions below
 * only ever run *from* a resolved Destination *to* the longest-prefix claim,
 * never the other way round. The Home_Destination matches its own path exactly
 * rather than by prefix, because Requirement 3.10 requires an unregistered path
 * beneath `/app` to be a not-found outcome with no Primary_Navigation control
 * marked current — which a prefix-matching Home would make impossible.
 * Requirement 3.11's stated purpose (Home is not active while a nested
 * Destination path is requested) holds either way.
 *
 * Validates: Requirements 3.11, 3.12, 3.13, 14.12, 14.14
 */

const NESTED_DESTINATIONS: readonly DestinationDefinition[] =
  SHELL_DESTINATIONS.filter((destination) => destination.path !== HOME_ROUTE);

/** Characters a further path segment may plausibly be built from. */
const SEGMENT_CHARACTERS = [
  'a',
  'b',
  'q',
  'z',
  '0',
  '7',
  '-',
  '~',
  '.',
  '%',
  'É',
  'ß',
];

/**
 * An independent reading of Requirement 3.13's normalisation, written from the
 * criterion rather than lifted from the module: discard the query string and the
 * fragment, fold `A`–`Z`, then drop at most one trailing separator.
 */
function normalisedSegments(requestedPath: string): readonly string[] {
  const queryAt = requestedPath.search(/[?#]/u);
  const pathOnly = queryAt === -1 ? requestedPath : requestedPath.slice(0, queryAt);
  const folded = pathOnly.replace(/[A-Z]/gu, (letter) => letter.toLowerCase());
  const trimmed =
    folded.length > 1 && folded.endsWith('/') ? folded.slice(0, -1) : folded;

  return trimmed.split('/').slice(1);
}

/** True iff `candidate`'s segments are a whole-segment prefix of `segments`. */
function isWholeSegmentPrefix(
  candidate: readonly string[],
  segments: readonly string[],
): boolean {
  return (
    candidate.length <= segments.length &&
    candidate.every((segment, index) => segment === segments[index])
  );
}

/** The registered Destinations whose route path matches by whole segments. */
function wholeSegmentMatches(
  requestedPath: string,
): readonly DestinationDefinition[] {
  const segments = normalisedSegments(requestedPath);

  return SHELL_DESTINATIONS.filter((destination) =>
    isWholeSegmentPrefix(normalisedSegments(destination.path), segments),
  );
}

/** Assert the outcome is exactly one of the two stated shapes and nothing else. */
function expectExactlyOneOutcome(outcome: RouteResolution): void {
  expect(Object.keys(outcome).sort()).toEqual(
    outcome.kind === 'destination' ? ['id', 'kind'] : ['kind'],
  );

  if (outcome.kind === 'destination') {
    expect(SHELL_DESTINATIONS.map((destination) => destination.id)).toContain(
      outcome.id,
    );
  } else {
    expect(outcome.kind).toBe('not-found');
  }
}

/** Any registered Destination. */
const destinationArb: fc.Arbitrary<DestinationDefinition> = fc.constantFrom(
  ...SHELL_DESTINATIONS,
);

/** Any registered Destination other than Home. */
const nestedDestinationArb: fc.Arbitrary<DestinationDefinition> = fc.constantFrom(
  ...NESTED_DESTINATIONS,
);

/** The same text with each ASCII letter independently upper- or lower-cased. */
function randomAsciiCase(value: string): fc.Arbitrary<string> {
  return fc
    .array(fc.boolean(), { minLength: value.length, maxLength: value.length })
    .map((upper) =>
      Array.from(value, (character, index) =>
        upper[index] ? character.toUpperCase() : character.toLowerCase(),
      ).join(''),
    );
}

/** A further whole path segment, occasionally an empty one. */
const segmentArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...SEGMENT_CHARACTERS), { minLength: 0, maxLength: 8 })
  .map((characters) => characters.join(''));

/** Query strings and fragments, including ones that look like other paths. */
const suffixArb: fc.Arbitrary<string> = fc.constantFrom(
  '',
  '?',
  '#',
  '?squadId=abc',
  '?redirect=/app/settings',
  '#top',
  '#/app/profile',
  '?a=1&b=2#/app',
);

/** Zero or one trailing separator — the only difference Requirement 3.13 folds. */
const foldedTrailingSlashArb: fc.Arbitrary<string> = fc.constantFrom('', '/');

/**
 * A registered Destination route path in a random ASCII case, with zero or one
 * trailing separator and an optional query string or fragment.
 */
const normalisationVariantArb: fc.Arbitrary<{
  readonly destination: DestinationDefinition;
  readonly requestedPath: string;
}> = destinationArb.chain((destination) =>
  fc
    .tuple(randomAsciiCase(destination.path), foldedTrailingSlashArb, suffixArb)
    .map(([cased, trailing, suffix]) => ({
      destination,
      requestedPath: `${cased}${trailing}${suffix}`,
    })),
);

/** A path nested beneath a non-Home Destination by one or more whole segments. */
const nestedPathArb: fc.Arbitrary<{
  readonly destination: DestinationDefinition;
  readonly requestedPath: string;
}> = nestedDestinationArb.chain((destination) =>
  fc
    .tuple(
      randomAsciiCase(destination.path),
      fc.array(segmentArb, { minLength: 1, maxLength: 3 }),
      foldedTrailingSlashArb,
      suffixArb,
    )
    .map(([cased, segments, trailing, suffix]) => ({
      destination,
      requestedPath: `${cased}/${segments.join('/')}${trailing}${suffix}`,
    })),
);

/**
 * Near misses: a registered route path extended within its final segment, or
 * truncated inside its final segment — never a whole-segment relationship.
 */
const nearMissArb: fc.Arbitrary<string> = fc.oneof(
  // `/app/settingsx`, `/appliance` — a longer final segment.
  destinationArb.chain((destination) =>
    fc
      .array(fc.constantFrom(...SEGMENT_CHARACTERS), { minLength: 1, maxLength: 6 })
      .map((characters) => `${destination.path}${characters.join('')}`),
  ),
  // `/app/setting`, `/app/s` — a shorter final segment, still beneath `/app/`.
  nestedDestinationArb.chain((destination) =>
    fc
      .integer({ min: HOME_ROUTE.length + 2, max: destination.path.length - 1 })
      .map((length) => destination.path.slice(0, length)),
  ),
);

/** An object nested to 100 levels — the depth Requirement 14.12 names. */
function deeplyNested(): unknown {
  let value: unknown = '/app/settings';

  for (let depth = 0; depth < 100; depth += 1) {
    value = { nested: value };
  }

  return value;
}

/** Everything the resolver could be handed at run time, of any type. */
const anyRequestedPathArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 4, arbitrary: normalisationVariantArb.map((it) => it.requestedPath) },
  { weight: 4, arbitrary: nestedPathArb.map((it) => it.requestedPath) },
  { weight: 3, arbitrary: nearMissArb },
  { weight: 3, arbitrary: fc.string({ minLength: 0, maxLength: 60 }) },
  {
    weight: 2,
    arbitrary: fc.string({ unit: 'grapheme', minLength: 0, maxLength: 60 }),
  },
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      '/',
      '//',
      '/app//',
      '/app//settings',
      '/APP/',
      '/app/settings//',
      'app/settings',
      '\uD800',
      '/app/\uDC00',
    ),
  },
  { weight: 4, arbitrary: fc.anything() },
  { weight: 1, arbitrary: fc.constant(deeplyNested()) },
);

// Feature: app-shell, Property 1: route resolution is total and single-valued
// Validates: Requirements 3.12, 14.12
describe('resolveDestination — totality and single-valuedness', () => {
  it('yields exactly one stated outcome and raises nothing for any input of any type', () => {
    fc.assert(
      fc.property(anyRequestedPathArb, (requestedPath) => {
        expectExactlyOneOutcome(resolveDestination(requestedPath));
      }),
      { numRuns: 1000 },
    );
  });

  it('is deterministic: the same input always yields the same outcome', () => {
    fc.assert(
      fc.property(anyRequestedPathArb, (requestedPath) => {
        expect(resolveDestination(requestedPath)).toEqual(
          resolveDestination(requestedPath),
        );
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: app-shell, Property 1: resolution is normalising
// Validates: Requirements 3.13, 3.11
describe('resolveDestination — normalisation', () => {
  it('resolves a registered route path identically under any ASCII case and a single trailing separator', () => {
    fc.assert(
      fc.property(normalisationVariantArb, ({ destination, requestedPath }) => {
        expect(resolveDestination(requestedPath)).toEqual({
          kind: 'destination',
          id: destination.id,
        });
      }),
      { numRuns: 500 },
    );
  });

  it('leaves resolution unchanged by any query string or fragment', () => {
    const pathArb = fc.oneof(
      normalisationVariantArb.map((it) => it.requestedPath),
      nestedPathArb.map((it) => it.requestedPath),
      nearMissArb,
    );

    fc.assert(
      fc.property(pathArb, suffixArb, (requestedPath, suffix) => {
        const withoutSuffix = requestedPath.replace(/[?#].*$/su, '');

        expect(resolveDestination(`${withoutSuffix}${suffix}`)).toEqual(
          resolveDestination(withoutSuffix),
        );
      }),
      { numRuns: 500 },
    );
  });
});

// Feature: app-shell, Property 1: the longest whole-segment match wins
// Validates: Requirements 3.11, 14.14
describe('resolveDestination — longest whole-segment match', () => {
  it('returns a Destination only when its route path is a whole-segment prefix matching the most segments', () => {
    fc.assert(
      fc.property(anyRequestedPathArb, (requestedPath) => {
        const outcome = resolveDestination(requestedPath);

        if (outcome.kind !== 'destination' || typeof requestedPath !== 'string') {
          return;
        }

        const matches = wholeSegmentMatches(requestedPath);
        const resolvedPath = SHELL_DESTINATIONS.find(
          (destination) => destination.id === outcome.id,
        )?.path;

        expect(resolvedPath).toBeDefined();
        expect(matches.map((destination) => destination.id)).toContain(outcome.id);

        const resolvedSegmentCount = normalisedSegments(resolvedPath ?? '').length;
        const longestMatchSegmentCount = Math.max(
          ...matches.map((destination) => normalisedSegments(destination.path).length),
        );

        expect(resolvedSegmentCount).toBe(longestMatchSegmentCount);
      }),
      { numRuns: 1000 },
    );
  });

  it('resolves a path nested beneath a Destination to that Destination, never to Home', () => {
    fc.assert(
      fc.property(nestedPathArb, ({ destination, requestedPath }) => {
        expect(resolveDestination(requestedPath)).toEqual({
          kind: 'destination',
          id: destination.id,
        });
      }),
      { numRuns: 500 },
    );
  });

  it('yields not-found for a path under Home that matches no further Destination (3.10)', () => {
    const unregisteredSegmentArb = fc
      .array(fc.constantFrom(...SEGMENT_CHARACTERS), { minLength: 1, maxLength: 8 })
      .map((characters) => characters.join(''))
      .filter(
        (segment) =>
          !NESTED_DESTINATIONS.some(
            (destination) =>
              destination.path.toLowerCase() ===
              `${HOME_ROUTE}/${segment}`.toLowerCase(),
          ),
      );

    fc.assert(
      fc.property(
        randomAsciiCase(HOME_ROUTE),
        unregisteredSegmentArb,
        foldedTrailingSlashArb,
        suffixArb,
        (home, segment, trailing, suffix) => {
          expect(
            resolveDestination(`${home}/${segment}${trailing}${suffix}`),
          ).toEqual({ kind: 'not-found' });
        },
      ),
      { numRuns: 500 },
    );
  });

  it('yields not-found for a near miss inside a route path segment', () => {
    fc.assert(
      fc.property(nearMissArb, (requestedPath) => {
        expect(resolveDestination(requestedPath)).toEqual({ kind: 'not-found' });
      }),
      { numRuns: 500 },
    );
  });
});
