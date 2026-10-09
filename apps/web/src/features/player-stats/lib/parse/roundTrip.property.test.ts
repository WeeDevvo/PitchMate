import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  RATING_SUMMARY_SHAPES,
  RICH_BLOCK_SHAPES,
  coAppearanceEntryArb,
  pairedStatEntryArb,
  playerProfileArb,
  playerProfileFixtureArb,
  playerRecordArb,
  progressionPointArb,
  ratingSummaryArb,
  richStatsArb,
  wireDurationFixtureArb,
} from '../../testing/playerProfileFixtures';
import {
  parseCoAppearanceEntry,
  parsePairedStatEntry,
  parsePlayerProfile,
  parsePlayerRecord,
  parseProgressionPoint,
  parseRatingSummary,
  parseRichStats,
  printCoAppearanceEntry,
  printPairedStatEntry,
  printPlayerProfile,
  printPlayerRecord,
  printProgressionPoint,
  printRatingSummary,
  printRichStats,
  type PlayerProfile,
  type ProgressionPoint,
  type RichStats,
} from './playerProfile';
import type { ParseResult } from './primitives';

/**
 * Property 10: the parser and the printer round-trip.
 *
 * `printPlayerProfile` exists so that a test, a fixture, or a future recorded
 * sample can state a `PlayerProfile` and obtain a body the Response_Parser
 * accepts. That is only worth anything if the two agree: a printer that emitted
 * a body the parser rejects would make every suite built on it a suite about
 * nothing, and — worse — a printer whose output *parses to a different profile*
 * would let a fixture quietly describe one profile while the parse under test
 * saw another. So the claim here is the strong one (Requirement 13.7): for every
 * profile the parser can produce, `parsePlayerProfile(printPlayerProfile(p))` is
 * **accepted** and yields a value **equal to `p`**, member for member, at every
 * level, with nothing added, dropped, reordered, or renormalised on the way.
 *
 * ## Why the comparison is in milliseconds, not in wire text
 *
 * Two members are normalised on read — a Progression_Point's completion instant
 * and the Rich_Stats Keeper_Time — and both have many wire spellings of the same
 * value. `'2026-01-01T00:00:00Z'`, `'2026-01-01T00:00:00.000+00:00'`, and a
 * seven-digit tick fraction all name one instant; `'00:45:00'` and
 * `'0.00:45:00.0000000'` name one duration. The printer emits **one canonical
 * form** rather than attempting to reproduce whichever form it was handed, which
 * it could not do in any case: the parsed value carries no wire text to
 * reproduce. Comparing printed text against received text would therefore fail
 * on a correct printer, so the round trip is stated in the domain the parser
 * normalises into — the milliseconds — and a dedicated case asserts that the
 * printed members really are *text*, so this is a relaxation of the comparison
 * and not a vacuous identity on a printer that returned its argument.
 *
 * ## What the generators have to reach
 *
 * The round trip can only fail at a value some generator produces, so the shapes
 * are pinned rather than left to chance (see {@link PROFILE_SHAPES}): empty and
 * 200-element Pairwise_Sections, an empty and a 500-point progression, each of
 * the four `RatingSummary` shapes the Rating_Condition resolver separates, and a
 * `rich` block absent, present with every member absent, fully populated, and
 * partially populated. The parsed arbitraries are the parsed side of this
 * feature's shared wire fixtures, so every profile generated is one the parser
 * can actually produce — a profile carrying an instant or a duration the printer
 * cannot print would fail this property for a reason that is not about the round
 * trip. The corners are asserted to be reached, under a fixed seed, at the foot
 * of this file.
 *
 * Each sub-parser and sub-printer pair is round-tripped in its own right too.
 * The whole-profile case would catch most of their defects, but not all: a block
 * the profile printer happens to emit uniformly could hide an asymmetry that a
 * caller using the sub-pair directly would meet.
 *
 * ## Equality is `Object.is`, deeply
 *
 * `toStrictEqual` would let a sign-flipped zero pass, and a zero count or a zero
 * percentage whose sign the printer or the reader altered is a value that was
 * changed in transit. {@link differences} therefore walks the two value graphs
 * itself, comparing leaves with `Object.is`, requiring exactly the same keys at
 * every object, and requiring the same elements in the same order in every
 * collection — a reordered "most played with" is a different ranked list, not an
 * equal one. It returns findings rather than asserting, so it can be pointed at
 * deliberately planted mismatches to prove it detects them.
 *
 * React-free and DOM-free, like every module under `lib/`: no clock, locale,
 * storage, or global is read, and the instants are the ones the generators chose.
 *
 * **Validates: Requirements 13.7**
 */

