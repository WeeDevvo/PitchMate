import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { resolveRatingCondition } from './ratingCondition';
import type { RatingCondition } from './ratingCondition';
import type { RatingSummary } from './parse/playerProfile';
import type { RatingState } from './wireEnums';

/**
 * Property test for the one function that resolves a membership's
 * Rating_Condition, placed beside the module it covers as the design's Testing
 * Strategy asks and running above the 100-iteration floor (Requirement 14.5).
 *
 * This file carries **Property 15: The rating condition is total and
 * single-valued** — for any `RatingSummary` and any appearance count,
 * `resolveRatingCondition` returns exactly one of `established`, `provisional`,
 * `never-played`, and `absent`, and raises nothing (Requirement 7.1).
 *
 * Three choices about how this is written matter more than the run counts.
 *
 * First, the **input space is walked exhaustively rather than sampled**. The
 * function has two parameters drawn from small interesting sets — three rating
 * states (provisional, established, none recorded), the Display_Rating shapes
 * the task names (present, absent, zero, negative, very large), and the
 * appearance counts it names (zero, one, large) — so the full grid is visited in
 * every run, and the generated arbitraries run *beside* it rather than instead
 * of it. A sampler alone would reach the combination that matters most only
 * sometimes; a grid reaches it always.
 *
 * Second, **"exactly one of four" is asserted as exclusivity over shapes**, not
 * as a tag equality. Four independent acceptors are declared below, each
 * demanding one kind *and* its exact field set; every resolved condition must be
 * accepted by exactly one of them. A union that grew a fifth kind, a
 * `never-played` that started carrying a Display_Rating, or a misspelled tag
 * would be rejected by all four and fail here — whereas
 * `expect(condition.kind).toBe(…)` would notice none of it. The four names are
 * transcribed from Requirement 7.1 and the design's property statement rather
 * than read off the module, so the suite and the module can disagree.
 *
 * Third, **exclusivity alone is vacuous**, since a function answering `absent`
 * forever satisfies it. So each of the four kinds is shown reachable from some
 * input, and the function is additionally asserted pure: deterministic across
 * repeated reads, holding no state between calls, and leaving the rating summary
 * it was handed unmodified.
 *
 * What is deliberately **not** claimed here, because the next subtask owns it
 * and restating it would hide a regression behind a duplicate: that a zero
 * appearance count yields `never-played` whatever the rating says (Property 16,
 * `ratingCondition.neverPlayed.property.test.ts`), and that a provisional rating
 * never renders as a number (Property 17, at the render site). This file states
 * only that *some* single condition always comes back, never which one — with
 * the one exception of the four reachability witnesses, which exist to stop the
 * exclusivity claim being satisfied trivially.
 *
 * Requirements: 7.1, 14.5
 */

// --- the four conditions ------------------------------------------------------

/**
 * Every condition the requirement names, transcribed from Requirement 7.1 and
 * the design's Property 15 rather than derived from the module — a suite that
 * read the module's own vocabulary would agree with any vocabulary at all,
 * including one missing a condition.
 */
const CONDITION_KINDS = [
  'established',
  'provisional',
  'never-played',
  'absent',
] as const;

/** One resolver activation: the two arguments, kept together for reporting. */
interface ResolverInput {
  readonly rating: RatingSummary;
  readonly appearances: number;
}

/** The condition's own keys, sorted, as a comparable string. */
function keySignature(value: object): string {
  return Object.keys(value).sort().join(',');
}

/**
 * One acceptor per condition: the tag, and the exact field set.
 *
 * These are what make the "exactly one of four" claim mean something. Each is
 * total over any condition, so every condition can be offered to all four and
 * the count of acceptances asserted.
 *
 * The three non-numeric arms demand `kind` as their **only** key, because that
 * absence is the mechanism by which no caller can render a figure while a rating
 * is provisional, unplayed, or unrecorded (Requirements 7.3 to 7.5) — asserted
 * here as shape rather than assumed. The `established` acceptor demands the one
 * field it declares, that the field is a number at runtime as well as in the
 * declared type, and that it is the number the input carried: an acceptor
 * satisfied by *any* number would also be satisfied by a resolver that rescaled
 * one, which is not a thing this feature may do (Requirement 7.8).
 */
