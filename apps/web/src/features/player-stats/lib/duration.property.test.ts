// Feature: web-player-stats-screen, Property 25: Duration reading, printing, and presentation
// Validates: Requirements 11.5

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  MAX_DURATION_MS,
  type ParseResult,
  formatDuration,
  printDuration,
  readDurationMs,
} from './duration';

/**
 * Property tests for the Keeper_Time duration — its reader, its printer, and its
 * presentation formatter — placed beside the module they cover and running well
 * above the 100-iteration floor (Requirement 14.5).
 *
 * Property 25 has two halves, and this file keeps them apart:
 *
 * 1. **The printed form round-trips through the reader.** For every
 *    non-negative whole millisecond count within {@link MAX_DURATION_MS},
 *    `readDurationMs(printDuration(ms))` yields that same count. The comparison
 *    is in **milliseconds, not wire text**, because the module normalises on
 *    read and prints one canonical form: `'00:45:00'` and
 *    `'0.00:45:00.0000000'` are the same duration, so a text round trip would
 *    assert a spelling the design deliberately does not promise.
 * 2. **`formatDuration` is total over every number.** It is handed a value that
 *    reached the screen, and it must answer with a string for `NaN`, either
 *    infinity, a negative, and a fraction rather than raise or render `'NaNm'`.
 *
 * Around those two, the reader's own acceptance is stated as an **equivalence
 * against an oracle** ({@link oracleReadMs}) written from the accepted form as
 * Requirement 13.10 and the module's doc comment describe it — split on the
 * field separators, rather than by reusing the module's anchored pattern. A test
 * that re-applied that pattern would agree with any pattern at all, including
 * one that had lost its anchors or gained the negative sign. Because the oracle
 * decides, a generated near-miss that happens to be valid is no problem: the two
 * implementations are compared, never a hard-coded expectation.
 *
 * Two deliberate behaviours of the module are asserted rather than worked
 * around, since both are easy to "fix" into a defect:
 *
 *  - `printDuration` emits the **seven-digit fraction** whenever the duration
 *    carries a sub-second part, because without it a printed duration would lose
 *    its milliseconds and the round trip would hold only for whole seconds.
 *  - a value `printDuration` cannot represent — a fraction, a negative, `NaN`,
 *    an infinity — prints as `String(ms)`, a string the reader **rejects**.
 *    Clamping or truncating would let a value that cannot round-trip appear to.
 *
 * The reader's rejection of a **number of milliseconds** is asserted too, over
 * the very counts the printer accepts: the unit the reader produces is not a
 * form the reader takes, which is what keeps `printDuration`'s output
 * unambiguous.
 */

// --- The units, restated -----------------------------------------------------

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Ticks (100 ns) per millisecond: the wire fraction's scale. */
const TICKS_PER_MS = 10_000;

/** The label every reading in this file is taken under; carries no digit. */
const LABEL = 'keeperTime';

/**
 * Every diagnostic the reader can compose, transcribed from the module.
 *
 * Read as a closed set: a failure reason outside it would mean a value lifted
 * out of the input had reached a diagnostic, which is the leak Requirement 13.8
 * rules out for the parser that calls this reader.
 */
const FIXED_REASONS: readonly string[] = [
  `${LABEL} is not a duration`,
  `${LABEL} is a negative duration`,
  `${LABEL} is not a duration of the transmitted form`,
  `${LABEL} names no duration of its form`,
  `${LABEL} names no representable duration`,
];

/**
 * The canonical form {@link printDuration} promises: an optional day field with
 * no leading zero, two digits each of hours, minutes, and seconds, and an
 * optional fraction of exactly seven digits. Anchored at both ends.
 *
 * Field *ranges* are not checked here — {@link oracleReadMs} does that, so this
 * pattern cannot quietly become the only judge of validity.
 */
const CANONICAL_PRINTED_FORM =
  /^(?:[1-9]\d*\.)?\d{2}:\d{2}:\d{2}(?:\.\d{7})?$/;

/** The presentation form: `'0m'`, `'45m'`, `'1h 05m'`, and nothing else. */
const PRESENTATION_FORM = /^(?:(\d+)h )?(\d+)m$/;

// --- The oracle: the accepted wire form, parsed by splitting ------------------

const ASCII_DIGITS = '0123456789';

/** A run of one or more ASCII digits, optionally of an exact length. */
function isDigitRun(text: string, length?: number): boolean {
  if (text.length === 0) return false;
  if (length !== undefined && text.length !== length) return false;

  for (const character of text) {
    if (!ASCII_DIGITS.includes(character)) return false;
  }

  return true;
}

