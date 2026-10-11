// Feature: web-player-stats-screen, Property 13: Counts, percentages, and durations reject what the backend cannot send
// Validates: Requirements 13.10

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  MAX_DURATION_MS,
  readDurationMs as readTransmittedDuration,
} from '../duration';
import {
  readCount,
  readDurationMs,
  readPercentage,
  type ParseResult,
  type ValueReader,
} from './primitives';

/**
 * Property 13 for the three **narrowed** numeric readers of
 * `lib/parse/primitives.ts`: `readCount`, `readPercentage`, and the
 * `readDurationMs` seam it re-exports from `lib/duration.ts`.
 *
 * Property 5 (`primitives.property.test.ts`) already says every reader settles,
 * preserves, and discloses nothing, over every input of every type. What it
 * deliberately does *not* say is **which** values each of these three accepts —
 * that is this file's subject, and it is the half that matters for
 * Requirement 13.10: a reader that accepted `2.5` appearances would render a
 * confident `3`, one that clamped `100.1` would render a perfect record for a
 * membership that has lost matches, and one that took `'-00:45:00'` for its
 * magnitude would present time in goal that nobody spent. Each of those is a
 * backend fault presented as a figure a person would believe, which is strictly
 * worse than failing the body.
 *
 * Three things about how this is written matter more than the run counts.
 *
 * **Each acceptance is an equivalence against an independently written oracle.**
 * The three oracles below are written from the *stated rule* rather than from
 * the implementation: the count oracle tests wholeness with `value % 1 === 0`
 * and finiteness with `value - value === 0` rather than calling
 * `Number.isInteger` and `Number.isFinite`, and the duration oracle walks the
 * accepted form with a digit-run scanner rather than re-applying the module's
 * anchored pattern. A test that re-used the module's own predicates would agree
 * with any predicate at all, including one that had quietly become
 * `Number.isSafeInteger` or had lost an anchor. Because the oracle decides,
 * a generated near-miss that happens to be valid is no problem — the two
 * implementations are compared, never a hard-coded expectation.
 *
 * **The count rule is asserted as stated, not narrower.** `readCount` tests
 * wholeness with `Number.isInteger`, *not* `Number.isSafeInteger`, because the
 * stated rule is "non-negative whole number" and a count beyond the exactly
 * representable range is still the whole number it says it is. `2 ** 53`, `1e21`
 * and `Number.MAX_VALUE` are therefore asserted **accepted** rather than
 * rejected: the distinction is theoretical for a row count over a squad's
 * matches, but a test that demanded the narrower rule would push the reader off
 * the requirement it implements. The duration reader is the deliberate contrast
 * — it bounds its *assembled* total at {@link MAX_DURATION_MS}, because a
 * reassembled millisecond count beyond that has stopped being exact.
 *
 * **Non-repair is asserted as input preservation**, under `Object.is`, so a
 * rounded count, a clamped percentage, or a `-0` silently normalised to `0`
 * would fail here rather than pass as "near enough".
 *
 * Totality is restated for these three readers rather than borrowed, since an
 * accepted/rejected equivalence is only meaningful if neither outcome can also
 * be a raise: every reading in this file goes through {@link settle}.
 *
 * React-free and DOM-free, like every module under `lib/`.
 *
 * **Validates: Requirements 13.10**
 */

/* -------------------------------------------------------------------------- */
/* The units and the labels                                                   */
/* -------------------------------------------------------------------------- */

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Ticks (100 ns) per millisecond: the wire fraction's scale. */
const TICKS_PER_MS = 10_000;

/** The label every reading is taken under; carries no digit of its own. */
const LABEL = 'field';

/** ASCII digits, the only digits the accepted forms admit. */
const DIGITS = '0123456789';

/* -------------------------------------------------------------------------- */
/* The totality harness                                                       */
/* -------------------------------------------------------------------------- */

/** A value's own keys, sorted, as a comparable string. */
function keySignature(value: object): string {
  return Object.keys(value).sort().join(',');
}

/**
 * Settles one reading and asserts the frame around it: no exception, and exactly
 * one of the two result shapes carrying exactly its own fields. Returns the
 * settled result so a caller can go on to assert *which* outcome was required.
 */
