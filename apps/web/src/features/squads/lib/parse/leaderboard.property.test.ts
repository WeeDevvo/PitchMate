import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { isSquadIdentifier } from '../identifiers';
import type { ParseResult } from './primitives';
import {
  parseDisplayRatingEntry,
  parseDisplayRatingLeaderboard,
  type DisplayRatingEntry,
  type DisplayRatingLeaderboard,
} from './leaderboard';

/**
 * Property test for the `GetSquadLeaderboard` body shape, placed beside the module it
 * covers as the design's Testing Strategy asks and running well above the
 * 100-iteration floor (20.1).
 *
 * This file carries **Property 35** for `leaderboard.ts`: for any value supplied as a
 * response body — absent, `null`, a primitive of every type, an array, an object with
 * each required field missing, an object with each field mistyped, and a value nested
 * a hundred levels deep — both parsers yield exactly one of a fully populated value
 * and a parse failure, and raise nothing (16.4).
 *
 * Three facts of this shape drive the assertions.
 *
 * **A duplicated membership identity fails the body** (8.11). Two entries for one
 * membership make that person's rating ambiguous, and there is no defensible way to
 * choose: taking the first would render a number decided by array order, and ignoring
 * both would show a Provisional_Band claiming no settled rating when the backend says
 * there are two. Failing routes the ambiguity through the normal path — a
 * `parse-failure` outcome, no leaderboard, and Rating_Unavailable on every row. That
 * is asserted directly, including that identities compare *exactly*: a pair differing
 * only in letter case or in surrounding whitespace is two identities, not one, because
 * the identity is opaque here and Requirement 8.1's matching is exact.
 *
 * **`value` is a finite number and nothing else.** `NaN`, both infinities, and a
 * string-encoded number each fail; exact halves including `-0.5`, `-0`, and very large
 * magnitudes each parse unchanged, because rounding to a displayed integer belongs to
 * `lib/ratingPresentation.ts` and this parser must not pre-empt it.
 *
 * **`statistic` is not read at all.** The caller knows which statistic it asked for,
 * so the echoed code tells the feature nothing and reading it would mean a numeric enum
 * literal outside `lib/enumCodes.ts` (16.12). The generators therefore feed bodies
 * carrying every kind of `statistic` — named, unnamed, mistyped, and a throwing
 * accessor — and every one of them must parse, which is a stronger statement than
 * discarding the field after reading it.
 *
 * Requirements: 8.9, 8.11, 16.4, 16.12, 20.10
 */

/* -------------------------------------------------------------------------- */
/* The totality harness                                                       */
/* -------------------------------------------------------------------------- */

/** A value's own keys, sorted, as a comparable string. */
function keySignature(value: object): string {
  return Object.keys(value).sort().join(',');
}

/**
 * Settles one parse and asserts Property 35's frame: no exception, exactly one of
 * the two result shapes with exactly its own fields, a fully populated value on
 * success, and a non-empty diagnostic reason on failure.
 */
function settle<T>(
  parse: () => ParseResult<T>,
  isFullyPopulated: (value: T) => boolean,
): ParseResult<T> {
  let outcome: ParseResult<T>;

  try {
    outcome = parse();
  } catch (raised) {
    // 16.4: the parser raises nothing, for any input at all.
    throw new Error(`the parser raised instead of failing: ${String(raised)}`, {
      cause: raised,
    });
  }

  expect(typeof outcome).toBe('object');
  expect(outcome).not.toBeNull();
  expect(typeof outcome.ok).toBe('boolean');

  if (outcome.ok) {
    expect(keySignature(outcome)).toBe('ok,value');
    expect(isFullyPopulated(outcome.value)).toBe(true);
  } else {
    expect(keySignature(outcome)).toBe('ok,reason');
    expect(typeof outcome.reason).toBe('string');
    expect(outcome.reason.length).toBeGreaterThan(0);
  }

  return outcome;
}

/* -------------------------------------------------------------------------- */
/* Generators over the whole input space                                      */
/* -------------------------------------------------------------------------- */

/** A well-formed identity, for the generators that need one to spoil. */
const WELL_FORMED_IDENTITY = '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b';