/**
 * The milliseconds a wire string names, or `null` if it names no duration this
 * feature accepts.
 *
 * An independent reading of `[d.]hh:mm:ss[.fffffff]`: split on `':'` into
 * exactly three fields, take the optional day off the first at its `'.'` and the
 * optional fraction off the last at its, require ASCII digit runs of the stated
 * lengths, bound the clock fields, and truncate the fraction's sub-millisecond
 * ticks. The negative form is refused at the first character.
 *
 * The arithmetic deliberately mirrors the module's order of operations: for a
 * day field of a hundred digits the sum is non-finite rather than merely large,
 * and a different grouping could disagree about which side of
 * {@link MAX_DURATION_MS} such a value falls on.
 */
function oracleReadMs(text: string): number | null {
  if (text.startsWith('-')) return null;

  const fields = text.split(':');
  if (fields.length !== 3) return null;

  const [leftField, minuteText, secondField] = fields;

  let dayText = '';
  let hourText = leftField;
  const dayBreak = leftField.indexOf('.');
  if (dayBreak !== -1) {
    dayText = leftField.slice(0, dayBreak);
    hourText = leftField.slice(dayBreak + 1);
    if (!isDigitRun(dayText)) return null;
  }

  let secondText = secondField;
  let fractionText = '';
  const fractionBreak = secondField.indexOf('.');
  if (fractionBreak !== -1) {
    secondText = secondField.slice(0, fractionBreak);
    fractionText = secondField.slice(fractionBreak + 1);
    if (!isDigitRun(fractionText) || fractionText.length > 7) return null;
  }

  if (!isDigitRun(hourText, 2)) return null;
  if (!isDigitRun(minuteText, 2)) return null;
  if (!isDigitRun(secondText, 2)) return null;

  const days = dayText === '' ? 0 : Number(dayText);
  const hours = Number(hourText);
  const minutes = Number(minuteText);
  const seconds = Number(secondText);

  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  const milliseconds =
    fractionText === ''
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

// --- Helpers -----------------------------------------------------------------

const read = (value: unknown): ParseResult<number> =>
  readDurationMs(value, LABEL);

/**
 * `printDuration` and `formatDuration` seen as functions of an unknown, so the
 * totality the module documents for a value that is not a number at all can be
 * stated. Both guard on `typeof` before anything else; the casts exist only
 * because the declared parameter rules such a call out at compile time.
 */
const printAnything = printDuration as unknown as (value: unknown) => string;
const formatAnything = formatDuration as unknown as (value: unknown) => string;

/** The total minutes the presentation text names, or `null` if it is malformed. */
function presentedMinutes(text: string): number | null {
  const match = PRESENTATION_FORM.exec(text);
  if (match === null) return null;

  const [, hourText, minuteText] = match;

  return (hourText === undefined ? 0 : Number(hourText) * 60) + Number(minuteText);
}

// --- Generators --------------------------------------------------------------

/**
 * Millisecond counts at and around every boundary the three functions turn on:
 * the sub-second and sub-minute edges, the hour, the day, a multi-day duration,
 * and the representable ceiling.
 */
const BOUNDARY_MS: readonly number[] = [
  0,
  1,
  9,
  10,
  99,
  100,
  999,
  MS_PER_SECOND,
  MS_PER_SECOND + 1,
  1_500,
  MS_PER_MINUTE - 1, // 59 999: the presentation boundary, below
  MS_PER_MINUTE,
  MS_PER_MINUTE + 1,
  45 * MS_PER_MINUTE,
  MS_PER_HOUR - 1,
  MS_PER_HOUR,
  MS_PER_HOUR + 5 * MS_PER_MINUTE, // '1h 05m'
  23 * MS_PER_HOUR + 59 * MS_PER_MINUTE + 59 * MS_PER_SECOND + 999,
  MS_PER_DAY - 1,
  MS_PER_DAY,
  MS_PER_DAY + 1,
  2 * MS_PER_DAY,
  400 * MS_PER_DAY,
  MAX_DURATION_MS - 1,
  MAX_DURATION_MS,
];

/**
 * A non-negative whole millisecond count within {@link MAX_DURATION_MS}: the
 * domain of the round trip.
 *
 * Weighted across the scales a Keeper_Time actually takes (sub-second, a
 * kickabout's minutes, a season's hours) as well as the multi-day and ceiling
 * values no backend can send but a fuzzed body can, and includes whole-second
 * and whole-minute multiples so the fraction-absent branch of the printer is
 * common rather than incidental.
 */
const durationMsArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(...BOUNDARY_MS) },
  { weight: 3, arbitrary: fc.integer({ min: 0, max: 999 }) },
  { weight: 3, arbitrary: fc.integer({ min: 0, max: MS_PER_MINUTE - 1 }) },
  { weight: 4, arbitrary: fc.integer({ min: 0, max: 3 * MS_PER_HOUR }) },
  { weight: 3, arbitrary: fc.integer({ min: 0, max: MS_PER_DAY - 1 }) },
  {
    weight: 3,
    arbitrary: fc.integer({ min: MS_PER_DAY, max: 400 * MS_PER_DAY }),
  },
  { weight: 2, arbitrary: fc.integer({ min: 0, max: MAX_DURATION_MS }) },
  {
    weight: 3,
    arbitrary: fc
      .integer({ min: 0, max: 100_000 })
      .map((seconds) => seconds * MS_PER_SECOND),
  },
  {
    weight: 3,
    arbitrary: fc
      .integer({ min: 0, max: 10_000 })
      .map((minutes) => minutes * MS_PER_MINUTE),
  },
);