const CONDITION_SHAPES: readonly {
  readonly label: (typeof CONDITION_KINDS)[number];
  readonly accepts: (
    condition: RatingCondition,
    input: ResolverInput,
  ) => boolean;
}[] = CONDITION_KINDS.map((kind) => ({
  label: kind,
  accepts: (condition: RatingCondition, input: ResolverInput) => {
    if (condition.kind !== kind) {
      return false;
    }

    if (condition.kind === 'established') {
      return (
        keySignature(condition) === 'displayRating,kind' &&
        typeof condition.displayRating === 'number' &&
        Object.is(condition.displayRating, input.rating.displayRating)
      );
    }

    return keySignature(condition) === 'kind';
  },
}));

/** The labels of every shape that accepts `condition` for `input`. */
function acceptingShapes(
  condition: RatingCondition,
  input: ResolverInput,
): readonly string[] {
  return CONDITION_SHAPES.filter(({ accepts }) =>
    accepts(condition, input),
  ).map(({ label }) => label);
}

/** The input named in an assertion message, so a failure identifies itself. */
function describeInput({ rating, appearances }: ResolverInput): string {
  return `state ${String(rating.state)}, displayRating ${String(
    rating.displayRating,
  )}, appearances ${String(appearances)}`;
}

// --- the input space ----------------------------------------------------------

/**
 * Every Rating_State the Response_Parser can produce: the two names the backend
 * enum declares, and the absence it admits as a valid reading.
 */
const RATING_STATES: readonly (RatingState | null)[] = [
  'Provisional',
  'Established',
  null,
];

/**
 * The Display_Rating shapes the task names — present, absent, zero, negative,
 * very large — each spelled out so it is visited in every run rather than only
 * in the runs a sampler reached it in.
 *
 * `-0` is included beside `0` because they are distinct values that must resolve
 * identically, and the three non-finite numbers are included because totality is
 * a claim about every input: the Response_Parser's `readNumber` rejects them, so
 * none can arrive through the seam, and a resolver that answered for them only
 * by accident is still worth catching here.
 */
const DISPLAY_RATINGS: readonly (number | null)[] = [
  1000,
  1234,
  1,
  0,
  -0,
  -1,
  -1000,
  0.5,
  -0.5,
  1500.75,
  Number.MAX_SAFE_INTEGER,
  Number.MIN_SAFE_INTEGER,
  Number.MAX_VALUE,
  Number.MIN_VALUE,
  Number.EPSILON,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  null,
];

/**
 * The Appearance_Counts the task names — zero, one, large — plus `-0`, which
 * reads as no appearances (`-0 === 0`), and the counts the Response_Parser's
 * `readCount` rejects, which must still resolve rather than raise.
 */
const APPEARANCE_COUNTS: readonly number[] = [
  0, -0, 1, 2, 7, 38, 500, 10_000, 1_000_000, Number.MAX_SAFE_INTEGER, 0.5, 1.5,
  -1, -500, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
];

/** Every combination of state, Display_Rating, and Appearance_Count. */
const INPUT_GRID: readonly ResolverInput[] = RATING_STATES.flatMap((state) =>
  DISPLAY_RATINGS.flatMap((displayRating) =>
    APPEARANCE_COUNTS.map((appearances) => ({
      rating: { state, displayRating },
      appearances,
    })),
  ),
);

// --- generators ---------------------------------------------------------------

/** A Rating_State, the absence included. */
const ratingStateArb: fc.Arbitrary<RatingState | null> = fc.constantFrom(
  ...RATING_STATES,
);

/** A Display_Rating: the named shapes, plus arbitrary integers and doubles. */
const displayRatingArb: fc.Arbitrary<number | null> = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...DISPLAY_RATINGS) },
  { weight: 3, arbitrary: fc.integer({ min: -5000, max: 5000 }) },
  { weight: 2, arbitrary: fc.double() },
  { weight: 2, arbitrary: fc.constant(null) },
);