function settle(read: () => ParseResult<number>): ParseResult<number> {
  let outcome: ParseResult<number>;

  try {
    outcome = read();
  } catch (raised) {
    // 13.1: a reader raises nothing, for any input at all.
    throw new Error(`the reader raised instead of failing: ${String(raised)}`, {
      cause: raised,
    });
  }

  expect(typeof outcome).toBe('object');
  expect(outcome).not.toBeNull();

  if (outcome.ok) {
    expect(keySignature(outcome)).toBe('ok,value');
    expect(typeof outcome.value).toBe('number');
  } else {
    expect(keySignature(outcome)).toBe('ok,reason');
    expect(typeof outcome.reason).toBe('string');
    expect(outcome.reason.length).toBeGreaterThan(0);
  }

  return outcome;
}

/**
 * A value as assertion-message text, safely.
 *
 * A generated value can be one that cannot be converted at all — a
 * null-prototype object has no `toString` — so a message slot must not be the
 * one place in the file that raises. Every converting call goes through here.
 */
function describeValue(value: unknown): string {
  try {
    return `${typeof value}: ${String(value)}`;
  } catch {
    return `${typeof value}: a value that cannot be converted`;
  }
}

const readACount = (value: unknown): ParseResult<number> =>
  settle(() => readCount(value, LABEL));

const readAPercentage = (value: unknown): ParseResult<number> =>
  settle(() => readPercentage(value, LABEL));

const readADuration = (value: unknown): ParseResult<number> =>
  settle(() => readDurationMs(value, LABEL));

/* -------------------------------------------------------------------------- */
/* The oracles                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Whether a value is a number at all and a finite one, decided without
 * `Number.isFinite`: `NaN - NaN` and `Infinity - Infinity` are both `NaN`, so
 * only a finite number subtracts from itself to zero.
 */
function isFiniteNumberValue(value: unknown): value is number {
  return typeof value === 'number' && value - value === 0;
}

/**
 * The count a value names, or `null` if it names none.
 *
 * The stated rule, written from the requirement: a finite number, whole, not
 * negative. Wholeness is `value % 1 === 0` — true of `2 ** 53` and of `1e21`
 * alike, which is exactly the breadth `Number.isInteger` has and
 * `Number.isSafeInteger` does not. `-0 >= 0` holds, so negative zero is the zero
 * it is.
 */
function oracleCount(value: unknown): number | null {
  if (!isFiniteNumberValue(value)) return null;
  if (value % 1 !== 0) return null;
  if (!(value >= 0)) return null;

  return value;
}

/**
 * The percentage a value names, or `null` if it names none: a finite number in
 * the **closed** range 0 to 100, endpoints included.
 */
function oraclePercentage(value: unknown): number | null {
  if (!isFiniteNumberValue(value)) return null;
  if (!(value >= 0) || !(value <= 100)) return null;

  return value;
}

/**
 * The milliseconds a value names as a transmitted duration, or `null` if it
 * names none.
 *
 * An independent reading of `[d.]hh:mm:ss[.fffffff]` by scanning digit runs and
 * literal separators left to right, rather than by re-applying the module's
 * anchored pattern. The sign is refused at the first character, each clock field
 * must be a run of exactly two ASCII digits, the fraction one to seven, and the
 * whole string must be consumed.
 *
 * The arithmetic deliberately mirrors the module's order of operations: a day
 * field of a hundred digits assembles to a value whose side of
 * {@link MAX_DURATION_MS} a different grouping could disagree about.
 */
function oracleDurationMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  if (value.startsWith('-')) return null;

  let at = 0;

  const digitRun = (): string => {
    const start = at;

    while (at < value.length && DIGITS.includes(value.charAt(at))) {
      at += 1;
    }

    return value.slice(start, at);
  };

  const literal = (character: string): boolean => {
    if (value.charAt(at) !== character) return false;

    at += 1;
    return true;
  };

  // The leading run is the day field when a '.' follows it, and the hour field
  // otherwise — the one ambiguity of the form, resolved by the next character.
  const leading = digitRun();
  if (leading.length === 0) return null;

  let dayText: string | null = null;
  let hourText = leading;

  if (literal('.')) {
    dayText = leading;
    hourText = digitRun();
  }

  if (hourText.length !== 2) return null;
  if (!literal(':')) return null;

  const minuteText = digitRun();
  if (minuteText.length !== 2) return null;
  if (!literal(':')) return null;

  const secondText = digitRun();
  if (secondText.length !== 2) return null;

  let fractionText: string | null = null;

  if (literal('.')) {
    fractionText = digitRun();

    if (fractionText.length === 0 || fractionText.length > 7) return null;
  }

  if (at !== value.length) return null;

  const days = dayText === null ? 0 : Number(dayText);
  const hours = Number(hourText);
  const minutes = Number(minuteText);
  const seconds = Number(secondText);

  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  // The wire fraction counts ticks; the sub-millisecond remainder truncates.
  const milliseconds =
    fractionText === null
      ? 0
      : Math.floor(Number(fractionText.padEnd(7, '0')) / TICKS_PER_MS);

  const totalMs =
    days * MS_PER_DAY +
    hours * MS_PER_HOUR +
    minutes * MS_PER_MINUTE +
    seconds * MS_PER_SECOND +
    milliseconds;

  if (!Number.isSafeInteger(totalMs) || totalMs > MAX_DURATION_MS) return null;

  return totalMs;
}

/* -------------------------------------------------------------------------- */
/* Numeric generators                                                         */
/* -------------------------------------------------------------------------- */

/** Whole numbers beyond the exactly representable range: accepted counts all. */
const UNSAFE_WHOLE_NUMBERS: readonly number[] = [
  Number.MAX_SAFE_INTEGER + 1,
  2 ** 53,
  2 ** 53 + 2,
  2 ** 60,
  1e21,
  1e308,
  Number.MAX_VALUE,
];

/** Non-negative whole numbers: the accepted set of `readCount`. */
const wholeCountArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom(
      0,
      -0,
      1,
      2,
      7,
      12,
      100,
      1_000,
      Number.MAX_SAFE_INTEGER,
      ...UNSAFE_WHOLE_NUMBERS,
    ),
  },
  { weight: 5, arbitrary: fc.nat() },
  { weight: 3, arbitrary: fc.integer({ min: 0, max: 60 }) },
  { weight: 2, arbitrary: fc.maxSafeNat() },
);

/** Numbers no count may be: a fraction, a negative, or a negative fraction. */
const nonCountNumberArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom(
      2.5,
      0.5,
      -0.5,
      -0.1,
      1.000_000_000_000_1,
      0.1 + 0.2,
      Number.MIN_VALUE,
      Number.EPSILON,
      -1,
      -12,
      -Number.MAX_SAFE_INTEGER,
      -Number.MAX_VALUE,
      -1e21,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ),
  },
  {
    weight: 4,
    arbitrary: fc.double({ noNaN: true, noDefaultInfinity: true }).filter(
      // A fraction or a negative, never an acceptable count.
      (value) => value % 1 !== 0 || value < 0,
    ),
  },
  { weight: 3, arbitrary: fc.integer({ min: -1_000_000, max: -1 }) },
  {
    weight: 3,
    arbitrary: fc
      .tuple(fc.nat({ max: 10_000 }), fc.integer({ min: 1, max: 999 }))
      .map(([whole, thousandths]) => whole + thousandths / 1000)
      .filter((value) => value % 1 !== 0),
  },
);

/** Finite numbers in the closed range 0 to 100: the accepted set of the reader. */
const percentageArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom(
      0,
      -0,
      100,
      50,
      33.333,
      66.667,
      99.9,
      99.95,
      0.1,
      0.000_001,
      Number.MIN_VALUE,
      Number.EPSILON,
      1 / 3,
      100 - Number.EPSILON * 100,
    ),
  },
  { weight: 5, arbitrary: fc.double({ min: 0, max: 100, noNaN: true }) },
  {
    weight: 3,
    arbitrary: fc
      .integer({ min: 0, max: 1_000 })
      .map((tenths) => tenths / 10),
  },
  { weight: 2, arbitrary: fc.integer({ min: 0, max: 100 }) },
);