/* -------------------------------------------------------------------------- */
/* Deep equality, by `Object.is` at the leaves                                */
/* -------------------------------------------------------------------------- */

/** A value's own keys, sorted, as a comparable signature. */
function keySignature(value: object): string {
  return Object.keys(value).sort().join(',');
}

/**
 * Every way `actual` differs from `expected`, as diagnostics naming the member.
 *
 * Stricter than `toStrictEqual` in the one way that matters here: leaves are
 * compared with `Object.is`, so `-0` and `0` are different values. Objects must
 * carry exactly the same keys — an extra member is a difference, and so is a
 * member present as `undefined` — and collections must carry the same elements
 * in the same order.
 */
function differences(
  actual: unknown,
  expected: unknown,
  path = 'the value',
): string[] {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return [`${path} is not a collection`];
    }

    const actualElements = actual as readonly unknown[];
    const expectedElements = expected as readonly unknown[];

    if (actualElements.length !== expectedElements.length) {
      return [
        `${path} carries ${String(actualElements.length)} elements, not ${String(expectedElements.length)}`,
      ];
    }

    return expectedElements.flatMap((element, index) =>
      differences(
        actualElements[index],
        element,
        `${path}[${String(index)}]`,
      ),
    );
  }

  if (typeof expected === 'object' && expected !== null) {
    if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) {
      return [`${path} is not an object`];
    }

    if (keySignature(actual) !== keySignature(expected)) {
      return [
        `${path} carries keys ${keySignature(actual)}, not ${keySignature(expected)}`,
      ];
    }

    const actualMembers = actual as Record<string, unknown>;
    const expectedMembers = expected as Record<string, unknown>;

    return Object.keys(expectedMembers).flatMap((key) =>
      differences(actualMembers[key], expectedMembers[key], `${path}.${key}`),
    );
  }

  return Object.is(actual, expected)
    ? []
    : [`${path} is ${String(actual)}, not ${String(expected)}`];
}

/** A deep copy of a plain value, for the "the subject is unmodified" case. */
function deepCopy(value: unknown): unknown {
  if (Array.isArray(value)) {
    return (value as readonly unknown[]).map((element) => deepCopy(element));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, member]) => [key, deepCopy(member)]),
    );
  }

  return value;
}

/* -------------------------------------------------------------------------- */
/* The frame: a printed body is accepted, and nothing raises                  */
/* -------------------------------------------------------------------------- */

/**
 * The value a parse result carries, with the frame of the property asserted on
 * the way through: the result is one of the two declared shapes, and the printed
 * body was accepted.
 *
 * A rejected body is reported as a failure of *this* property rather than
 * swallowed: the printer's whole contract is to emit a body this parser accepts.
 */
function accepted<T>(result: ParseResult<T>, what: string, body: unknown): T {
  expect(typeof result).toBe('object');
  expect(result).not.toBeNull();

  if (!result.ok) {
    throw new Error(
      `the printed ${what} was rejected: ${result.reason} — ${String(JSON.stringify(body))}`,
    );
  }

  // A success is a value and nothing else.
  expect(keySignature(result)).toBe('ok,value');

  return result.value;
}

/**
 * `value` printed and read back, with a raise from either direction reported as
 * a distinct fault — a raise is not a parse failure, it escapes the call site
 * and takes the caller's own error handling with it (Requirement 13.1).
 */