/** Values of every primitive type, together with the two absences. */
const primitiveArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 8,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      true,
      false,
      0,
      -0,
      1,
      3,
      0.5,
      -0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_VALUE,
      '',
      ' ',
      '0',
      '1000',
      'null',
      '{}',
      WELL_FORMED_IDENTITY,
      0n,
      Symbol('wire'),
    ),
  },
  { weight: 2, arbitrary: fc.string({ maxLength: 32 }) },
  { weight: 2, arbitrary: fc.double() },
  { weight: 1, arbitrary: fc.integer({ min: -4, max: 8 }) },
  { weight: 1, arbitrary: fc.boolean() },
);

/** Arrays, plain objects, and the exotic object shapes a body could carry. */
const structuralArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.constantFrom<unknown>(
      [],
      [{}],
      [[]],
      {},
      { entries: [] },
      { statistic: 1 },
      { membershipId: WELL_FORMED_IDENTITY },
      Object.create(null),
      new Date(0),
      new Map<unknown, unknown>([['entries', []]]),
      new Set<unknown>([1]),
      () => ({}),
      Object(1),
      Object('a'),
    ),
  },
  { weight: 3, arbitrary: fc.array(primitiveArb, { maxLength: 4 }) },
  {
    weight: 3,
    arbitrary: fc.dictionary(fc.string({ maxLength: 8 }), primitiveArb, {
      maxKeys: 5,
    }),
  },
  {
    weight: 3,
    arbitrary: fc.anything({
      maxDepth: 3,
      withBigInt: true,
      withDate: true,
      withMap: true,
      withSet: true,
      withNullPrototype: true,
      withObjectString: true,
    }),
  },
);

/** The whole input space Property 35 quantifies over. */
const anyBodyArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 4, arbitrary: primitiveArb },
  { weight: 5, arbitrary: structuralArb },
);

/** Wraps `leaf` in `depth` levels of alternating arrays and objects. */
function nest(leaf: unknown, depth: number): unknown {
  let value: unknown = leaf;

  for (let level = 0; level < depth; level += 1) {
    value = level % 2 === 0 ? [value] : { value };
  }

  return value;
}

/** A value nested to between 1 and 100 levels. */
const deeplyNestedArb: fc.Arbitrary<unknown> = fc
  .tuple(primitiveArb, fc.integer({ min: 1, max: 100 }))
  .map(([leaf, depth]) => nest(leaf, depth));

/* -------------------------------------------------------------------------- */
/* Field-level generators                                                     */
/* -------------------------------------------------------------------------- */

/** Well-formed identities, including the two extremes of the form. */
const identityArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.uuid() },
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      WELL_FORMED_IDENTITY,
      WELL_FORMED_IDENTITY.toUpperCase(),
      '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
    ),
  },
);

/** Display names at the edges the requirements name. */
const displayNameArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      '',
      ' ',
      'a',
      'Dave',
      'BigDave',
      'Former player',
      'x'.repeat(100),
      'x'.repeat(101),
    ),
  },
  { weight: 2, arbitrary: fc.string({ maxLength: 40 }) },
  { weight: 1, arbitrary: fc.string({ unit: 'grapheme', maxLength: 12 }) },
);

/**
 * Rating values the parser must accept: the exact halves the design names, the
 * signed zeroes, and magnitudes at the extremes of a double. Every one is a finite
 * number, and none is rounded here.
 */
const ratingValueArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.constantFrom(
      0,
      -0,
      0.5,
      -0.5,
      1.5,
      -1.5,
      1000,
      -1000,
      1000.5,
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      Number.MIN_VALUE,
      Number.EPSILON,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
    ),
  },
  { weight: 3, arbitrary: fc.double({ noNaN: true, noDefaultInfinity: true }) },
  { weight: 2, arbitrary: fc.integer({ min: -5000, max: 5000 }) },
);