/** The nearest double above the range's ceiling, and below its floor. */
const JUST_ABOVE_100 = 100 * (1 + Number.EPSILON);
const JUST_BELOW_0 = -Number.MIN_VALUE;

/** Numbers outside the closed percentage range, or no percentage at all. */
const nonPercentageNumberArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom(
      -0.1,
      100.1,
      JUST_ABOVE_100,
      JUST_BELOW_0,
      100.000_000_1,
      -1,
      -100,
      101,
      1_000,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ),
  },
  {
    weight: 4,
    arbitrary: fc.double({ min: 100.000_001, max: 1e18, noNaN: true }),
  },
  {
    weight: 4,
    arbitrary: fc.double({ min: -1e18, max: -0.000_001, noNaN: true }),
  },
  { weight: 2, arbitrary: fc.integer({ min: 101, max: 1_000_000 }) },
);

/** The decimal text of a number: the string-encoded figure of 13.5. */
const stringEncodedArb: fc.Arbitrary<string> = fc
  .oneof(wholeCountArb, percentageArb, nonCountNumberArb)
  .map((value) => String(value));

/* -------------------------------------------------------------------------- */
/* Duration generators                                                        */
/* -------------------------------------------------------------------------- */

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** One to seven digits: every fraction width the wire form admits. */
const fractionDigitsArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...DIGITS.split('')), { minLength: 1, maxLength: 7 })
  .map((digits) => digits.join(''));

/** An accepted spelling of a duration, day field and fraction both optional. */
const wireDurationArb: fc.Arbitrary<string> = fc
  .record({
    dayText: fc.oneof(
      { weight: 3, arbitrary: fc.constant(null) },
      {
        weight: 4,
        arbitrary: fc.integer({ min: 0, max: 400 }).map((days) => String(days)),
      },
      {
        weight: 2,
        arbitrary: fc
          .integer({ min: 0, max: 99 })
          .map((days) => `000${String(days)}`),
      },
    ),
    hours: fc.integer({ min: 0, max: 23 }),
    minutes: fc.integer({ min: 0, max: 59 }),
    seconds: fc.integer({ min: 0, max: 59 }),
    fractionText: fc.oneof(
      { weight: 3, arbitrary: fc.constant(null) },
      { weight: 5, arbitrary: fractionDigitsArb },
    ),
  })
  .map(
    ({ dayText, hours, minutes, seconds, fractionText }) =>
      `${dayText === null ? '' : `${dayText}.`}${pad2(hours)}:${pad2(minutes)}:${pad2(
        seconds,
      )}${fractionText === null ? '' : `.${fractionText}`}`,
  );

/**
 * String shapes no serialiser of this contract emits: the negative form, a
 * single-digit or over-long hour, a missing field, an over-long fraction,
 * whitespace padding, an ISO-8601 duration, the presentation form, a plain
 * millisecond count as text, and the out-of-range clock fields the constant
 * form carries as a day instead.
 */
const MALFORMED_DURATIONS: readonly string[] = [
  '',
  ' ',
  '45',
  '45m',
  '0m',
  '1h 05m',
  '2700000',
  '0:45:00',
  '000:45:00',
  '00:45',
  '00:45:',
  ':45:00',
  '00::00',
  '00:45:00.',
  '.00:45:00',
  '1.2.00:45:00',
  '0.0.00:45:00',
  '00.45:00',
  '00:45:00.00000000',
  ' 00:45:00',
  '00:45:00 ',
  '00:45:00\n',
  '00:45:00Z',
  '+00:45:00',
  '-00:45:00',
  '-00:00:00',
  '-0.00:45:00.0000000',
  'PT45M',
  '00-45-00',
  '1:00:45:00',
  '25:00:00',
  '24:00:00',
  '00:60:00',
  '00:00:60',
  '99:99:99',
  '0.24:00:00',
  '١٢:٤٥:٠٠',
  '00:45:00.123456７',
  'NaN',
  'Infinity',
  'null',
  'undefined',
  '99999999999999999999999999999999.00:00:00',
];