function roundTripped<T>(
  value: T,
  print: (subject: T) => unknown,
  parse: (body: unknown) => ParseResult<T>,
  what: string,
): T {
  let body: unknown;

  try {
    body = print(value);
  } catch (raised) {
    throw new Error(`printing ${what} raised: ${String(raised)}`, {
      cause: raised,
    });
  }

  let result: ParseResult<T>;

  try {
    result = parse(body);
  } catch (raised) {
    throw new Error(`parsing a printed ${what} raised: ${String(raised)}`, {
      cause: raised,
    });
  }

  return accepted(result, what, body);
}

/**
 * A progression point printed and read back.
 *
 * Separate from {@link roundTripped} because the point parser's result is
 * nullable — a wire record carrying no Display_Rating is an accepted reading of
 * **no point** — and a printed point always carries one, so a `null` reading
 * here is a round-trip failure rather than a declared absence.
 */
function roundTrippedPoint(point: ProgressionPoint): ProgressionPoint {
  const body = printProgressionPoint(point);
  const read = accepted(
    parseProgressionPoint(body),
    'progression point',
    body,
  );

  if (read === null) {
    throw new Error(
      `a printed progression point read as no point: ${String(JSON.stringify(body))}`,
    );
  }

  return read;
}

/** A printed body, asserted to be a plain wire object. */
function printedObject(body: unknown): Record<string, unknown> {
  expect(typeof body).toBe('object');
  expect(body).not.toBeNull();
  expect(Array.isArray(body)).toBe(false);

  return body as Record<string, unknown>;
}

/** A printed wire collection of objects, asserted to be one. */
function printedArray(value: unknown): readonly Record<string, unknown>[] {
  expect(Array.isArray(value)).toBe(true);

  return value as readonly Record<string, unknown>[];
}

/* -------------------------------------------------------------------------- */
/* The profile shapes the property quantifies over                            */
/* -------------------------------------------------------------------------- */

/** A parsed profile of the given body shape. */
function parsedProfileArb(
  options: Parameters<typeof playerProfileFixtureArb>[0],
): fc.Arbitrary<PlayerProfile> {
  return playerProfileFixtureArb(options).map((fixture) => fixture.parsed);
}

/** No elements at all, and exactly 200 or 500 of them. */
const NO_ELEMENTS = { minLength: 0, maxLength: 0 } as const;
const ONE_ELEMENT = { minLength: 1, maxLength: 1 } as const;
const PAIRWISE_AT_SIZE = { minLength: 200, maxLength: 200 } as const;
const PROGRESSION_AT_SIZE = { minLength: 500, maxLength: 500 } as const;

/**
 * Every profile shape this property is claimed over.
 *
 * The collection extremes are the folds a mid-sized random array misses, and the
 * rating and `rich` shapes are the ones whose *absences* the round trip has to
 * carry through unchanged: a printer that spelled an absent Display_Rating as a
 * zero, or collapsed an all-absent `rich` block to an absent one, would be
 * caught here and nowhere else in this file.
 */
const PROFILE_SHAPES: readonly {
  readonly label: string;
  readonly arbitrary: fc.Arbitrary<PlayerProfile>;
}[] = [
  { label: 'ordinary collections', arbitrary: playerProfileArb },
  {
    label: 'empty collections',
    arbitrary: parsedProfileArb({
      pairwise: NO_ELEMENTS,
      progression: NO_ELEMENTS,
    }),
  },
  {
    label: 'singleton collections',
    arbitrary: parsedProfileArb({
      pairwise: ONE_ELEMENT,
      progression: ONE_ELEMENT,
    }),
  },
  {
    label: '200-element pairwise sections and a 500-point progression',
    arbitrary: parsedProfileArb({
      pairwise: PAIRWISE_AT_SIZE,
      progression: PROGRESSION_AT_SIZE,
    }),
  },
  ...RATING_SUMMARY_SHAPES.map((shape) => ({
    label: `a rating with ${shape.label}`,
    arbitrary: parsedProfileArb({ rating: shape.arbitrary }),
  })),
  ...RICH_BLOCK_SHAPES.map((shape) => ({
    label: `a rich block ${shape.label}`,
    arbitrary: parsedProfileArb({ rich: shape.arbitrary }),
  })),
];

/**
 * A rich block whose Keeper_Time is present.
 *
 * Declared locally rather than filtered out of `richStatsArb`, so the duration
 * is chosen rather than waited for: this is the generator for the case that
 * states the duration is printed as text and read back as the same milliseconds.
 */