/** One to seven digits: every fraction width the wire form admits. */
const fractionDigitsArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...ASCII_DIGITS.split('')), {
    minLength: 1,
    maxLength: 7,
  })
  .map((digits) => digits.join(''));

/** The fields of one accepted wire spelling. */
interface WireFields {
  /** `null` for the day-less spelling; a digit run otherwise, zeros included. */
  readonly dayText: string | null;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  /** `null` for the fraction-less spelling. */
  readonly fractionText: string | null;
}

const pad2 = (value: number): string => String(value).padStart(2, '0');

const printWireFields = ({
  dayText,
  hours,
  minutes,
  seconds,
  fractionText,
}: WireFields): string =>
  `${dayText === null ? '' : `${dayText}.`}${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}${
    fractionText === null ? '' : `.${fractionText}`
  }`;

/**
 * An accepted spelling of a duration: with and without the day field, with the
 * day field spelled with and without leading zeros, and with the fraction at
 * every width from one digit to the full seven.
 */
const wireFieldsArb: fc.Arbitrary<WireFields> = fc.record({
  dayText: fc.oneof(
    { weight: 3, arbitrary: fc.constant(null) },
    {
      weight: 4,
      arbitrary: fc.integer({ min: 0, max: 400 }).map((days) => String(days)),
    },
    {
      weight: 2,
      arbitrary: fc
        .tuple(fc.integer({ min: 0, max: 99 }), fc.integer({ min: 1, max: 4 }))
        .map(([days, zeros]) => `${'0'.repeat(zeros)}${String(days)}`),
    },
  ),
  hours: fc.integer({ min: 0, max: 23 }),
  minutes: fc.integer({ min: 0, max: 59 }),
  seconds: fc.integer({ min: 0, max: 59 }),
  fractionText: fc.oneof(
    { weight: 3, arbitrary: fc.constant(null) },
    { weight: 5, arbitrary: fractionDigitsArb },
    {
      weight: 2,
      arbitrary: fc
        .array(fc.constantFrom(...ASCII_DIGITS.split('')), {
          minLength: 7,
          maxLength: 7,
        })
        .map((digits) => digits.join('')),
    },
  ),
});

/** An accepted wire string. */
const wireTextArb: fc.Arbitrary<string> = wireFieldsArb.map(printWireFields);

/**
 * String shapes no serialiser of this contract emits: the negative form, a
 * single-digit hour, a missing field, an over-long fraction, whitespace padding,
 * an ISO-8601 duration, the presentation form, and the out-of-range clock fields
 * the constant form carries as a day instead.
 */
const MALFORMED_TEXTS: readonly string[] = [
  '',
  ' ',
  '\t',
  '\n',
  '45',
  '45m',
  '2700000',
  '0:45:00',
  '00:45',
  '00:45:',
  ':45:00',
  '00::00',
  '00:45:00.',
  '.00:45:00',
  '1.2.00:45:00',
  '1..00:45:00',
  '00:45:00.00000000', // eight digits
  '00:45:00.1234567890',
  ' 00:45:00',
  '00:45:00 ',
  '00:45:00\n',
  '\u00a000:45:00',
  '00:45:00Z',
  '+00:45:00',
  '-00:45:00',
  '-0.00:45:00.0000000',
  '-00:00:00',
  'PT45M',
  'P1DT2H',
  '00-45-00',
  '00.45.00',
  '1:00:45:00',
  '000:45:00',
  '0m',
  '45m',
  '1h 05m',
  '48h 00m',
  'NaN',
  'Infinity',
  '-Infinity',
  '1e+21',
  'null',
  'undefined',
  '25:00:00', // an hour the constant form carries as a day
  '00:60:00',
  '00:00:60',
  '24:00:00',
  '99:99:99',
  '0.24:00:00',
  '١٢:٤٥:٠٠', // Arabic-Indic digits
  '00:45:00.123456７', // a full-width digit in the fraction
  '99999999999999999999999999999999.00:00:00',
];

/** A single-character edit of an accepted spelling: the nearest plausible miss. */
const mutatedWireTextArb: fc.Arbitrary<string> = wireTextArb.chain((text) =>
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
      const tail = text.slice(index + 1);
      const character = text.charAt(index);

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

/** Any string at all, weighted so acceptance and rejection both occur often. */
const anyTextArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: wireTextArb },
  { weight: 5, arbitrary: mutatedWireTextArb },
  { weight: 5, arbitrary: fc.constantFrom(...MALFORMED_TEXTS) },
  { weight: 3, arbitrary: durationMsArb.map(printDuration) },
  { weight: 2, arbitrary: fc.string({ maxLength: 32 }) },
  { weight: 1, arbitrary: fc.string({ unit: 'grapheme', maxLength: 16 }) },
);