/** An Appearance_Count: the named counts, plus arbitrary whole and real numbers. */
const appearanceCountArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...APPEARANCE_COUNTS) },
  { weight: 4, arbitrary: fc.nat({ max: 10_000 }) },
  { weight: 2, arbitrary: fc.integer({ min: -10_000, max: 10_000 }) },
  { weight: 1, arbitrary: fc.double() },
);

/** A rating summary of any shape the parsed type admits, and some it does not. */
const ratingSummaryArb: fc.Arbitrary<RatingSummary> = fc.record({
  state: ratingStateArb,
  displayRating: displayRatingArb,
});

/** One activation of the resolver, both arguments generated independently. */
const resolverInputArb: fc.Arbitrary<ResolverInput> = fc.record({
  rating: ratingSummaryArb,
  appearances: appearanceCountArb,
});

/** Resolve, keeping the input beside the answer for the shape acceptors. */
function resolve(input: ResolverInput): RatingCondition {
  return resolveRatingCondition(input.rating, input.appearances);
}

// --- the oracle this suite holds itself to ------------------------------------

// Feature: web-player-stats-screen, Property 15: The rating condition is total
// and single-valued — the vocabulary and the grid the suite is written against
// Validates: Requirements 7.1
describe('resolveRatingCondition — the four conditions this suite holds it to', () => {
  it('names four distinct conditions, and one shape acceptor for each', () => {
    // Asserted before anything is held to the acceptors, so a duplicated or
    // missing condition fails here rather than producing a confident wrong
    // verdict below.
    expect(new Set(CONDITION_KINDS).size).toBe(4);
    expect(CONDITION_SHAPES).toHaveLength(4);
    expect(CONDITION_SHAPES.map(({ label }) => label).sort()).toEqual(
      [...CONDITION_KINDS].sort(),
    );
  });

  it('names exactly the conditions Requirement 7.1 declares', () => {
    // Stated literally, because a suite deriving its vocabulary from the module
    // would accept a module that had quietly grown or lost a condition.
    expect([...CONDITION_KINDS].sort()).toEqual([
      'absent',
      'established',
      'never-played',
      'provisional',
    ]);
  });

  it('walks every combination of the three input dimensions', () => {
    // The grid is the coverage claim, so its size is asserted rather than
    // assumed: a dimension that lost a case silently would otherwise weaken
    // every property below.
    expect(INPUT_GRID).toHaveLength(
      RATING_STATES.length * DISPLAY_RATINGS.length * APPEARANCE_COUNTS.length,
    );
    expect(RATING_STATES).toHaveLength(3);
    expect(DISPLAY_RATINGS.length).toBeGreaterThanOrEqual(5);
    expect(APPEARANCE_COUNTS.length).toBeGreaterThanOrEqual(3);
  });

  it('carries each rating state the parser can produce, the absence included', () => {
    expect(RATING_STATES).toContain('Provisional');
    expect(RATING_STATES).toContain('Established');
    expect(RATING_STATES).toContain(null);
  });

  it('carries the display ratings the property names, named rather than sampled', () => {
    // Present, absent, zero, negative, very large — the five shapes the task
    // calls out, each asserted present so the coverage does not depend on the
    // sampler.
    expect(DISPLAY_RATINGS.some((value) => value === 1000)).toBe(true);
    expect(DISPLAY_RATINGS).toContain(null);
    expect(DISPLAY_RATINGS.some((value) => Object.is(value, 0))).toBe(true);
    expect(DISPLAY_RATINGS.some((value) => Object.is(value, -0))).toBe(true);
    expect(
      DISPLAY_RATINGS.some((value) => typeof value === 'number' && value < 0),
    ).toBe(true);
    expect(DISPLAY_RATINGS).toContain(Number.MAX_SAFE_INTEGER);
    expect(DISPLAY_RATINGS.some((value) => Number.isNaN(value))).toBe(true);
  });

  it('carries the appearance counts the property names, zero and one included', () => {
    expect(APPEARANCE_COUNTS.some((count) => Object.is(count, 0))).toBe(true);
    expect(APPEARANCE_COUNTS.some((count) => Object.is(count, -0))).toBe(true);
    expect(APPEARANCE_COUNTS).toContain(1);
    expect(APPEARANCE_COUNTS).toContain(Number.MAX_SAFE_INTEGER);
    expect(APPEARANCE_COUNTS.some((count) => count > 1000)).toBe(true);
  });
});

