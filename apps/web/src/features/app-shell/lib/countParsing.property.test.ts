import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  MAX_COUNT_VALUE,
  MIN_COUNT_VALUE,
  parseNonNegativeInteger,
  type CountParse,
} from './countParsing';

/**
 * Property tests for the App_Shell's single non-negative integer parser
 * (Requirements 10.9, 10.12), placed beside the module they cover as
 * Requirement 14.2 asks, at well over the 100-iteration floor.
 *
 * These carry **Property 9: The count parser accepts exactly the non-negative
 * 32-bit integers** — the acceptance is an *exact* characterisation, so every
 * property below is written as an equivalence rather than as a one-way check. A
 * test that only fed valid counts could not tell this parser from one that
 * accepted everything.
 *
 * The bounds are read from the module's own exports, not retyped, so a test can
 * never disagree with the implementation about where the boundary sits — the
 * literal boundary values are asserted once, separately, so a wrong constant is
 * still caught.
 */

/**
 * The independent oracle for acceptance: an integer from 0 to 2,147,483,647
 * inclusive, and nothing else (Requirement 10.9). Written from the requirement
 * rather than by reusing the implementation's guards, so the two can disagree.
 */
function shouldParse(body: unknown): boolean {
  return (
    typeof body === 'number' &&
    Number.isInteger(body) &&
    body >= 0 &&
    body <= 2_147_483_647
  );
}

/** Every accepted count: the whole 0..2,147,483,647 range, boundaries included. */
const inRangeCountArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.integer({ min: MIN_COUNT_VALUE, max: MAX_COUNT_VALUE }),
  },
  // The boundaries and their neighbours inside the range, generated often
  // enough that shrinking is not what has to find them.
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      0,
      -0,
      1,
      2,
      9,
      10,
      99,
      100,
      MAX_COUNT_VALUE - 1,
      MAX_COUNT_VALUE,
    ),
  },
);

/** Integers just outside the range on either side, plus far-out ones. */
const outOfRangeIntegerArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      -1,
      -2,
      MAX_COUNT_VALUE + 1, // 2,147,483,648 — one past the 32-bit ceiling
      MAX_COUNT_VALUE + 2,
      -MAX_COUNT_VALUE,
      Number.MAX_SAFE_INTEGER,
      -Number.MAX_SAFE_INTEGER,
    ),
  },
  { weight: 1, arbitrary: fc.integer({ min: -2_000_000_000, max: -1 }) },
  {
    weight: 1,
    arbitrary: fc.integer({ min: MAX_COUNT_VALUE + 1, max: 4_000_000_000 }),
  },
);

/** Numbers that are not integers: fractional values, NaN, and both infinities. */
const nonIntegerNumberArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      0.5,
      -0.5,
      1.1,
      0.1,
      Number.EPSILON,
      MAX_COUNT_VALUE + 0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MIN_VALUE,
    ),
  },
  {
    weight: 2,
    arbitrary: fc
      .double({ min: 0, max: MAX_COUNT_VALUE, noNaN: true, noDefaultInfinity: true })
      .filter((value) => !Number.isInteger(value)),
  },
);

/**
 * Non-number values of every rejected type: absent, null, strings (numeric
 * strings deliberately included — `'7'` is not a number), booleans, arrays, and
 * objects, including a count-shaped object and a one-element array holding a
 * valid count, which are the shapes a coercing parser would wrongly accept.
 */
const nonNumberArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      '0',
      '1',
      '7',
      '2147483647',
      '2147483648',
      '-1',
      ' 3 ',
      '',
      '1e2',
      'seven',
      true,
      false,
      [],
      [0],
      [7],
      [[7]],
      {},
      { count: 7 },
      { unreadCount: 0 },
      { value: 7 },
    ),
  },
  { weight: 1, arbitrary: fc.string() },
  { weight: 1, arbitrary: fc.boolean() },
  { weight: 1, arbitrary: fc.array(inRangeCountArb) },
  { weight: 1, arbitrary: fc.record({ count: inRangeCountArb }) },
  { weight: 1, arbitrary: fc.bigInt() },
  { weight: 1, arbitrary: fc.date() },
);

