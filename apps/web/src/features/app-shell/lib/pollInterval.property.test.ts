import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  effectivePollIntervalSeconds,
  POLL_INTERVAL_DEFAULT_SECONDS,
  POLL_INTERVAL_MAX_SECONDS,
  POLL_INTERVAL_MIN_SECONDS,
} from './pollInterval';

/**
 * Property tests for the App_Shell's single pure Poll_Interval clamp, placed
 * beside the module they cover as Requirement 14.2 asks, and run well above the
 * 100-iteration floor.
 *
 * These carry **Property 16: The effective poll interval is always within 15 to
 * 600 seconds**:
 *
 *  - *the range invariant* — every input, of any type, yields a finite number in
 *    `15..600` inclusive (Requirement 14.9);
 *  - *agreement with the stated folding and clamping* — absent, non-numeric, and
 *    non-finite values yield 60; a value below 15 yields 15; a value above 600
 *    yields 600; anything else yields the configured value unchanged
 *    (Requirement 4.6);
 *  - *totality* — no input raises, including `NaN`, both infinities, `-0`,
 *    strings (numeric ones included), booleans, arrays, objects, and values
 *    whose `valueOf`/`toString` would throw if the clamp ever coerced them.
 *
 * The expected mapping is re-derived here from the acceptance criteria rather
 * than lifted from the module's branch structure, so a change of implementation
 * cannot silently drag the expectation along with it. The three bound constants
 * are read from the module so a test can never disagree with it about *where*
 * the boundary sits — their literal values are asserted once, separately, so a
 * wrong constant is still caught.
 *
 * Validates: Requirements 4.6, 14.9
 */

/**
 * An independent reading of Requirement 4.6, written from the criterion: fold
 * anything unusable to the default first, then clamp.
 */
function expectedInterval(configured: unknown): number {
  if (typeof configured !== 'number' || !Number.isFinite(configured)) {
    return POLL_INTERVAL_DEFAULT_SECONDS;
  }

  if (configured < POLL_INTERVAL_MIN_SECONDS) {
    return POLL_INTERVAL_MIN_SECONDS;
  }

  if (configured > POLL_INTERVAL_MAX_SECONDS) {
    return POLL_INTERVAL_MAX_SECONDS;
  }

  return configured;
}

/** Configured values inside `15..600`, boundaries and fractions included. */
const inRangeArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.double({
      min: POLL_INTERVAL_MIN_SECONDS,
      max: POLL_INTERVAL_MAX_SECONDS,
      noNaN: true,
      noDefaultInfinity: true,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.integer({
      min: POLL_INTERVAL_MIN_SECONDS,
      max: POLL_INTERVAL_MAX_SECONDS,
    }),
  },
  // The bounds and their inside neighbours, generated often enough that
  // shrinking is not what has to find them.
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      POLL_INTERVAL_MIN_SECONDS,
      POLL_INTERVAL_MIN_SECONDS + Number.EPSILON,
      15.000_001,
      16,
      22.5,
      POLL_INTERVAL_DEFAULT_SECONDS,
      599,
      599.999_999,
      POLL_INTERVAL_MAX_SECONDS,
    ),
  },
);

/** Finite numbers below the floor: negatives, zero, both signed zeroes. */
const belowFloorArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      0,
      -0,
      1,
      -1,
      14,
      14.999_999,
      POLL_INTERVAL_MIN_SECONDS - Number.EPSILON,
      Number.MIN_VALUE,
      -Number.MIN_VALUE,
      -POLL_INTERVAL_DEFAULT_SECONDS,
      -Number.MAX_SAFE_INTEGER,
      -Number.MAX_VALUE,
    ),
  },
  {
    weight: 2,
    arbitrary: fc.double({
      min: -100_000,
      max: POLL_INTERVAL_MIN_SECONDS,
      noNaN: true,
      noDefaultInfinity: true,
    }).filter((value) => value < POLL_INTERVAL_MIN_SECONDS),
  },
);

/** Finite numbers above the ceiling. */
const aboveCeilingArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      POLL_INTERVAL_MAX_SECONDS + Number.EPSILON,
      600.000_001,
      601,
      3600,
      86_400,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_VALUE,
    ),
  },
  {
    weight: 2,
    arbitrary: fc.double({
      min: POLL_INTERVAL_MAX_SECONDS,
      max: 1_000_000,
      noNaN: true,
      noDefaultInfinity: true,
    }).filter((value) => value > POLL_INTERVAL_MAX_SECONDS),
  },
);