/** A single-character edit of an accepted spelling: the nearest plausible miss. */
const mutatedDurationArb: fc.Arbitrary<string> = wireDurationArb.chain((text) =>
  fc
    .tuple(
      fc.nat({ max: Math.max(text.length - 1, 0) }),
      fc.constantFrom<'drop' | 'double' | 'space' | 'dot' | 'digit' | 'colon'>(
        'drop',
        'double',
        'space',
        'dot',
        'digit',
        'colon',
      ),
    )
    .map(([index, edit]) => {
      const head = text.slice(0, index);
      const character = text.charAt(index);
      const tail = text.slice(index + 1);

      switch (edit) {
        case 'drop':
          return `${head}${tail}`;
        case 'double':
          return `${head}${character}${character}${tail}`;
        case 'space':
          return `${head} ${character}${tail}`;
        case 'dot':
          return `${head}.${character}${tail}`;
        case 'digit':
          return `${head}7${character}${tail}`;
        case 'colon':
          return `${head}:${character}${tail}`;
      }
    }),
);

/** Any string at all, weighted so acceptance and rejection both occur densely. */
const anyDurationTextArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: wireDurationArb },
  { weight: 5, arbitrary: mutatedDurationArb },
  { weight: 5, arbitrary: fc.constantFrom(...MALFORMED_DURATIONS) },
  { weight: 2, arbitrary: stringEncodedArb },
  { weight: 2, arbitrary: fc.string({ maxLength: 24 }) },
);

/* -------------------------------------------------------------------------- */
/* The whole input space                                                      */
/* -------------------------------------------------------------------------- */

/** Values of every type other than number and string, plus the two absences. */
const otherTypedValueArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      true,
      false,
      [],
      [0],
      [12],
      ['12'],
      ['00:45:00'],
      {},
      { value: 12 },
      { valueOf: () => 12 },
      Object(12),
      Object(0),
      Object('00:45:00'),
      Object.create(null),
      new Date(0),
      new Map<unknown, unknown>([['value', 12]]),
      new Set<unknown>([12]),
      12n,
      0n,
      Symbol('12'),
      () => 12,
      /12/,
      Number.NaN,
    ),
  },
  { weight: 2, arbitrary: fc.bigInt() },
  { weight: 2, arbitrary: fc.boolean() },
  {
    weight: 3,
    arbitrary: fc
      .anything({ maxDepth: 2, withBigInt: true, withMap: true, withSet: true })
      .filter((value) => typeof value !== 'number' && typeof value !== 'string'),
  },
);

/** Anything at all: the true domain of each of the three readers. */
const anyValueArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 4, arbitrary: wholeCountArb },
  { weight: 4, arbitrary: nonCountNumberArb },
  { weight: 4, arbitrary: percentageArb },
  { weight: 4, arbitrary: nonPercentageNumberArb },
  { weight: 5, arbitrary: anyDurationTextArb },
  { weight: 2, arbitrary: stringEncodedArb },
  { weight: 5, arbitrary: otherTypedValueArb },
  { weight: 2, arbitrary: fc.double() },
  { weight: 2, arbitrary: fc.integer() },
);