// --- the property proper ------------------------------------------------------

// Feature: web-player-stats-screen, Property 15: The rating condition is total
// and single-valued
// Validates: Requirements 7.1
describe('resolveRatingCondition — exactly one of four conditions', () => {
  it('yields a condition accepted by exactly one of the four shapes, for any input', () => {
    fc.assert(
      fc.property(resolverInputArb, (input) => {
        // The property proper (7.1): one condition, and only one, for every
        // combination of a rating summary and an appearance count.
        const condition = resolve(input);

        expect(acceptingShapes(condition, input), describeInput(input)).toEqual([
          condition.kind,
        ]);
        expect(
          (CONDITION_KINDS as readonly string[]).includes(condition.kind),
        ).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it('resolves every combination of state, display rating, and appearance count', () => {
    // The grid is walked in full rather than sampled: 7.1 speaks about every
    // combination of the inputs, and the interesting combinations number in the
    // hundreds — a space small enough to visit exhaustively.
    for (const input of INPUT_GRID) {
      const condition = resolve(input);

      expect(acceptingShapes(condition, input), describeInput(input)).toEqual([
        condition.kind,
      ]);
    }
  });

  it('resolves a generated draw from the grid to exactly one condition', () => {
    fc.assert(
      fc.property(fc.constantFrom(...INPUT_GRID), (input) => {
        // The same claim under the sampler, so the grid's cases are also
        // exercised in the shrinking path that reports a counter-example.
        const condition = resolve(input);

        expect(
          acceptingShapes(condition, input),
          describeInput(input),
        ).toEqual([condition.kind]);
      }),
      { numRuns: 1000 },
    );
  });

  it('carries nothing but its kind, except for the one arm with a number to render', () => {
    fc.assert(
      fc.property(resolverInputArb, (input) => {
        // The single-valued claim read as a field set: three of the four arms
        // declare no field, so there is nowhere for a Display_Rating to ride
        // along into a presentation that must not show one (7.3 to 7.5).
        const condition = resolve(input);
        const keys = Object.keys(condition).sort();

        const expected =
          condition.kind === 'established'
            ? ['displayRating', 'kind']
            : ['kind'];

        expect(keys, describeInput(input)).toEqual(expected);
      }),
      { numRuns: 1000 },
    );
  });

  it('reaches each of the four conditions from some input', () => {
    // The exclusivity property alone is satisfied by a function that always
    // answered `absent`, so the four are shown reachable too. These are the only
    // places this file states *which* condition comes back; the precedence
    // itself belongs to Properties 16 and 17.
    const established: RatingSummary = {
      state: 'Established',
      displayRating: 1000,
    };
    const witnesses: readonly (readonly [ResolverInput, string])[] = [
      [{ rating: established, appearances: 5 }, 'established'],
      [
        {
          rating: { state: 'Provisional', displayRating: null },
          appearances: 2,
        },
        'provisional',
      ],
      [{ rating: established, appearances: 0 }, 'never-played'],
      [
        { rating: { state: null, displayRating: null }, appearances: 9 },
        'absent',
      ],
    ];

    expect(witnesses.map(([input]) => resolve(input).kind)).toEqual(
      witnesses.map(([, kind]) => kind),
    );
    expect(new Set(witnesses.map(([, kind]) => kind)).size).toBe(4);
  });
});

// --- totality -----------------------------------------------------------------

// Feature: web-player-stats-screen, Property 15: The rating condition is total
// and single-valued — nothing is raised
// Validates: Requirements 7.1
describe('resolveRatingCondition — nothing is raised', () => {
  it('answers for any rating summary and any appearance count without raising', () => {
    fc.assert(
      fc.property(resolverInputArb, (input) => {
        // Totality stated as its own claim rather than inferred from the
        // assertions above: both arguments originate in a response body, so
        // every combination must settle rather than throw.
        expect(() =>
          resolveRatingCondition(input.rating, input.appearances),
        ).not.toThrow();
      }),
      { numRuns: 1000 },
    );
  });

  it('answers for every combination of the grid, the non-finite values included', () => {
    expect(() => {
      for (const { rating, appearances } of INPUT_GRID) {
        resolveRatingCondition(rating, appearances);
      }
    }).not.toThrow();
  });

  it('accepts a frozen rating summary, so one profile can be resolved twice', () => {
    fc.assert(
      fc.property(resolverInputArb, (input) => {
        const frozen: ResolverInput = {
          rating: Object.freeze({ ...input.rating }),
          appearances: input.appearances,
        };

        expect(acceptingShapes(resolve(frozen), frozen)).toHaveLength(1);
      }),
      { numRuns: 500 },
    );
  });

  it('reads only the two rating members it declares, so nothing else is touched', () => {
    fc.assert(
      fc.property(resolverInputArb, (input) => {
        // The condition may not acquire a tell from a Rating_Internal, from
        // `isGuest`, or from the membership state — none of them is a parameter,
        // and a surplus member on the rating block must go unread. Throwing
        // accessors make the claim observable: if the resolver walked the object,
        // this would raise instead of resolving.
        const withSurplus = {
          ...input.rating,
          get mu(): number {
            throw new Error('a Rating_Internal must never be read');
          },
          get sigma(): number {
            throw new Error('a Rating_Internal must never be read');
          },
          get isGuest(): boolean {
            throw new Error('the guest flag must never be read');
          },
          get membershipState(): string {
            throw new Error('the membership state must never be read');
          },
        } as RatingSummary;

        expect(
          resolveRatingCondition(withSurplus, input.appearances),
        ).toEqual(resolve(input));
      }),
      { numRuns: 500 },
    );
  });
});

// --- purity -------------------------------------------------------------------

// Feature: web-player-stats-screen, Property 15: the condition is a pure
// function of the two values it is given
// Validates: Requirements 7.1, 14.5
describe('resolveRatingCondition — the resolution is pure', () => {
  it('is deterministic: repeated calls on one input agree', () => {
    fc.assert(
      fc.property(resolverInputArb, (input) => {
        // The screen resolves the condition on every render; two reads of one
        // profile must not disagree.
        const first = resolve(input);

        expect(resolve(input)).toEqual(first);
        expect(resolve(input)).toEqual(first);
      }),
      { numRuns: 1000 },
    );
  });

  it('does not modify the rating summary it was given', () => {
    fc.assert(
      fc.property(resolverInputArb, (input) => {
        const before = { ...input.rating };

        resolve(input);

        expect(input.rating).toEqual(before);
      }),
      { numRuns: 500 },
    );
  });

  it('depends on nothing but the two values it is given', () => {
    fc.assert(
      fc.property(resolverInputArb, resolverInputArb, (first, second) => {
        const firstCondition = resolve(first);

        // Resolving an unrelated profile in between changes nothing, so the
        // function holds no state across calls — which is what lets one module
        // serve every section of the screen and every load of it.
        resolve(second);

        expect(resolve(first)).toEqual(firstCondition);
      }),
      { numRuns: 500 },
    );
  });

  it('answers a fresh value each time, so no caller can mutate a shared condition', () => {
    fc.assert(
      fc.property(resolverInputArb, (input) => {
        // Three of the arms are bare tags, so a shared frozen singleton would be
        // sound too — but a returned object a section could write to would not
        // be, and this states which of the two the module does.
        const first = resolve(input);
        const second = resolve(input);

        expect(second).toEqual(first);
        expect(second).not.toBe(first);
      }),
      { numRuns: 500 },
    );
  });
});