/**
 * The three non-finite numbers Requirement 4.6 names alongside "not numeric".
 * `NaN` matters most: it compares false against both bounds, so a clamp that ran
 * before this fold would let it escape unclamped.
 */
const nonFiniteArb: fc.Arbitrary<number> = fc.constantFrom(
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
);

/**
 * Values that are not numbers at all: absent, null, strings (numeric strings
 * deliberately included — `'30'` is not a number), booleans, arrays, and
 * objects, including the interval-shaped wrappers a coercing clamp would
 * wrongly honour.
 */
const nonNumberArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      '',
      ' ',
      '15',
      '30',
      '60',
      '600',
      '601',
      '0',
      '-1',
      ' 30 ',
      '3e1',
      'sixty',
      'NaN',
      'Infinity',
      true,
      false,
      [],
      [30],
      [[30]],
      {},
      { pollIntervalSeconds: 30 },
      { seconds: 30 },
      { value: 30 },
    ),
  },
  { weight: 1, arbitrary: fc.string() },
  { weight: 1, arbitrary: fc.boolean() },
  { weight: 1, arbitrary: fc.array(inRangeArb) },
  { weight: 1, arbitrary: fc.record({ pollIntervalSeconds: inRangeArb }) },
  { weight: 1, arbitrary: fc.bigInt() },
  { weight: 1, arbitrary: fc.date() },
);

/** Anything at all — the totality generator (Requirement 14.9). */
const anyValueArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 3, arbitrary: inRangeArb },
  { weight: 2, arbitrary: belowFloorArb },
  { weight: 2, arbitrary: aboveCeilingArb },
  { weight: 2, arbitrary: nonFiniteArb },
  { weight: 3, arbitrary: nonNumberArb },
  { weight: 3, arbitrary: fc.anything() },
  { weight: 2, arbitrary: fc.double() },
);