/** Values no identity field accepts, including the near misses of the form. */
const notAnIdentityArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      '',
      ' ',
      0,
      1,
      true,
      WELL_FORMED_IDENTITY.replace(/-/g, ''),
      `{${WELL_FORMED_IDENTITY}}`,
      ` ${WELL_FORMED_IDENTITY}`,
      `${WELL_FORMED_IDENTITY} `,
      WELL_FORMED_IDENTITY.slice(0, 35),
      `${WELL_FORMED_IDENTITY}b`,
      [WELL_FORMED_IDENTITY],
      { membershipId: WELL_FORMED_IDENTITY },
    ),
  },
  { weight: 3, arbitrary: anyBodyArb.filter((value) => !isSquadIdentifier(value)) },
);

/** Values no required string field accepts. */
const notAStringArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      0,
      1,
      true,
      false,
      Number.NaN,
      [],
      ['a'],
      {},
      { displayName: 'a' },
      Object('a'),
      0n,
      Symbol('a'),
    ),
  },
  { weight: 3, arbitrary: anyBodyArb.filter((value) => typeof value !== 'string') },
);

/**
 * Values no rating value accepts. `NaN` and both infinities lead, since none of them
 * is a value JSON can carry and each would reach a rendered rating if it parsed;
 * `'1000'` follows, because a string-encoded number is not this backend's wire form.
 */
const notAFiniteNumberArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      '0',
      '1000',
      '1000.5',
      '',
      true,
      false,
      [],
      [1000],
      {},
      { value: 1000 },
      Object(1000),
      1000n,
      Symbol('1000'),
    ),
  },
  {
    weight: 3,
    arbitrary: anyBodyArb.filter(
      (value) => typeof value !== 'number' || !Number.isFinite(value),
    ),
  },
);

/**
 * Every kind of `statistic` a body could echo — named, unnamed, mistyped, absent.
 * None is read, so none may change the outcome (16.9, 16.12).
 */
const statisticArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      0,
      1,
      2,
      3,
      99,
      -1,
      0.5,
      Number.NaN,
      'display-rating',
      '1',
      true,
      [1],
      { statistic: 1 },
    ),
  },
  { weight: 2, arbitrary: anyBodyArb },
);

/* -------------------------------------------------------------------------- */
/* Well-formed bodies, and what a populated value must look like              */
/* -------------------------------------------------------------------------- */

/** A well-formed `entries` element. */
const wellFormedEntryArb: fc.Arbitrary<Record<string, unknown>> = fc.record({
  membershipId: identityArb,
  displayName: displayNameArb,
  value: ratingValueArb,
});

/**
 * A well-formed leaderboard body, with distinct membership identities. `statistic` is
 * present as often as not, and in every form, because the parser must not read it.
 */
const wellFormedLeaderboardArb: fc.Arbitrary<Record<string, unknown>> = fc
  .record({
    entries: fc
      .uniqueArray(wellFormedEntryArb, {
        maxLength: 24,
        selector: (entry) => entry.membershipId,
      })
      .map((entries) => entries as unknown[]),
    statistic: statisticArb,
    dropStatistic: fc.boolean(),
  })
  .map(({ entries, statistic, dropStatistic }) => {
    const body: Record<string, unknown> = { entries };

    if (!dropStatistic) {
      body.statistic = statistic;
    }

    return body;
  });

/** Every field an entry declares. */
const ENTRY_FIELDS = ['membershipId', 'displayName', 'value'] as const;

/**
 * Whether a parsed entry is fully populated: exactly the three declared fields, each
 * of its declared type, with no field left `undefined`.
 */
function isFullyPopulatedEntry(entry: DisplayRatingEntry): boolean {
  return (
    keySignature(entry) === 'displayName,membershipId,value' &&
    isSquadIdentifier(entry.membershipId) &&
    typeof entry.displayName === 'string' &&
    typeof entry.value === 'number' &&
    Number.isFinite(entry.value)
  );
}

/**
 * Whether a parsed leaderboard is fully populated: exactly its one declared field,
 * every entry populated, and no membership identity repeated (8.11).
 */
function isFullyPopulatedLeaderboard(
  leaderboard: DisplayRatingLeaderboard,
): boolean {
  if (keySignature(leaderboard) !== 'entries') {
    return false;
  }

  if (!Array.isArray(leaderboard.entries)) {
    return false;
  }

  const identities = leaderboard.entries.map((entry) => entry.membershipId);

  return (
    leaderboard.entries.every(isFullyPopulatedEntry) &&
    new Set(identities).size === identities.length
  );
}