/* -------------------------------------------------------------------------- */
/* readCount                                                                  */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 13: Counts, percentages, and durations reject what the backend cannot send
// Validates: Requirements 13.10
describe('readCount accepts exactly the non-negative whole numbers', () => {
  it('agrees with the oracle, for any value at all', () => {
    fc.assert(
      fc.property(anyValueArb, (value) => {
        // The equivalence: accepted exactly when the independently written
        // oracle accepts, and with exactly the number it names.
        const expected = oracleCount(value);
        const outcome = readACount(value);

        expect(outcome.ok, describeValue(value)).toBe(expected !== null);

        if (outcome.ok) {
          expect(Object.is(outcome.value, expected)).toBe(true);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('accepts every non-negative whole number, returning it unchanged', () => {
    fc.assert(
      fc.property(wholeCountArb, (value) => {
        const outcome = readACount(value);

        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;

        // `Object.is`, so a `-0` normalised to `0` would be caught here too:
        // 13.2 forbids repair of any kind, including the invisible kind.
        expect(Object.is(outcome.value, value)).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it('rejects a fraction or a negative rather than rounding or clamping it', () => {
    fc.assert(
      fc.property(nonCountNumberArb, (value) => {
        // `2.5` appearances rounded to `3`, or `-1` clamped to `0`, would each
        // present a backend fault as a figure a person would believe.
        expect(readACount(value).ok, String(value)).toBe(false);
        expect(oracleCount(value)).toBeNull();
      }),
      { numRuns: 1000 },
    );
  });

  it('accepts a whole number beyond the exactly representable range', () => {
    // The stated rule is "non-negative whole number", tested with
    // `Number.isInteger` and deliberately **not** `Number.isSafeInteger`: a
    // count past 2^53 is still the whole number it says it is. Asserted so that
    // narrowing the reader to the safe range would fail here rather than pass as
    // a tightening.
    for (const value of UNSAFE_WHOLE_NUMBERS) {
      const outcome = readACount(value);

      expect(outcome.ok, String(value)).toBe(true);
      if (!outcome.ok) continue;

      expect(outcome.value, String(value)).toBe(value);
      expect(Number.isSafeInteger(value)).toBe(false);
    }
  });

  it('accepts both zeros, the Never_Played reading', () => {
    // A membership with no appearances is the case the screen states in words,
    // not a parse failure.
    for (const zero of [0, -0]) {
      const outcome = readACount(zero);

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) continue;

      expect(Object.is(outcome.value, zero)).toBe(true);
    }
  });

  it('rejects NaN and both infinities, which no JSON body can carry', () => {
    for (const value of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(readACount(value).ok, String(value)).toBe(false);
    }
  });

  it('rejects a string-encoded count, whatever number it names', () => {
    fc.assert(
      fc.property(stringEncodedArb, (text) => {
        // 13.5: `'12'` is not how this backend serialises a number, and
        // accepting it would let a mistyped field parse.
        expect(readACount(text).ok, text).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('rejects every value that is not a number', () => {
    fc.assert(
      fc.property(otherTypedValueArb, (value) => {
        // A boxed `12`, a one-element array holding one, and an object with a
        // `valueOf` are each rejected on type, never unwrapped.
        expect(readACount(value).ok).toBe(false);
      }),
      { numRuns: 500 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* readPercentage                                                             */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 13: Counts, percentages, and durations reject what the backend cannot send
// Validates: Requirements 13.10
describe('readPercentage accepts exactly the finite numbers from 0 to 100', () => {
  it('agrees with the oracle, for any value at all', () => {
    fc.assert(
      fc.property(anyValueArb, (value) => {
        const expected = oraclePercentage(value);
        const outcome = readAPercentage(value);

        expect(outcome.ok, describeValue(value)).toBe(expected !== null);

        if (outcome.ok) {
          expect(Object.is(outcome.value, expected)).toBe(true);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('accepts every finite number in range, returning it unchanged', () => {
    fc.assert(
      fc.property(percentageArb, (value) => {
        const outcome = readAPercentage(value);

        expect(outcome.ok, String(value)).toBe(true);
        if (!outcome.ok) return;

        // A fractional percentage is expected, not merely tolerated: a 1-in-3
        // record is 33.333…, and rounding it here rather than at presentation
        // would lose the decimal place the screen shows.
        expect(Object.is(outcome.value, value)).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it('accepts both endpoints of the closed range, and negative zero', () => {
    // Both endpoints are readings a real record produces — a membership that has
    // won every match and one that has won none.
    for (const value of [0, -0, 100]) {
      const outcome = readAPercentage(value);

      expect(outcome.ok, String(value)).toBe(true);
      if (!outcome.ok) continue;

      expect(Object.is(outcome.value, value)).toBe(true);
    }
  });

  it('rejects a value outside the range rather than clamping it', () => {
    fc.assert(
      fc.property(nonPercentageNumberArb, (value) => {
        // Clamping `100.1` to `100` would render a perfect record for a
        // membership that has lost matches.
        expect(readAPercentage(value).ok, String(value)).toBe(false);
        expect(oraclePercentage(value)).toBeNull();
      }),
      { numRuns: 1000 },
    );
  });

  it('rejects the nearest value beyond each endpoint', () => {
    // The range is closed, so rejection begins at the very next double: the
    // boundary is asserted from both sides rather than at a round number.
    expect(readAPercentage(JUST_ABOVE_100).ok).toBe(false);
    expect(readAPercentage(JUST_BELOW_0).ok).toBe(false);
    expect(readAPercentage(-0.1).ok).toBe(false);
    expect(readAPercentage(100.1).ok).toBe(false);
    expect(readAPercentage(100).ok).toBe(true);
    expect(readAPercentage(0).ok).toBe(true);
  });

  it('rejects NaN and both infinities', () => {
    for (const value of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(readAPercentage(value).ok, String(value)).toBe(false);
    }
  });

  it('rejects a string-encoded percentage, and every non-number', () => {
    fc.assert(
      fc.property(fc.oneof(stringEncodedArb, otherTypedValueArb), (value) => {
        expect(readAPercentage(value).ok).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('accepts a whole-number count only while it is also in range', () => {
    fc.assert(
      fc.property(wholeCountArb, (value) => {
        // The two narrowed readers are not interchangeable: every count is a
        // number, but a count above 100 is no percentage.
        expect(readAPercentage(value).ok).toBe(value <= 100);
      }),
      { numRuns: 500 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* readDurationMs                                                             */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 13: Counts, percentages, and durations reject what the backend cannot send
// Validates: Requirements 13.10
describe('readDurationMs accepts exactly the transmitted non-negative durations', () => {
  it('is the very reader lib/duration.ts declares', () => {
    // The seam, asserted rather than assumed: a parser taking all of its readers
    // from one module must get the duration module's own reader, not a copy of
    // it that could drift.
    expect(readDurationMs).toBe(readTransmittedDuration);
  });

  it('agrees with the oracle, for any value at all', () => {
    fc.assert(
      fc.property(anyValueArb, (value) => {
        const expected = oracleDurationMs(value);
        const outcome = readADuration(value);

        expect(outcome.ok, describeValue(value)).toBe(expected !== null);

        if (outcome.ok) {
          expect(outcome.value, describeValue(value)).toBe(expected);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('agrees with the oracle over accepted spellings and their near misses', () => {
    fc.assert(
      fc.property(anyDurationTextArb, (text) => {
        const expected = oracleDurationMs(text);
        const outcome = readADuration(text);

        expect(outcome.ok, JSON.stringify(text)).toBe(expected !== null);

        if (outcome.ok) {
          expect(outcome.value, JSON.stringify(text)).toBe(expected);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('accepts an accepted spelling as a non-negative number of milliseconds', () => {
    fc.assert(
      fc.property(wireDurationArb, (text) => {
        const outcome = readADuration(text);

        expect(outcome.ok, text).toBe(true);
        if (!outcome.ok) return;

        expect(outcome.value).toBeGreaterThanOrEqual(0);
        expect(Number.isSafeInteger(outcome.value)).toBe(true);
        expect(outcome.value).toBeLessThanOrEqual(MAX_DURATION_MS);
      }),
      { numRuns: 1000 },
    );
  });

  it('rejects the negative form of every accepted spelling', () => {
    fc.assert(
      fc.property(wireDurationArb, (text) => {
        // A negative Keeper_Time is not a duration a person has spent in goal;
        // reading it as its magnitude or as zero would turn a backend fault into
        // a plausible figure.
        const outcome = readADuration(`-${text}`);

        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;

        expect(outcome.reason).toBe(`${LABEL} is a negative duration`);
      }),
      { numRuns: 500 },
    );
  });

  it('rejects a number of milliseconds, the unit it produces', () => {
    fc.assert(
      fc.property(fc.oneof(wholeCountArb, nonCountNumberArb), (value) => {
        // Accepting both forms would make the printer's output ambiguous and let
        // a field mistyped as a number parse instead of failing.
        expect(readADuration(value).ok, String(value)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('rejects every other string shape and every non-string', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc
            .constantFrom(...MALFORMED_DURATIONS)
            // Kept honest: the oracle, not the module under test, decides that
            // nothing in the list is actually a duration.
            .filter((text) => oracleDurationMs(text) === null),
          otherTypedValueArb,
        ),
        (value) => {
          expect(readADuration(value).ok).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Totality, determinism, and disclosure                                      */
/* -------------------------------------------------------------------------- */

/** Every diagnostic `readCount` can compose, transcribed from the module. */
const COUNT_REASONS: readonly string[] = [
  `${LABEL} is not a number`,
  `${LABEL} is not a finite number`,
  `${LABEL} is not a whole number`,
  `${LABEL} is a negative count`,
];

/** Every diagnostic `readPercentage` can compose. */
const PERCENTAGE_REASONS: readonly string[] = [
  `${LABEL} is not a number`,
  `${LABEL} is not a finite number`,
  `${LABEL} is outside the accepted percentage range`,
];

/** Every diagnostic `readDurationMs` can compose. */
const DURATION_REASONS: readonly string[] = [
  `${LABEL} is not a duration`,
  `${LABEL} is a negative duration`,
  `${LABEL} is not a duration of the transmitted form`,
  `${LABEL} names no duration of its form`,
  `${LABEL} names no representable duration`,
];

/** The three readers, each with the closed set of reasons it may compose. */
const NARROWED_READERS: readonly {
  readonly name: string;
  readonly read: ValueReader<number>;
  readonly reasons: readonly string[];
}[] = [
  { name: 'readCount', read: readCount, reasons: COUNT_REASONS },
  { name: 'readPercentage', read: readPercentage, reasons: PERCENTAGE_REASONS },
  { name: 'readDurationMs', read: readDurationMs, reasons: DURATION_REASONS },
];

// Feature: web-player-stats-screen, Property 13: Counts, percentages, and durations reject what the backend cannot send
// Validates: Requirements 13.10
describe('the three narrowed readers are total and disclose nothing', () => {
  it('settles on exactly one outcome for any value, and raises nothing', () => {
    fc.assert(
      fc.property(anyValueArb, (value) => {
        // An "accepts exactly" equivalence only means something if neither
        // outcome can also be a raise, so totality is restated here over the
        // same domain the equivalences quantify over.
        for (const { read } of NARROWED_READERS) {
          settle(() => read(value, LABEL));
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('draws every failure reason from its own closed set', () => {
    fc.assert(
      fc.property(anyValueArb, (value) => {
        for (const { name, read, reasons } of NARROWED_READERS) {
          const outcome = settle(() => read(value, LABEL));

          if (outcome.ok) continue;

          // 13.8: a reason is the caller's label plus fixed text, so a value
          // read from the body — a figure, a duration, a display name — can
          // never travel into a log or a rendered outcome through one.
          expect(reasons, `${name}: ${outcome.reason}`).toContain(outcome.reason);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('is deterministic, so no reading depends on a clock or a counter', () => {
    fc.assert(
      fc.property(anyValueArb, (value) => {
        for (const { read } of NARROWED_READERS) {
          const first = read(value, LABEL);
          const second = read(value, LABEL);

          expect(first.ok).toBe(second.ok);

          if (first.ok && second.ok) {
            expect(Object.is(first.value, second.value)).toBe(true);
          } else if (!first.ok && !second.ok) {
            expect(first.reason).toBe(second.reason);
          }
        }
      }),
      { numRuns: 500 },
    );
  });

  it('accepts no value that all three readers could confuse for one another', () => {
    fc.assert(
      fc.property(anyValueArb, (value) => {
        // The three accepted sets are what the requirement narrows, and they are
        // narrowed independently: a duration is a string and neither numeric
        // reader may take one, while a number is no duration.
        const asDuration = readADuration(value).ok;

        if (asDuration) {
          expect(typeof value).toBe('string');
          expect(readACount(value).ok).toBe(false);
          expect(readAPercentage(value).ok).toBe(false);
        }

        if (readACount(value).ok || readAPercentage(value).ok) {
          expect(typeof value).toBe('number');
          expect(asDuration).toBe(false);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