describe('Property 16: the effective poll interval is always within 15 to 600 seconds', () => {
  it('yields a finite number within 15 to 600 inclusive for any input of any type', () => {
    fc.assert(
      fc.property(anyValueArb, (configured) => {
        const interval = effectivePollIntervalSeconds(configured);

        expect(typeof interval).toBe('number');
        expect(Number.isFinite(interval)).toBe(true);
        expect(interval).toBeGreaterThanOrEqual(POLL_INTERVAL_MIN_SECONDS);
        expect(interval).toBeLessThanOrEqual(POLL_INTERVAL_MAX_SECONDS);
      }),
      { numRuns: 1000 },
    );
  });

  it('agrees with the folding and clamping the acceptance criteria state', () => {
    fc.assert(
      fc.property(anyValueArb, (configured) => {
        expect(effectivePollIntervalSeconds(configured)).toBe(
          expectedInterval(configured),
        );
      }),
      { numRuns: 1000 },
    );
  });

  it('folds an absent or non-numeric value to the 60-second default', () => {
    fc.assert(
      fc.property(nonNumberArb, (configured) => {
        // No coercion: a numeric string, a one-element array, and an
        // interval-shaped object all fold to the default (Requirement 4.6).
        expect(effectivePollIntervalSeconds(configured)).toBe(
          POLL_INTERVAL_DEFAULT_SECONDS,
        );
      }),
      { numRuns: 500 },
    );

    expect(effectivePollIntervalSeconds(undefined)).toBe(POLL_INTERVAL_DEFAULT_SECONDS);
  });

  it('folds NaN, Infinity, and -Infinity to the 60-second default rather than clamping them', () => {
    fc.assert(
      fc.property(nonFiniteArb, (configured) => {
        expect(effectivePollIntervalSeconds(configured)).toBe(
          POLL_INTERVAL_DEFAULT_SECONDS,
        );
      }),
      { numRuns: 200 },
    );

    // Stated literally too: `NaN` escaping unclamped and `Infinity` arriving at
    // the ceiling are the two failures this fold exists to prevent.
    expect(effectivePollIntervalSeconds(Number.NaN)).toBe(
      POLL_INTERVAL_DEFAULT_SECONDS,
    );
    expect(effectivePollIntervalSeconds(Number.POSITIVE_INFINITY)).toBe(
      POLL_INTERVAL_DEFAULT_SECONDS,
    );
    expect(effectivePollIntervalSeconds(Number.NEGATIVE_INFINITY)).toBe(
      POLL_INTERVAL_DEFAULT_SECONDS,
    );
  });

  it('raises a value below 15 seconds to the 15-second floor', () => {
    fc.assert(
      fc.property(belowFloorArb, (configured) => {
        expect(effectivePollIntervalSeconds(configured)).toBe(POLL_INTERVAL_MIN_SECONDS);
      }),
      { numRuns: 500 },
    );
  });

  it('lowers a value above 600 seconds to the 600-second ceiling', () => {
    fc.assert(
      fc.property(aboveCeilingArb, (configured) => {
        expect(effectivePollIntervalSeconds(configured)).toBe(POLL_INTERVAL_MAX_SECONDS);
      }),
      { numRuns: 500 },
    );
  });

  it('uses a finite in-range value exactly as configured, unrounded', () => {
    fc.assert(
      fc.property(inRangeArb, (configured) => {
        // `-0` cannot reach here (it is below the floor), so a plain equality is
        // enough to say the value came through untouched (Requirement 4.6).
        expect(effectivePollIntervalSeconds(configured)).toBe(configured);
      }),
      { numRuns: 500 },
    );
  });

  it('holds the stated bounds: 15 and 600 in, 14.999999 and 600.000001 clamped', () => {
    // The constants themselves are the contract (Requirement 4.6), so they are
    // asserted literally here — the generated properties read them from the
    // module and so could not catch a wrong constant on their own.
    expect(POLL_INTERVAL_MIN_SECONDS).toBe(15);
    expect(POLL_INTERVAL_DEFAULT_SECONDS).toBe(60);
    expect(POLL_INTERVAL_MAX_SECONDS).toBe(600);

    expect(effectivePollIntervalSeconds(15)).toBe(15);
    expect(effectivePollIntervalSeconds(600)).toBe(600);
    expect(effectivePollIntervalSeconds(14.999_999)).toBe(15);
    expect(effectivePollIntervalSeconds(600.000_001)).toBe(600);
    expect(effectivePollIntervalSeconds(0)).toBe(15);
    expect(effectivePollIntervalSeconds(-0)).toBe(15);
  });

  it('never coerces a value, so a hostile valueOf or toString never runs', () => {
    fc.assert(
      fc.property(inRangeArb, (configured) => {
        let conversions = 0;
        const hostile = {
          valueOf() {
            conversions += 1;
            return configured;
          },
          toString() {
            conversions += 1;
            return String(configured);
          },
        };

        expect(effectivePollIntervalSeconds(hostile)).toBe(
          POLL_INTERVAL_DEFAULT_SECONDS,
        );
        expect(conversions).toBe(0);
      }),
      { numRuns: 300 },
    );
  });

  it('raises no exception for any input, exotic values included (totality)', () => {
    fc.assert(
      fc.property(anyValueArb, (configured) => {
        expect(() => effectivePollIntervalSeconds(configured)).not.toThrow();
      }),
      { numRuns: 1000 },
    );

    const selfReferencing: Record<string, unknown> = { pollIntervalSeconds: 30 };
    selfReferencing.self = selfReferencing;

    const throwingGetter = {
      get pollIntervalSeconds(): number {
        throw new Error('must never be read');
      },
    };

    const exotic: unknown[] = [
      Object.create(null),
      Object(30), // a boxed number: an object, so still the default
      Object('30'),
      Object(true),
      Symbol('30'),
      30n,
      () => 30,
      new Map([['pollIntervalSeconds', 30]]),
      new Set([30]),
      selfReferencing,
      throwingGetter,
    ];

    for (const configured of exotic) {
      expect(effectivePollIntervalSeconds(configured)).toBe(
        POLL_INTERVAL_DEFAULT_SECONDS,
      );
    }
  });

  it('is deterministic and idempotent: re-clamping an effective interval changes nothing', () => {
    fc.assert(
      fc.property(anyValueArb, (configured) => {
        const first = effectivePollIntervalSeconds(configured);

        expect(effectivePollIntervalSeconds(configured)).toBe(first);
        // The result is itself in range, so feeding it back is a no-op — which is
        // what makes the range invariant stable under repeated application.
        expect(effectivePollIntervalSeconds(first)).toBe(first);
      }),
      { numRuns: 500 },
    );
  });
});