/** Anything at all — the totality generator (Requirements 10.12, 14.12). */
const anyValueArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 3, arbitrary: inRangeCountArb },
  { weight: 2, arbitrary: outOfRangeIntegerArb },
  { weight: 2, arbitrary: nonIntegerNumberArb },
  { weight: 3, arbitrary: nonNumberArb },
  { weight: 4, arbitrary: fc.anything() },
);

/** Wraps `leaf` in `depth` levels of arrays and objects, alternating. */
function nest(leaf: unknown, depth: number): unknown {
  let value: unknown = leaf;

  for (let level = 0; level < depth; level += 1) {
    value = level % 2 === 0 ? [value] : { nested: value };
  }

  return value;
}

/** Every outcome is one of the two the union declares, and nothing else. */
function expectWellFormedOutcome(outcome: CountParse): void {
  if (outcome.kind === 'parsed') {
    expect(typeof outcome.value).toBe('number');
  } else {
    expect(outcome.kind).toBe('parse-failure');
    expect(outcome).not.toHaveProperty('value');
  }
}

// Feature: app-shell, Property 9: the count parser accepts exactly the
// non-negative 32-bit integers
// Validates: Requirements 10.9, 10.12, 14.12
describe('parseNonNegativeInteger — acceptance is exactly the 0..2,147,483,647 integers', () => {
  it('parses a value exactly when it is an integer in range, and echoes it unchanged', () => {
    fc.assert(
      fc.property(anyValueArb, (body) => {
        const outcome = parseNonNegativeInteger(body);

        expectWellFormedOutcome(outcome);

        // The equivalence: parsed exactly when the oracle says in range
        // (Requirement 10.9). Both directions, from one generator covering both.
        expect(outcome.kind === 'parsed').toBe(shouldParse(body));

        if (outcome.kind === 'parsed') {
          // An accepted count is carried through untouched — never clamped,
          // rounded, or re-derived — and `-0` is normalised to `0` so a caller
          // formatting it can never render `-0` (`-0 === 0`, so the equality
          // below still holds for it).
          expect(outcome.value === (body as number)).toBe(true);
          expect(Object.is(outcome.value, -0)).toBe(false);
          expect(Number.isInteger(outcome.value)).toBe(true);
          expect(outcome.value).toBeGreaterThanOrEqual(MIN_COUNT_VALUE);
          expect(outcome.value).toBeLessThanOrEqual(MAX_COUNT_VALUE);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('parses every integer in range', () => {
    fc.assert(
      fc.property(inRangeCountArb, (count) => {
        const outcome = parseNonNegativeInteger(count);

        expect(outcome.kind).toBe('parsed');
        expect(outcome).toStrictEqual({
          kind: 'parsed',
          value: Object.is(count, -0) ? 0 : count,
        });
      }),
      { numRuns: 500 },
    );
  });

  it('holds the stated boundaries: 0 and 2147483647 in, -1 and 2147483648 out', () => {
    // The constants themselves are the contract (Requirement 10.9), so they are
    // asserted literally here — the generated properties read them from the
    // module and so could not catch a wrong constant on their own.
    expect(MIN_COUNT_VALUE).toBe(0);
    expect(MAX_COUNT_VALUE).toBe(2_147_483_647);

    expect(parseNonNegativeInteger(0)).toStrictEqual({ kind: 'parsed', value: 0 });
    expect(parseNonNegativeInteger(1)).toStrictEqual({ kind: 'parsed', value: 1 });
    expect(parseNonNegativeInteger(2_147_483_646)).toStrictEqual({
      kind: 'parsed',
      value: 2_147_483_646,
    });
    expect(parseNonNegativeInteger(2_147_483_647)).toStrictEqual({
      kind: 'parsed',
      value: 2_147_483_647,
    });

    expect(parseNonNegativeInteger(2_147_483_648).kind).toBe('parse-failure');
    expect(parseNonNegativeInteger(-1).kind).toBe('parse-failure');
  });
});

// Feature: app-shell, Property 9: every other value is a parse-failure
// Validates: Requirements 10.9, 10.12
describe('parseNonNegativeInteger — every other value is a parse-failure', () => {
  it('rejects an out-of-range integer rather than clamping it', () => {
    fc.assert(
      fc.property(outOfRangeIntegerArb, (value) => {
        // Rejected, not clamped: no `0` for `-1` and no ceiling for an
        // overflowing count (Requirement 10.9).
        expect(parseNonNegativeInteger(value)).toStrictEqual({ kind: 'parse-failure' });
      }),
      { numRuns: 300 },
    );
  });

  it('rejects a number that is not an integer, NaN and the infinities included', () => {
    fc.assert(
      fc.property(nonIntegerNumberArb, (value) => {
        expect(parseNonNegativeInteger(value)).toStrictEqual({ kind: 'parse-failure' });
      }),
      { numRuns: 300 },
    );
  });

  it('rejects every non-number: absent, null, string, boolean, array, object', () => {
    fc.assert(
      fc.property(nonNumberArb, (value) => {
        expect(parseNonNegativeInteger(value)).toStrictEqual({ kind: 'parse-failure' });
      }),
      { numRuns: 300 },
    );
  });

  it('rejects a numeric string and a count-shaped wrapper, performing no coercion', () => {
    fc.assert(
      fc.property(inRangeCountArb, (count) => {
        // `'7'` is not a number, and neither is `{ count: 7 }` nor `[7]`
        // (Requirement 10.9) — a parser that coerced would accept all three.
        expect(parseNonNegativeInteger(String(count)).kind).toBe('parse-failure');
        expect(parseNonNegativeInteger({ count }).kind).toBe('parse-failure');
        expect(parseNonNegativeInteger([count]).kind).toBe('parse-failure');
      }),
      { numRuns: 200 },
    );
  });

  it('never converts a value, so a hostile toString or valueOf never runs', () => {
    fc.assert(
      fc.property(inRangeCountArb, (count) => {
        let conversions = 0;
        const hostile = {
          valueOf() {
            conversions += 1;
            return count;
          },
          toString() {
            conversions += 1;
            return String(count);
          },
        };

        expect(parseNonNegativeInteger(hostile)).toStrictEqual({ kind: 'parse-failure' });
        expect(conversions).toBe(0);
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: app-shell, Property 9: the parser is total
// Validates: Requirements 10.12, 14.12
describe('parseNonNegativeInteger — the parser is total', () => {
  it('yields one defined outcome and raises no exception for any input of any type', () => {
    fc.assert(
      fc.property(anyValueArb, (body) => {
        const outcome = parseNonNegativeInteger(body);

        expect(outcome).toBeDefined();
        expect(['parsed', 'parse-failure']).toContain(outcome.kind);
        expectWellFormedOutcome(outcome);
      }),
      { numRuns: 1000 },
    );
  });

  it('yields the parse-failure outcome for a value nested to 100 levels', () => {
    const leafArb = fc.oneof(
      inRangeCountArb,
      outOfRangeIntegerArb,
      nonIntegerNumberArb,
      nonNumberArb,
    );

    fc.assert(
      fc.property(leafArb, fc.integer({ min: 1, max: 100 }), (leaf, depth) => {
        // A nested value is never a number at the top level, so it is always a
        // parse-failure — and the parser does not walk into it, so 100 levels
        // cost nothing and overflow nothing (Requirement 10.12).
        expect(parseNonNegativeInteger(nest(leaf, depth))).toStrictEqual({
          kind: 'parse-failure',
        });
      }),
      { numRuns: 300 },
    );
  });

  it('survives values with no prototype, exotic wrappers, and self-referencing structures', () => {
    const selfReferencing: Record<string, unknown> = { count: 7 };
    selfReferencing.self = selfReferencing;

    const cyclicArray: unknown[] = [1];
    cyclicArray.push(cyclicArray);

    const throwingGetter = {
      get count(): number {
        throw new Error('must never be read');
      },
    };

    const exotic: unknown[] = [
      Object.create(null),
      Object(7), // a boxed number: an object, so still a parse-failure
      Object('7'),
      Object(true),
      Symbol('7'),
      7n,
      () => 7,
      new Map([['count', 7]]),
      new Set([7]),
      selfReferencing,
      cyclicArray,
      throwingGetter,
      nest(7, 100),
    ];

    for (const value of exotic) {
      expect(parseNonNegativeInteger(value)).toStrictEqual({ kind: 'parse-failure' });
    }
  });

  it('is deterministic and free of side effects across repeated calls', () => {
    fc.assert(
      fc.property(anyValueArb, (body) => {
        const first = parseNonNegativeInteger(body);
        const second = parseNonNegativeInteger(body);

        expect(second).toStrictEqual(first);
      }),
      { numRuns: 300 },
    );
  });
});