/**
 * Values of every type other than `string`, including the shapes a coercing
 * reader would wrongly accept: a boxed wire string, a one-element array holding
 * one, an object carrying one, and — the case the module argues about at
 * length — a plain number of milliseconds.
 */
const nonStringArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      true,
      false,
      0,
      -0,
      2_700_000,
      0.5,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER,
      [],
      ['00:45:00'],
      [['00:45:00']],
      {},
      { value: '00:45:00' },
      { ticks: 27_000_000_000 },
      2_700_000n,
      Symbol('00:45:00'),
      () => '00:45:00',
      new Map([['00:45:00', true]]),
      new Set(['00:45:00']),
      new Date(0),
      Object('00:45:00'),
      Object.create(null),
      /00:45:00/,
    ),
  },
  { weight: 4, arbitrary: durationMsArb },
  { weight: 2, arbitrary: fc.double() },
  { weight: 1, arbitrary: fc.boolean() },
  {
    weight: 3,
    arbitrary: fc
      .anything({ maxDepth: 2, withBigInt: true, withMap: true, withSet: true })
      .filter((value) => typeof value !== 'string'),
  },
);

/** Anything at all: the reader's true domain. */
const anyCandidateArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 5, arbitrary: anyTextArb },
  { weight: 5, arbitrary: nonStringArb },
);

/**
 * Every number, not only every duration: `formatDuration`'s domain. `NaN`, both
 * infinities, negatives, fractions below a minute, and the ceiling are drawn
 * deliberately rather than left to chance.
 */
const anyNumberArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 5, arbitrary: durationMsArb },
  {
    weight: 5,
    arbitrary: fc.constantFrom(
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -0,
      0,
      0.5,
      -0.5,
      -1,
      -MS_PER_MINUTE,
      -MS_PER_DAY,
      MS_PER_MINUTE - 1,
      MS_PER_MINUTE - 0.001,
      MS_PER_MINUTE + 0.5,
      59_999.999,
      Number.MIN_VALUE,
      Number.MAX_VALUE,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
      Number.EPSILON,
    ),
  },
  { weight: 3, arbitrary: fc.double() },
  { weight: 2, arbitrary: fc.double({ min: -1e9, max: 1e9 }) },
  { weight: 2, arbitrary: fc.integer() },
);