const keeperTimeRichStatsArb: fc.Arbitrary<RichStats> = fc
  .tuple(richStatsArb, wireDurationFixtureArb)
  .map(([rich, duration]) => ({ ...rich, keeperTimeMs: duration.ms }));

/* -------------------------------------------------------------------------- */
/* Property 10, over the whole profile                                        */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 10: Parser and printer round-trip
// Validates: Requirements 13.7
describe('the parser and the printer round-trip a whole profile', () => {
  for (const shape of PROFILE_SHAPES) {
    it(`accepts the printed form of a profile with ${shape.label}, and yields it back`, () => {
      fc.assert(
        fc.property(shape.arbitrary, (profile) => {
          const read = roundTripped(
            profile,
            printPlayerProfile,
            parsePlayerProfile,
            'profile',
          );

          expect(differences(read, profile, 'the profile')).toStrictEqual([]);
        }),
        { numRuns: 100 },
      );
    });
  }

  it('prints every instant and duration as text, and reads each back as the same milliseconds', () => {
    fc.assert(
      fc.property(playerProfileArb, (profile) => {
        const body = printedObject(printPlayerProfile(profile));

        // The non-triviality of the whole property: the printed form is the
        // *wire* shape — a `completedAt` string, not the `completedAtMs` number
        // the parsed point carries — so the equality above is an equality after
        // a real normalisation, not an identity on a printer that returned its
        // argument.
        const records = printedArray(body.progression);

        expect(records).toHaveLength(profile.progression.length);

        records.forEach((record) => {
          expect(typeof record.completedAt).toBe('string');
          expect('completedAtMs' in record).toBe(false);
        });

        if (profile.rich !== null) {
          const rich = printedObject(body.rich);

          expect(typeof rich.keeperTime).toBe(
            profile.rich.keeperTimeMs === null ? 'object' : 'string',
          );
          expect('keeperTimeMs' in rich).toBe(false);
        }

        const read = accepted(parsePlayerProfile(body), 'profile', body);

        profile.progression.forEach((point, index) => {
          expect(
            Object.is(read.progression[index].completedAtMs, point.completedAtMs),
          ).toBe(true);
        });

        expect(
          Object.is(
            read.rich?.keeperTimeMs ?? null,
            profile.rich?.keeperTimeMs ?? null,
          ),
        ).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('is stable: a round-tripped profile prints and reads back again unchanged', () => {
    fc.assert(
      fc.property(playerProfileArb, (profile) => {
        const once = roundTripped(
          profile,
          printPlayerProfile,
          parsePlayerProfile,
          'profile',
        );
        const twice = roundTripped(
          once,
          printPlayerProfile,
          parsePlayerProfile,
          'profile',
        );

        expect(differences(twice, profile, 'the profile')).toStrictEqual([]);

        // And the printer is a function of its argument alone: two prints of the
        // same profile are the same body.
        expect(
          differences(
            printPlayerProfile(profile),
            printPlayerProfile(profile),
            'the printed body',
          ),
        ).toStrictEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it('leaves the profile it printed unmodified', () => {
    fc.assert(
      fc.property(playerProfileArb, (profile) => {
        const before = deepCopy(profile);

        printPlayerProfile(profile);

        expect(differences(profile, before, 'the profile')).toStrictEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Property 10, block by block                                                */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 10: Parser and printer round-trip
// Validates: Requirements 13.7
describe('the parser and the printer round-trip each block', () => {
  it('a player record', () => {
    fc.assert(
      fc.property(playerRecordArb, (record) => {
        const read = roundTripped(
          record,
          printPlayerRecord,
          parsePlayerRecord,
          'player record',
        );

        expect(differences(read, record, 'the record')).toStrictEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it('a rating summary, in each of its shapes', () => {
    for (const shape of RATING_SUMMARY_SHAPES) {
      fc.assert(
        fc.property(
          shape.arbitrary.map((fixture) => fixture.parsed),
          (rating) => {
            const read = roundTripped(
              rating,
              printRatingSummary,
              parseRatingSummary,
              'rating summary',
            );

            expect(
              differences(read, rating, `the ${shape.label} rating`),
            ).toStrictEqual([]);
          },
        ),
        { numRuns: 100 },
      );
    }

    fc.assert(
      fc.property(ratingSummaryArb, (rating) => {
        const read = roundTripped(
          rating,
          printRatingSummary,
          parseRatingSummary,
          'rating summary',
        );

        expect(differences(read, rating, 'the rating')).toStrictEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it('a progression point', () => {
    fc.assert(
      fc.property(progressionPointArb, (point) => {
        const read = roundTrippedPoint(point);

        expect(differences(read, point, 'the point')).toStrictEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it('a co-appearance entry', () => {
    fc.assert(
      fc.property(coAppearanceEntryArb, (entry) => {
        const read = roundTripped(
          entry,
          printCoAppearanceEntry,
          parseCoAppearanceEntry,
          'co-appearance entry',
        );

        expect(differences(read, entry, 'the entry')).toStrictEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it('a paired statistic entry', () => {
    fc.assert(
      fc.property(pairedStatEntryArb, (entry) => {
        const read = roundTripped(
          entry,
          printPairedStatEntry,
          parsePairedStatEntry,
          'paired statistic entry',
        );

        expect(differences(read, entry, 'the entry')).toStrictEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it('a rich stats block, with its members present and absent', () => {
    // `richStatsArb` is the parsed side of every present-block configuration:
    // fully populated, every member absent, and an arbitrary subset. The absent
    // *block* is a profile-level state rather than a block to print, and is
    // covered by the `rich block absent` profile shape above.
    fc.assert(
      fc.property(richStatsArb, (rich) => {
        const read = roundTripped(
          rich,
          printRichStats,
          parseRichStats,
          'rich stats block',
        );

        expect(differences(read, rich, 'the rich block')).toStrictEqual([]);
      }),
      { numRuns: 200 },
    );

    fc.assert(
      fc.property(keeperTimeRichStatsArb, (rich) => {
        const body = printedObject(printRichStats(rich));

        expect(typeof body.keeperTime).toBe('string');

        const read = accepted(parseRichStats(body), 'rich stats block', body);

        expect(Object.is(read.keeperTimeMs, rich.keeperTimeMs)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Non-vacuity: the comparison detects a mismatch, the generators reach the   */
/* corners                                                                    */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 10: Parser and printer round-trip
// Validates: Requirements 13.7
describe('the round-trip comparison and the profile generators', () => {
  it('detects every kind of mismatch it is meant to', () => {
    const planted: readonly {
      readonly label: string;
      readonly actual: unknown;
      readonly expected: unknown;
    }[] = [
      { label: 'a changed count', actual: { count: 3 }, expected: { count: 4 } },
      {
        label: 'a sign-flipped zero',
        actual: { count: -0 },
        expected: { count: 0 },
      },
      {
        label: 'a rounded percentage',
        actual: { value: 33 },
        expected: { value: 33.3 },
      },
      { label: 'an extra member', actual: { a: 1, b: 2 }, expected: { a: 1 } },
      { label: 'a missing member', actual: { a: 1 }, expected: { a: 1, b: 2 } },
      {
        label: 'a member left undefined',
        actual: { a: undefined },
        expected: { a: 1 },
      },
      {
        label: 'a dropped element',
        actual: { rows: [1] },
        expected: { rows: [1, 2] },
      },
      {
        label: 'a reordered collection',
        actual: { rows: [2, 1] },
        expected: { rows: [1, 2] },
      },
      {
        label: 'an instant off by a millisecond',
        actual: { completedAtMs: 1 },
        expected: { completedAtMs: 0 },
      },
      {
        label: 'a duration off by a millisecond',
        actual: { keeperTimeMs: 2_700_001 },
        expected: { keeperTimeMs: 2_700_000 },
      },
      {
        label: 'an absence spelled as a zero',
        actual: { displayRating: 0 },
        expected: { displayRating: null },
      },
      {
        label: 'a number read as its decimal string',
        actual: { goals: '12' },
        expected: { goals: 12 },
      },
      { label: 'not an object at all', actual: null, expected: { a: 1 } },
      { label: 'not a collection at all', actual: {}, expected: [] },
    ];

    for (const { label, actual, expected } of planted) {
      expect(differences(actual, expected), label).not.toStrictEqual([]);
    }

    // And it is not simply firing on everything.
    expect(differences({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toStrictEqual(
      [],
    );
    expect(differences({ a: null }, { a: null })).toStrictEqual([]);
    expect(differences(Number.NaN, Number.NaN)).toStrictEqual([]);
  });

  it('would have caught a profile that came back altered', () => {
    // A fixed seed, so this is a fact about the comparison rather than a hope
    // about a particular run.
    const [profile] = fc.sample(playerProfileArb, {
      numRuns: 1,
      seed: 20_260_112,
    });

    const read = roundTripped(
      profile,
      printPlayerProfile,
      parsePlayerProfile,
      'profile',
    );

    expect(differences(read, profile, 'the profile')).toStrictEqual([]);

    // The same comparison, against profiles that differ in exactly one member,
    // must fail — otherwise the case above says nothing.
    const altered: readonly { readonly label: string; readonly value: unknown }[] =
      [
        {
          label: 'one more bib appearance',
          value: { ...profile, bibAppearances: profile.bibAppearances + 1 },
        },
        {
          label: 'a defaulted win percentage',
          value: { ...profile, winPercentage: 0 },
        },
        {
          label: 'a defaulted rating state',
          value: { ...profile, rating: { ...profile.rating, state: null } },
        },
        {
          label: 'a collapsed rich block',
          value: { ...profile, rich: null },
        },
        {
          label: 'a progression point dropped',
          value: { ...profile, progression: [] },
        },
      ].filter(({ value }) => differences(value, profile).length > 0);

    // Each alteration the generated profile actually differs under — a profile
    // that already carried a zero win percentage is no alteration at all.
    expect(altered.length).toBeGreaterThan(0);

    for (const { label, value } of altered) {
      expect(differences(read, value, 'the profile'), label).not.toStrictEqual(
        [],
      );
    }
  });

  it('generates profiles reaching every corner the property names', () => {
    const seen = {
      emptyPairwise: 0,
      pairwiseAtSize: 0,
      emptyProgression: 0,
      progressionAtSize: 0,
      provisionalRating: 0,
      establishedRating: 0,
      ratingStateAbsent: 0,
      displayRatingAbsent: 0,
      richAbsent: 0,
      richAllAbsent: 0,
      richFullyPopulated: 0,
      keeperTimePresent: 0,
    };

    for (const shape of PROFILE_SHAPES) {
      // A fixed seed, so the coverage claim is a fact about the generators.
      for (const profile of fc.sample(shape.arbitrary, {
        numRuns: 8,
        seed: 20_260_112,
      })) {
        if (profile.mostPlayedWith.length === 0) seen.emptyPairwise += 1;
        if (profile.mostPlayedWith.length === 200) seen.pairwiseAtSize += 1;
        if (profile.progression.length === 0) seen.emptyProgression += 1;
        if (profile.progression.length >= 200) seen.progressionAtSize += 1;

        if (profile.rating.state === 'Provisional') seen.provisionalRating += 1;
        if (profile.rating.state === 'Established') seen.establishedRating += 1;
        if (profile.rating.state === null) seen.ratingStateAbsent += 1;
        if (profile.rating.displayRating === null) {
          seen.displayRatingAbsent += 1;
        }

        const rich = profile.rich;

        if (rich === null) {
          seen.richAbsent += 1;
        } else {
          const members = [
            rich.goals,
            rich.cleanSheets,
            rich.goalsConcededAsKeeper,
            rich.keeperTimeMs,
          ];

          if (members.every((member) => member === null)) {
            seen.richAllAbsent += 1;
          }

          if (members.every((member) => member !== null)) {
            seen.richFullyPopulated += 1;
          }

          if (rich.keeperTimeMs !== null) seen.keeperTimePresent += 1;
        }
      }
    }

    for (const [corner, count] of Object.entries(seen)) {
      expect(count, `${corner} was never generated`).toBeGreaterThan(0);
    }
  });
});