/** `body` without `key`. */
function without(
  body: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, unknown> {
  const copy = { ...body };

  delete copy[key];

  return copy;
}

/** `body` with `key` defined as an accessor that throws when it is read. */
function throwingAt(
  body: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, unknown> {
  return Object.defineProperty({ ...body }, key, {
    enumerable: true,
    configurable: true,
    get(): never {
      throw new Error('a throwing accessor');
    },
  });
}

/* -------------------------------------------------------------------------- */
/* One entry                                                                  */
/* -------------------------------------------------------------------------- */

// Feature: web-squads-screens, Property 35: Every response parser is total and never yields a partial value
// Validates: Requirements 8.9, 16.4, 20.10
describe('parseDisplayRatingEntry — total, and never partial', () => {
  it('settles every input into exactly one of a populated value and a failure', () => {
    fc.assert(
      fc.property(anyBodyArb, (body) => {
        settle(() => parseDisplayRatingEntry(body), isFullyPopulatedEntry);
      }),
      { numRuns: 1000 },
    );
  });

  it('settles a value nested to 100 levels', () => {
    fc.assert(
      fc.property(deeplyNestedArb, (body) => {
        const outcome = settle(
          () => parseDisplayRatingEntry(body),
          isFullyPopulatedEntry,
        );

        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('settles a well-formed entry whose every field is 100 levels deep', () => {
    fc.assert(
      fc.property(
        wellFormedEntryArb,
        fc.constantFrom(...ENTRY_FIELDS),
        deeplyNestedArb,
        (body, key, deep) => {
          const outcome = settle(
            () => parseDisplayRatingEntry({ ...body, [key]: deep }),
            isFullyPopulatedEntry,
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('parses every well-formed entry into a fully populated value', () => {
    fc.assert(
      fc.property(wellFormedEntryArb, (body) => {
        const outcome = settle(
          () => parseDisplayRatingEntry(body),
          isFullyPopulatedEntry,
        );

        expect(outcome.ok).toBe(true);

        if (outcome.ok) {
          expect(outcome.value.membershipId).toBe(body.membershipId);
          expect(outcome.value.displayName).toBe(body.displayName);
          // Carried through exactly, signed zero included: the rounding to a
          // displayed integer belongs to `lib/ratingPresentation.ts` (8.9).
          expect(Object.is(outcome.value.value, body.value)).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('fails when a required field is absent', () => {
    fc.assert(
      fc.property(
        wellFormedEntryArb,
        fc.constantFrom(...ENTRY_FIELDS),
        (body, key) => {
          const outcome = settle(
            () => parseDisplayRatingEntry(without(body, key)),
            isFullyPopulatedEntry,
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('fails when a required field is mistyped', () => {
    fc.assert(
      fc.property(
        wellFormedEntryArb,
        fc.oneof(
          fc.tuple(fc.constant('membershipId'), notAnIdentityArb),
          fc.tuple(fc.constant('displayName'), notAStringArb),
          fc.tuple(fc.constant('value'), notAFiniteNumberArb),
        ),
        (body, [key, value]) => {
          const outcome = settle(
            () => parseDisplayRatingEntry({ ...body, [key]: value }),
            isFullyPopulatedEntry,
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('fails on NaN, either infinity, and a string-encoded number', () => {
    fc.assert(
      fc.property(
        wellFormedEntryArb,
        fc.constantFrom<unknown>(
          Number.NaN,
          Number.POSITIVE_INFINITY,
          Number.NEGATIVE_INFINITY,
          '1000',
          '0',
        ),
        (body, value) => {
          const outcome = settle(
            () => parseDisplayRatingEntry({ ...body, value }),
            isFullyPopulatedEntry,
          );

          // None of these is a value JSON can carry, and each would reach a
          // rendered rating if it parsed.
          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('fails rather than raising when a named field throws on read', () => {
    fc.assert(
      fc.property(
        wellFormedEntryArb,
        fc.constantFrom(...ENTRY_FIELDS),
        (body, key) => {
          const outcome = settle(
            () => parseDisplayRatingEntry(throwingAt(body, key)),
            isFullyPopulatedEntry,
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('composes its reason from field labels and never from the display name', () => {
    fc.assert(
      fc.property(
        wellFormedEntryArb,
        fc.constantFrom('Dave', 'Former player', 'a-secret-invite-token'),
        (body, personalData) => {
          const outcome = settle(
            () => parseDisplayRatingEntry({ ...body, displayName: [personalData] }),
            isFullyPopulatedEntry,
          );

          expect(outcome.ok).toBe(false);

          if (!outcome.ok) {
            expect(outcome.reason).not.toContain(personalData);
            expect(outcome.reason).toContain('displayName');
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The whole leaderboard                                                      */
/* -------------------------------------------------------------------------- */

// Feature: web-squads-screens, Property 35: Every response parser is total and never yields a partial value
// Validates: Requirements 8.11, 16.4, 16.12, 20.10
describe('parseDisplayRatingLeaderboard — total, and unambiguous or failed', () => {
  it('settles every input into exactly one of a populated value and a failure', () => {
    fc.assert(
      fc.property(anyBodyArb, (body) => {
        settle(
          () => parseDisplayRatingLeaderboard(body),
          isFullyPopulatedLeaderboard,
        );
      }),
      { numRuns: 1000 },
    );
  });

  it('settles a value nested to 100 levels', () => {
    fc.assert(
      fc.property(deeplyNestedArb, (body) => {
        const outcome = settle(
          () => parseDisplayRatingLeaderboard(body),
          isFullyPopulatedLeaderboard,
        );

        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('settles a body whose entries are 100 levels deep', () => {
    fc.assert(
      fc.property(deeplyNestedArb, statisticArb, (deep, statistic) => {
        const outcome = settle(
          () => parseDisplayRatingLeaderboard({ entries: deep, statistic }),
          isFullyPopulatedLeaderboard,
        );

        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('parses every well-formed body into a fully populated value', () => {
    fc.assert(
      fc.property(wellFormedLeaderboardArb, (body) => {
        const outcome = settle(
          () => parseDisplayRatingLeaderboard(body),
          isFullyPopulatedLeaderboard,
        );

        expect(outcome.ok).toBe(true);
        expect(outcome.ok && outcome.value.entries).toHaveLength(
          (body.entries as unknown[]).length,
        );
      }),
      { numRuns: 500 },
    );
  });

  it('parses an empty leaderboard, which is every row provisional rather than an error', () => {
    fc.assert(
      fc.property(statisticArb, (statistic) => {
        const outcome = settle(
          () => parseDisplayRatingLeaderboard({ entries: [], statistic }),
          isFullyPopulatedLeaderboard,
        );

        // A membership with no entry renders the Provisional_Band (7.2, 8.3), so an
        // empty leaderboard is a valid one.
        expect(outcome.ok).toBe(true);
        expect(outcome.ok && outcome.value.entries).toHaveLength(0);
      }),
      { numRuns: 200 },
    );
  });

  it('disregards the statistic entirely, in every form it could arrive in', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(wellFormedEntryArb, {
          maxLength: 8,
          selector: (entry) => entry.membershipId,
        }),
        statisticArb,
        (entries, statistic) => {
          const withStatistic = parseDisplayRatingLeaderboard({
            entries,
            statistic,
          });
          const withoutStatistic = parseDisplayRatingLeaderboard({ entries });

          // 16.12: reading it would mean a numeric enum literal outside
          // `lib/enumCodes.ts`, or a seventh code table with no user.
          expect(withStatistic).toEqual(withoutStatistic);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('parses a body whose statistic throws when read', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(wellFormedEntryArb, {
          maxLength: 6,
          selector: (entry) => entry.membershipId,
        }),
        (entries) => {
          const outcome = settle(
            () =>
              parseDisplayRatingLeaderboard(
                throwingAt({ entries, statistic: 1 }, 'statistic'),
              ),
            isFullyPopulatedLeaderboard,
          );

          // An unnamed property is never touched, so it cannot fail a body — a
          // stronger guarantee than discarding it after reading it.
          expect(outcome.ok).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('fails when the entries collection is absent or not an array', () => {
    fc.assert(
      fc.property(
        anyBodyArb.filter((value) => !Array.isArray(value)),
        (entries) => {
          const outcome = settle(
            () => parseDisplayRatingLeaderboard({ entries }),
            isFullyPopulatedLeaderboard,
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('fails the whole body when any one entry is bad', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(wellFormedEntryArb, {
          minLength: 1,
          maxLength: 8,
          selector: (entry) => entry.membershipId,
        }),
        fc.nat(),
        fc.oneof(
          anyBodyArb,
          wellFormedEntryArb.map((entry) => without(entry, 'value')),
        ),
        (entries, offset, spoiled) => {
          const index = offset % entries.length;
          const body: unknown[] = [...entries];
          body[index] = spoiled;

          const outcome = settle(
            () => parseDisplayRatingLeaderboard({ entries: body }),
            isFullyPopulatedLeaderboard,
          );

          // A bad entry degrades every row to Rating_Unavailable rather than
          // silently omitting one player's rating (8.3).
          expect(outcome.ok).toBe(parseDisplayRatingEntry(spoiled).ok);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('fails a leaderboard carrying a repeated membership identity', () => {
    fc.assert(
      fc.property(
        identityArb,
        displayNameArb,
        displayNameArb,
        ratingValueArb,
        ratingValueArb,
        fc.uniqueArray(wellFormedEntryArb, {
          maxLength: 6,
          selector: (entry) => entry.membershipId,
        }),
        (membershipId, firstName, secondName, firstValue, secondValue, others) => {
          const entries = [
            { membershipId, displayName: firstName, value: firstValue },
            ...others.filter((entry) => entry.membershipId !== membershipId),
            { membershipId, displayName: secondName, value: secondValue },
          ];

          const outcome = settle(
            () => parseDisplayRatingLeaderboard({ entries }),
            isFullyPopulatedLeaderboard,
          );

          // 8.11: there is no defensible way to choose between two ratings for one
          // person, so nobody gets a rating derived from an ambiguous body.
          expect(outcome.ok).toBe(false);

          if (!outcome.ok) {
            // The reason names the field, never the identity that repeated.
            expect(outcome.reason).not.toContain(membershipId);
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it('fails on a duplicate however far apart the two entries sit', () => {
    fc.assert(
      fc.property(
        identityArb,
        fc.integer({ min: 0, max: 40 }),
        (membershipId, gap) => {
          const filler = Array.from({ length: gap }, (_unused, index) => ({
            membershipId: `018f3a2b-4c5d-7e6f-8a9b-${String(index).padStart(12, '0')}`,
            displayName: 'Dave',
            value: index,
          }));
          const entries = [
            { membershipId, displayName: 'Dave', value: 1000 },
            ...filler.filter((entry) => entry.membershipId !== membershipId),
            { membershipId, displayName: 'Dave', value: 1001 },
          ];

          const outcome = settle(
            () => parseDisplayRatingLeaderboard({ entries }),
            isFullyPopulatedLeaderboard,
          );

          // One pass against a set of the identities already read, so distance
          // between the two entries changes nothing.
          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('treats identities differing only in letter case as distinct', () => {
    fc.assert(
      fc.property(
        fc
          .uuid()
          .filter((identity) => identity.toUpperCase() !== identity)
          .map((identity) => [identity, identity.toUpperCase()] as const),
        ratingValueArb,
        ([first, second], value) => {
          const outcome = settle(
            () =>
              parseDisplayRatingLeaderboard({
                entries: [
                  { membershipId: first, displayName: 'Dave', value },
                  { membershipId: second, displayName: 'Dave', value },
                ],
              }),
            isFullyPopulatedLeaderboard,
          );

          // Identities compare exactly, as Requirement 8.1's matching does: the
          // identity is opaque, so it is neither trimmed nor case-folded first.
          expect(outcome.ok).toBe(true);
          expect(outcome.ok && outcome.value.entries).toHaveLength(2);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('is deterministic, so no reading depends on a clock or a counter', () => {
    fc.assert(
      fc.property(fc.oneof(anyBodyArb, wellFormedLeaderboardArb), (body) => {
        expect(parseDisplayRatingLeaderboard(body)).toEqual(
          parseDisplayRatingLeaderboard(body),
        );
      }),
      { numRuns: 400 },
    );
  });
});