/* -------------------------------------------------------------------------- */
/* The round trip                                                             */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 25: Duration reading, printing, and
// presentation — the printed form reads back as the same milliseconds
// Validates: Requirements 11.5
describe('the printed duration round-trips through the reader', () => {
  it('reads back as the very milliseconds it was printed from', () => {
    fc.assert(
      fc.property(durationMsArb, (ms) => {
        // Milliseconds, not wire text: the module normalises on read and prints
        // one canonical spelling of several the reader accepts.
        const result = read(printDuration(ms));

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value).toBe(ms);
      }),
      { numRuns: 1000 },
    );
  });

  it('round-trips every boundary count, the representable ceiling included', () => {
    // Stated as examples as well as generated, because the ceiling is where a
    // reassembled total stops being exact and the generator reaches it rarely.
    for (const ms of BOUNDARY_MS) {
      const result = read(printDuration(ms));

      expect(result.ok, `${String(ms)} -> ${printDuration(ms)}`).toBe(true);
      if (!result.ok) continue;

      expect(result.value, printDuration(ms)).toBe(ms);
    }
  });

  it('prints the canonical form, and only ever that form', () => {
    fc.assert(
      fc.property(durationMsArb, (ms) => {
        const printed = printDuration(ms);

        expect(printed).toMatch(CANONICAL_PRINTED_FORM);
        // The oracle, not the pattern, is what says the fields are in range.
        expect(oracleReadMs(printed)).toBe(ms);
      }),
      { numRuns: 1000 },
    );
  });

  it('carries the day field exactly when the duration reaches a day', () => {
    fc.assert(
      fc.property(durationMsArb, (ms) => {
        const printed = printDuration(ms);

        expect(/^\d+\./.test(printed)).toBe(ms >= MS_PER_DAY);
      }),
      { numRuns: 500 },
    );
  });

  it('carries the seven-digit fraction exactly when there is a sub-second part', () => {
    fc.assert(
      fc.property(durationMsArb, (ms) => {
        const printed = printDuration(ms);
        // Only the fraction can end in a digit run behind a dot: the day field's
        // dot is followed by the clock, which carries colons.
        const fractionMatch = /\.(\d+)$/.exec(printed);

        if (ms % MS_PER_SECOND === 0) {
          // No decoration: a whole second prints without a fraction at all.
          expect(fractionMatch).toBeNull();
          return;
        }

        // Not optional decoration: without it the milliseconds would be lost
        // and the round trip would hold only for whole seconds.
        expect(fractionMatch).not.toBeNull();
        if (fractionMatch === null) return;

        const [, fractionText] = fractionMatch;

        expect(fractionText).toHaveLength(7);
        expect(Number(fractionText)).toBe((ms % MS_PER_SECOND) * TICKS_PER_MS);
      }),
      { numRuns: 1000 },
    );
  });

  it('prints the same text on every call', () => {
    fc.assert(
      fc.property(durationMsArb, (ms) => {
        expect(printDuration(ms)).toBe(printDuration(ms));
      }),
      { numRuns: 300 },
    );
  });

  it('normalises an accepted spelling to one printed form that reads the same', () => {
    fc.assert(
      fc.property(wireTextArb, (text) => {
        const first = read(text);

        expect(first.ok).toBe(true);
        if (!first.ok) return;

        // Printing a reading and reading it again is stable, so a non-canonical
        // spelling settles after exactly one pass rather than drifting.
        const printed = printDuration(first.value);
        const second = read(printed);

        expect(second.ok).toBe(true);
        if (!second.ok) return;

        expect(second.value).toBe(first.value);
        expect(printDuration(second.value)).toBe(printed);
      }),
      { numRuns: 1000 },
    );
  });

  it('prints a value it cannot represent as a string the reader rejects', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(
            -1,
            -0.5,
            -MS_PER_DAY,
            0.5,
            1.5,
            MS_PER_MINUTE + 0.25,
            Number.NaN,
            Number.POSITIVE_INFINITY,
            Number.NEGATIVE_INFINITY,
            MAX_DURATION_MS + 2,
            Number.MAX_VALUE,
            1e21,
          ),
          fc.double().filter((value) => !Number.isSafeInteger(value)),
          fc.integer({ min: -1_000_000, max: -1 }),
        ),
        (ms) => {
          // Clamping or truncating would let a value that cannot round-trip
          // appear to; failing the read instead surfaces the mismatch.
          const printed = printDuration(ms);

          expect(typeof printed).toBe('string');
          expect(read(printed).ok).toBe(false);
          expect(oracleReadMs(printed)).toBeNull();
        },
      ),
      { numRuns: 500 },
    );
  });

  it('prints a string for a value that is not a number at all', () => {
    // Off the declared signature, but the module promises a string rather than a
    // raise; each of these converts without running caller-supplied code.
    for (const value of [undefined, null, true, false, 2_700_000n, [], [1], {}]) {
      const printed = printAnything(value);

      expect(typeof printed).toBe('string');
      expect(read(printed).ok).toBe(false);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 25: Duration reading, printing, and
// presentation — the reader accepts exactly the transmitted form
// Validates: Requirements 11.5
describe('the duration reader accepts exactly the transmitted form', () => {
  it('agrees with the oracle, for any string at all', () => {
    fc.assert(
      fc.property(anyTextArb, (text) => {
        // The equivalence: accepted exactly when the independently written
        // oracle accepts, and with exactly the milliseconds it names.
        const expected = oracleReadMs(text);
        const result = read(text);

        expect(result.ok, JSON.stringify(text)).toBe(expected !== null);

        if (result.ok) {
          expect(result.value, JSON.stringify(text)).toBe(expected);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('reads an accepted spelling as the milliseconds its fields name', () => {
    fc.assert(
      fc.property(wireFieldsArb, (fields) => {
        const { dayText, hours, minutes, seconds, fractionText } = fields;
        const expected =
          (dayText === null ? 0 : Number(dayText)) * MS_PER_DAY +
          hours * MS_PER_HOUR +
          minutes * MS_PER_MINUTE +
          seconds * MS_PER_SECOND +
          (fractionText === null
            ? 0
            : Math.floor(Number(fractionText.padEnd(7, '0')) / TICKS_PER_MS));

        const result = read(printWireFields(fields));

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value).toBe(expected);
      }),
      { numRuns: 1000 },
    );
  });

  it('truncates the fraction below a millisecond rather than rounding it', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999 }),
        fc
          .array(fc.constantFrom(...ASCII_DIGITS.split('')), {
            minLength: 4,
            maxLength: 4,
          })
          .map((digits) => digits.join('')),
        (milliseconds, tickDigits) => {
          // The wire fraction counts ticks, which is finer than a millisecond.
          // Every sub-millisecond remainder reads as the same duration — '.9999'
          // of a millisecond does not round up — because nothing this feature
          // presents can observe a tick.
          const padded = String(milliseconds).padStart(3, '0');
          const result = read(`00:00:00.${padded}${tickDigits}`);

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          expect(result.value).toBe(milliseconds);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('reads the day-bearing and day-less spellings of one duration alike', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        fc.integer({ min: 0, max: 59 }),
        fc.integer({ min: 1, max: 4 }),
        (hours, minutes, seconds, zeros) => {
          const clock = `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
          const spellings = [
            clock,
            `0.${clock}`,
            `${'0'.repeat(zeros)}.${clock}`,
            `${clock}.0000000`,
            `0.${clock}.0000000`,
            `${clock}.0`,
          ];

          const readings = spellings.map((text) => read(text));

          for (const [index, reading] of readings.entries()) {
            expect(reading.ok, spellings[index]).toBe(true);
            if (!reading.ok) continue;

            expect(reading.value, spellings[index]).toBe(
              hours * MS_PER_HOUR + minutes * MS_PER_MINUTE + seconds * MS_PER_SECOND,
            );
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it('rejects the negative form, and says so', () => {
    fc.assert(
      fc.property(wireTextArb, (text) => {
        // A negative Keeper_Time is not a duration a person has spent in goal;
        // reading it as its magnitude or as zero would turn a backend fault into
        // a plausible figure.
        const result = read(`-${text}`);

        expect(result.ok).toBe(false);
        if (result.ok) return;

        expect(result.reason).toBe(`${LABEL} is a negative duration`);
      }),
      { numRuns: 500 },
    );
  });

  it('rejects an out-of-range clock field', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom('25:00:00', '00:60:00', '00:00:60'),
          fc
            .tuple(
              fc.integer({ min: 24, max: 99 }),
              fc.integer({ min: 0, max: 59 }),
              fc.integer({ min: 0, max: 59 }),
            )
            .map(([h, m, s]) => `${pad2(h)}:${pad2(m)}:${pad2(s)}`),
          fc
            .tuple(
              fc.integer({ min: 0, max: 23 }),
              fc.integer({ min: 60, max: 99 }),
              fc.integer({ min: 0, max: 59 }),
            )
            .map(([h, m, s]) => `${pad2(h)}:${pad2(m)}:${pad2(s)}`),
          fc
            .tuple(
              fc.integer({ min: 0, max: 23 }),
              fc.integer({ min: 0, max: 59 }),
              fc.integer({ min: 60, max: 99 }),
            )
            .map(([h, m, s]) => `${pad2(h)}:${pad2(m)}:${pad2(s)}`),
        ),
        (text) => {
          // The constant form carries an overflowing hour as a day, so 25 hours
          // is '1.01:00:00'; a two-digit hour above 23 is a value no serialiser
          // emits, and reading it as 25 hours would invent a duration.
          expect(read(text).ok).toBe(false);
          expect(oracleReadMs(text)).toBeNull();
        },
      ),
      { numRuns: 500 },
    );
  });

  it('rejects every other string shape', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...MALFORMED_TEXTS).filter(
          // Kept honest: nothing in the list may actually be a duration, and the
          // oracle rather than the module under test is what decides.
          (text) => oracleReadMs(text) === null,
        ),
        (text) => {
          expect(read(text).ok).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('rejects the presentation form it would be rendered as', () => {
    fc.assert(
      fc.property(durationMsArb, (ms) => {
        // The two directions are not inverses: presentation text is lossy, and
        // feeding it back must fail rather than read as some other duration.
        expect(read(formatDuration(ms)).ok).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('rejects a number of milliseconds, the unit it produces', () => {
    fc.assert(
      fc.property(durationMsArb, (ms) => {
        // Accepting both forms would make the printer's output ambiguous: a
        // round trip could no longer tell a transmitted duration from a computed
        // one, and a field mistyped as a number would parse instead of failing.
        const result = read(ms);

        expect(result.ok).toBe(false);
        if (result.ok) return;

        expect(result.reason).toBe(`${LABEL} is not a duration`);
        // The printed form of that same count is accepted, so the rejection is
        // about the form and not about the value.
        expect(read(printDuration(ms)).ok).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('rejects every value of every other type, boxed strings included', () => {
    fc.assert(
      fc.property(nonStringArb, (candidate) => {
        const result = read(candidate);

        expect(result.ok).toBe(false);
        if (result.ok) return;

        expect(result.reason).toBe(`${LABEL} is not a duration`);
      }),
      { numRuns: 1000 },
    );
  });

  it('answers a result for any input at all, and raises nothing', () => {
    fc.assert(
      fc.property(anyCandidateArb, (candidate) => {
        const result = read(candidate);

        expect(typeof result.ok).toBe('boolean');

        if (result.ok) {
          expect(Number.isSafeInteger(result.value)).toBe(true);
          expect(result.value).toBeGreaterThanOrEqual(0);
          expect(result.value).toBeLessThanOrEqual(MAX_DURATION_MS);
        } else {
          expect(typeof result.reason).toBe('string');
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('is deterministic across repeated reads', () => {
    fc.assert(
      fc.property(anyCandidateArb, (candidate) => {
        expect(read(candidate)).toEqual(read(candidate));
        expect(read(candidate)).toEqual(read(candidate));
      }),
      { numRuns: 500 },
    );
  });

  it('composes a failure from its fixed clauses alone', () => {
    fc.assert(
      fc.property(anyCandidateArb, (candidate) => {
        const result = read(candidate);

        if (result.ok) return;

        // A closed set, so no value lifted out of the input can reach a
        // diagnostic the parser will carry (13.8).
        expect(FIXED_REASONS).toContain(result.reason);
        expect(result.reason.startsWith(`${LABEL} `)).toBe(true);
        expect(result.reason).not.toMatch(/\d/);
      }),
      { numRuns: 1000 },
    );
  });

  it('never converts a candidate, so a hostile toString or valueOf never runs', () => {
    fc.assert(
      fc.property(wireTextArb, (text) => {
        let conversions = 0;
        const hostile = {
          valueOf() {
            conversions += 1;
            return text;
          },
          toString() {
            conversions += 1;
            return text;
          },
        };

        expect(read(hostile).ok).toBe(false);
        expect(conversions).toBe(0);
      }),
      { numRuns: 300 },
    );
  });

  it('rejects a duration nested arbitrarily deep without walking into it', () => {
    fc.assert(
      fc.property(
        wireTextArb,
        fc.integer({ min: 1, max: 100 }),
        (text, depth) => {
          let candidate: unknown = text;
          for (let level = 0; level < depth; level += 1) {
            candidate = level % 2 === 0 ? [candidate] : { value: candidate };
          }

          expect(read(candidate).ok).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('survives a self-referencing structure and a throwing accessor', () => {
    const selfReferencing: Record<string, unknown> = { value: '00:45:00' };
    selfReferencing.self = selfReferencing;

    const cyclicArray: unknown[] = ['00:45:00'];
    cyclicArray.push(cyclicArray);

    const throwingGetter = {
      get value(): string {
        throw new Error('must never be read');
      },
    };

    for (const candidate of [selfReferencing, cyclicArray, throwingGetter]) {
      expect(read(candidate).ok).toBe(false);
    }
  });

  it('holds no pattern state between reads', () => {
    fc.assert(
      fc.property(fc.array(anyTextArb, { minLength: 2, maxLength: 12 }), (texts) => {
        // A global or sticky pattern would carry a lastIndex across calls and
        // make a reading depend on the one before it.
        const readings = texts.map((text) => read(text).ok);
        const independent = texts.map((text) => oracleReadMs(text) !== null);

        expect(readings).toEqual(independent);
      }),
      { numRuns: 500 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Presentation                                                               */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 25: Duration reading, printing, and
// presentation — formatDuration is total over every number
// Validates: Requirements 11.5
describe('the duration formatter is total over every number', () => {
  it('returns a string for any number whatsoever, and raises nothing', () => {
    fc.assert(
      fc.property(anyNumberArb, (ms) => {
        // Totality is the whole point: the fallback is unreachable through the
        // screen, and exists so this function has one answer for every input
        // rather than a condition the caller must check first.
        const text = formatDuration(ms);

        expect(typeof text).toBe('string');
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toMatch(/NaN|Infinity|undefined/);
      }),
      { numRuns: 2000 },
    );
  });

  it('presents the presentation form for every duration the reader can yield', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          durationMsArb,
          fc.constantFrom(
            Number.NaN,
            Number.POSITIVE_INFINITY,
            Number.NEGATIVE_INFINITY,
            -1,
            -0.5,
            0.5,
          ),
        ),
        (ms) => {
          // Scoped to the parser's own range (Requirement 11.5 asks for totality
          // over every duration the Response_Parser accepts) plus the degenerate
          // inputs that take the fallback. Beyond MAX_DURATION_MS a millisecond
          // count is no longer a duration this feature can hold, and the reader
          // never yields one.
          expect(formatDuration(ms)).toMatch(PRESENTATION_FORM);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('presents the minutes the duration contains', () => {
    fc.assert(
      fc.property(
        fc.oneof(durationMsArb, fc.double({ min: 0, max: 1e12, noNaN: true })),
        (ms) => {
          const text = formatDuration(ms);

          if (ms < MS_PER_MINUTE) {
            expect(text).toBe('0m');
            return;
          }

          // Parsed back out of the text rather than compared to a re-derivation
          // of the same arithmetic: the text must name the duration it was given.
          expect(presentedMinutes(text)).toBe(Math.floor(ms / MS_PER_MINUTE));
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('pads the minutes to two digits beside an hour, and not below one', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 400 * 24 }),
        fc.integer({ min: 0, max: 59 }),
        (hours, minutes) => {
          const text = formatDuration(
            hours * MS_PER_HOUR + minutes * MS_PER_MINUTE,
          );

          if (hours === 0) {
            // Below an hour the minutes carry no padding.
            expect(text).toBe(`${String(minutes)}m`);
            return;
          }

          // Padded above it, so a column of durations stays aligned.
          expect(text).toBe(`${String(hours)}h ${pad2(minutes)}m`);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('is determined solely by the minutes, so a second never shows', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: MS_PER_MINUTE - 1 }),
        fc.integer({ min: 0, max: MS_PER_MINUTE - 1 }),
        (minutes, firstRemainder, secondRemainder) => {
          // Requirement 11.5: the form is determined solely by the argument, and
          // seconds are not presented — a figure to the second would imply a
          // precision the stint records do not have.
          const base = minutes * MS_PER_MINUTE;

          expect(formatDuration(base + firstRemainder)).toBe(
            formatDuration(base + secondRemainder),
          );
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('treats the minute boundary as the step from 0m to 1m', () => {
    expect(formatDuration(MS_PER_MINUTE - 1)).toBe('0m');
    expect(formatDuration(MS_PER_MINUTE)).toBe('1m');
    expect(formatDuration(MS_PER_MINUTE + MS_PER_MINUTE - 1)).toBe('1m');
  });

  it('presents a day as hours, because there is no day unit', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(45 * MS_PER_MINUTE)).toBe('45m');
    expect(formatDuration(MS_PER_HOUR + 5 * MS_PER_MINUTE)).toBe('1h 05m');
    expect(formatDuration(MS_PER_DAY)).toBe('24h 00m');
    expect(formatDuration(2 * MS_PER_DAY)).toBe('48h 00m');
  });

  it('presents every value that is not a positive finite duration as 0m', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(
            Number.NaN,
            Number.POSITIVE_INFINITY,
            Number.NEGATIVE_INFINITY,
            -0,
            0,
            0.5,
            -0.5,
            -1,
            -MS_PER_DAY,
            MS_PER_MINUTE - 1,
            59_999.999,
            Number.MIN_VALUE,
            Number.MIN_SAFE_INTEGER,
            Number.EPSILON,
          ),
          fc.double({ min: 0, max: MS_PER_MINUTE - 1, noNaN: true }),
          fc.integer({ min: Number.MIN_SAFE_INTEGER, max: -1 }),
        ),
        (ms) => {
          expect(formatDuration(ms)).toBe('0m');
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('presents a positive infinity as 0m rather than as a numeral', () => {
    // Called out on its own: a formatter that only guarded the lower bound would
    // render 'Infinityh NaNm' here.
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0m');
    expect(formatDuration(Number.NaN)).toBe('0m');
    expect(formatDuration(Number.MAX_VALUE)).not.toMatch(/NaN|Infinity/);
  });

  it('truncates a fractional millisecond count downward', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),
        // Bounded away from zero: a denormal fraction subtracts to the same
        // double, which would make the second expectation a statement about
        // floating point rather than about truncation.
        fc.double({ min: 0.001, max: 0.999, noNaN: true }),
        (minutes, fraction) => {
          const whole = minutes * MS_PER_MINUTE;

          // A count just above a minute boundary presents as that minute, and a
          // count just below it as the previous one: downward, never rounded.
          expect(formatDuration(whole + fraction)).toBe(formatDuration(whole));
          expect(formatDuration(whole - fraction)).toBe(
            formatDuration(whole - MS_PER_MINUTE),
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  it('never decreases as the duration grows', () => {
    fc.assert(
      fc.property(durationMsArb, durationMsArb, (first, second) => {
        const [lower, higher] = first <= second ? [first, second] : [second, first];

        expect(presentedMinutes(formatDuration(lower)) ?? 0).toBeLessThanOrEqual(
          presentedMinutes(formatDuration(higher)) ?? 0,
        );
      }),
      { numRuns: 500 },
    );
  });

  it('presents the same text on every call', () => {
    fc.assert(
      fc.property(anyNumberArb, (ms) => {
        expect(formatDuration(ms)).toBe(formatDuration(ms));
        expect(formatDuration(ms)).toBe(formatDuration(ms));
      }),
      { numRuns: 500 },
    );
  });

  it('carries no grouping separator, so the digits do not depend on a locale', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_DURATION_MS }),
        (ms) => {
          // No locale-dependent formatter and no grouping separator: the text is
          // the same in a browser, in CI, and in jsdom.
          const text = formatDuration(ms);

          expect(text).not.toMatch(/[,\u00a0\u202f]/);
          expect(text).toMatch(PRESENTATION_FORM);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('presents a value that is not a number at all as 0m', () => {
    // Off the declared signature, like the printer's non-number branch, but the
    // module promises a string for every input rather than a raise.
    for (const value of [
      undefined,
      null,
      true,
      '45m',
      '00:45:00',
      2_700_000n,
      [],
      [1],
      {},
      Object(2_700_000),
      Symbol('45m'),
    ]) {
      expect(formatAnything(value)).toBe('0m');
    }
  });
});
