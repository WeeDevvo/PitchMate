// Feature: web-player-stats-screen, Property 24: Win percentage presentation is
// exactly one decimal place
// Validates: Requirements 6.3, 6.4, 6.5

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { formatWinPercentage } from './numberFormat';

/**
 * Property tests for the Win_Percentage presentation, beside the module they
 * cover and each assertion running well above the 100-case floor (Requirement
 * 14.5).
 *
 * Requirement 6.5 asks for the formatting to be a pure function, total over every
 * finite number in the closed range 0.0 to 100.0, whose digits are determined
 * **solely by its argument**. That is what makes this file possible: both
 * rendered consumers — the Record_Panel's percentage (Requirement 6.3) and each
 * Paired_Stat_Entry's (Requirement 10.4) — can rely on the text being right
 * without rendering anything, and neither re-decides it.
 *
 * Four claims:
 *
 * - **Every percentage in range formats with exactly one decimal place.** The
 *   shape is asserted character by character — one `'.'`, exactly one digit
 *   behind it, no second decimal place, no grouping separator, no sign — and the
 *   *digits* are checked against an independent rounding statement rather than
 *   against `toFixed`, the implementation's own route. The endpoints, `-0`, and
 *   the values whose first decimal is zero are drawn deliberately rather than
 *   left to chance, because `'50%'` and `'50.0%'` claim different precisions and
 *   a column where some figures carry a decimal and some do not is the defect
 *   this requirement rules out.
 * - **Nothing outside the range formats.** A value below 0 or above 100, `NaN`,
 *   either infinity, and anything that is not a number at all yield no value, so
 *   the caller renders the no-win-percentage statement (Requirement 6.4) — the
 *   same presentation as a profile that carries no percentage. Nothing is
 *   clamped and nothing is rounded into range: `100.1` presented as `'100.0%'`
 *   would turn a backend fault into a figure that looks earned, and `-0.2` as
 *   `'0.0%'` likewise.
 * - **The digits depend on the argument and on nothing else.** Repeated calls
 *   agree, an interleaved call for another percentage changes nothing, and the
 *   text is unchanged while `Intl` and `toLocaleString` are replaced by throwing
 *   stand-ins — which is the sharp form of "no locale-dependent formatter": a
 *   module that reached for `Intl.NumberFormat` would render `'66,7 %'` in one
 *   locale and raise here.
 * - **The function is total and coerces nothing.** A `string` or `null` for every
 *   input of every type, never an exception, and a hostile `valueOf` or
 *   `toString` on the argument is never run.
 *
 * Deliberately not claimed here: that the Record_Panel renders the percentage or
 * that an absent one renders the statement. Those are rendering claims about the
 * component that consumes this answer.
 */

// --- the rule, restated ------------------------------------------------------

/** The closed range the backend's Win_Percentage inhabits. */
const MIN_PERCENTAGE = 0;
const MAX_PERCENTAGE = 100;

/** The explicit percentage indication Requirements 6.3 and 10.4 call for. */
const PERCENTAGE_SIGN = '%';

/**
 * The presented form: an integer part with no leading zero, exactly one `'.'`,
 * exactly one decimal digit, and the percentage sign. Anchored at both ends, so
 * a second decimal place, a grouping separator, a sign, a unit, or any trailing
 * text fails it.
 *
 * The integer part's *range* is not checked by this pattern —
 * {@link roundedToOneDecimal} is what says the digits name the argument, so the
 * pattern cannot quietly become the only judge.
 */
const PRESENTED_FORM = /^(?:0|[1-9]\d{0,2})\.\d%$/;

/** ASCII digits: the only digits a figure determined by its argument can carry. */
const ASCII_DIGITS = '0123456789';

/**
 * The one-decimal grid the presentation rounds onto, as a count of tenths, so the
 * oracle below compares whole numbers rather than binary fractions.
 */
const TENTHS_PER_UNIT = 10;

/**
 * The tenths the presented text names, or `null` if the text is not of the
 * presented form.
 *
 * An independent reading: strip the percentage sign, split on the single `'.'`,
 * require ASCII digit runs — one digit exactly behind the point — and recombine
 * as tenths by integer arithmetic. Neither `parseFloat` nor `Number` decides the
 * shape, so text like `'66.7%junk'`, `'6.7e1%'`, or `'66,7%'` is rejected here
 * rather than silently read as a number.
 */
function presentedTenths(text: string): number | null {
  if (!text.endsWith(PERCENTAGE_SIGN)) return null;

  const figure = text.slice(0, -PERCENTAGE_SIGN.length);
  const fields = figure.split('.');
  if (fields.length !== 2) return null;

  const [wholeText, decimalText] = fields;

  if (wholeText.length === 0 || decimalText.length !== 1) return null;

  for (const character of `${wholeText}${decimalText}`) {
    if (!ASCII_DIGITS.includes(character)) return null;
  }

  return Number(wholeText) * TENTHS_PER_UNIT + Number(decimalText);
}

/**
 * Whether `tenths` is a nearest multiple of a tenth to `value`.
 *
 * Rounding stated as a *property of the answer* rather than as a recomputation:
 * no multiple of a tenth lies strictly closer to the argument than the one
 * presented. That admits either tie-breaking direction at an exact half — a
 * genuine half is a value the double grid rarely holds, and the requirement asks
 * for one decimal place, not for a tie rule — while still ruling out a figure
 * that is off by a tenth, truncated instead of rounded, or unrelated to the
 * argument altogether.
 *
 * Written without `toFixed`, which is how the module gets its answer; agreement
 * is therefore evidence about the rounding and not about one standard-library
 * call.
 */
function roundedToOneDecimal(value: number, tenths: number): boolean {
  const distance = Math.abs(value * TENTHS_PER_UNIT - tenths);
  const below = Math.abs(value * TENTHS_PER_UNIT - (tenths - 1));
  const above = Math.abs(value * TENTHS_PER_UNIT - (tenths + 1));

  // A hair of slack for the multiplication itself: `value * 10` is not exact for
  // every double, and the claim is about the tenth chosen, not about that product.
  const slack = 1e-9;

  return distance <= below + slack && distance <= above + slack;
}

// --- helpers -----------------------------------------------------------------

/**
 * `formatWinPercentage` seen as a function of an unknown, so the totality the
 * module documents for a value that is not a number at all can be stated. It
 * guards on `typeof` before anything else; the cast exists only because the
 * declared parameter rules such a call out at compile time.
 */
const formatAnything = formatWinPercentage as unknown as (
  value: unknown,
) => string | null;

/** Whether a value is a percentage the module promises to present. */
const isPresentable = (value: number): boolean =>
  Number.isFinite(value) && value >= MIN_PERCENTAGE && value <= MAX_PERCENTAGE;

// --- generators --------------------------------------------------------------

/**
 * Percentages at and around every boundary the function turns on: both
 * endpoints, negative zero, the values whose first decimal is zero, the halves
 * that decide a rounding direction, and the figures a real record produces
 * (a third, two thirds, five of seven).
 */
const BOUNDARY_PERCENTAGES: readonly number[] = [
  0,
  -0,
  MAX_PERCENTAGE,
  Number.MIN_VALUE,
  Number.EPSILON,
  0.04,
  0.05,
  0.0499999,
  0.1,
  1,
  5,
  10,
  25,
  33.33333333333333, // 1 of 3
  50,
  66.66666666666667, // 2 of 3
  71.42857142857143, // 5 of 7
  90,
  99,
  99.9,
  99.94999999,
  99.95,
  99.99,
  99.99999999,
  100 - Number.EPSILON * 100,
];

/**
 * A percentage inside the closed range: the domain the presentation is total
 * over.
 *
 * Weighted across the shapes a Win_Percentage actually takes — a whole
 * percentage, a figure already on the one-decimal grid, a repeating fraction
 * from a small record, and a value whose first decimal is zero — so each branch
 * of the presentation is common rather than incidental.
 */
const inRangePercentageArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(...BOUNDARY_PERCENTAGES) },
  {
    weight: 4,
    arbitrary: fc.double({
      min: MIN_PERCENTAGE,
      max: MAX_PERCENTAGE,
      noNaN: true,
    }),
  },
  {
    weight: 3,
    arbitrary: fc.integer({ min: MIN_PERCENTAGE, max: MAX_PERCENTAGE }),
  },
  {
    weight: 3,
    arbitrary: fc
      .integer({ min: 0, max: MAX_PERCENTAGE * TENTHS_PER_UNIT })
      .map((tenths) => tenths / TENTHS_PER_UNIT),
  },
  {
    weight: 3,
    arbitrary: fc
      // A win count out of an appearance count: the percentages a record yields.
      .tuple(fc.integer({ min: 0, max: 60 }), fc.integer({ min: 1, max: 60 }))
      .map(([wins, played]) => (Math.min(wins, played) / played) * 100),
  },
  {
    weight: 3,
    arbitrary: fc
      // Values whose first decimal is zero, which must still show it.
      .tuple(
        fc.integer({ min: 0, max: MAX_PERCENTAGE - 1 }),
        fc.double({ min: 0, max: 0.0499, noNaN: true }),
      )
      .map(([whole, remainder]) => whole + remainder),
  },
);

/** Finite numbers outside the closed range, on both sides and at both edges. */
const outOfRangeArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.constantFrom(
      -Number.MIN_VALUE,
      -0.0000001,
      -0.04,
      -0.05,
      -1,
      -50,
      -100,
      100 + Number.EPSILON * 100,
      100.0000001,
      100.04,
      100.05,
      100.1,
      101,
      1000,
      12345.6,
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
    ),
  },
  { weight: 3, arbitrary: fc.double({ min: -1e6, max: -1e-6, noNaN: true }) },
  {
    weight: 3,
    arbitrary: fc.double({ min: 100.0000001, max: 1e6, noNaN: true }),
  },
  {
    weight: 2,
    arbitrary: fc
      .double({ noNaN: true })
      .filter((value) => !isPresentable(value) && Number.isFinite(value)),
  },
);

/** The three non-finite numbers, named outright. */
const NON_FINITE: readonly number[] = [
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
];

const nonFiniteArb: fc.Arbitrary<number> = fc.constantFrom(...NON_FINITE);

/**
 * Values of every type other than `number`, including the shapes a coercing
 * formatter would wrongly accept: a numeric string, a boxed number, a
 * one-element array holding a percentage, an object carrying one, and a bigint.
 */
const nonNumberArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      true,
      false,
      '',
      '0',
      '50',
      '66.7',
      '66.7%',
      'NaN',
      [],
      [50],
      [[50]],
      {},
      { value: 50 },
      50n,
      Symbol('50'),
      () => 50,
      new Map([['value', 50]]),
      new Set([50]),
      new Date(0),
      Object(50),
      Object.create(null),
      /50/,
    ),
  },
  { weight: 2, arbitrary: fc.string({ maxLength: 8 }) },
  { weight: 1, arbitrary: fc.boolean() },
  {
    weight: 3,
    arbitrary: fc
      .anything({ maxDepth: 2, withBigInt: true, withMap: true, withSet: true })
      .filter((value) => typeof value !== 'number'),
  },
);

/** Anything at all: the domain the function is actually total over. */
const anyCandidateArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 5, arbitrary: inRangePercentageArb },
  { weight: 4, arbitrary: outOfRangeArb },
  { weight: 2, arbitrary: nonFiniteArb },
  { weight: 5, arbitrary: nonNumberArb },
);

/* -------------------------------------------------------------------------- */
/* In range: exactly one decimal place                                        */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 24: Win percentage presentation is
// exactly one decimal place — every value in the closed range formats
// Validates: Requirements 6.3, 6.5
describe('formatWinPercentage — every percentage in range gets exactly one decimal place', () => {
  it('yields text of the presented form for every value in the closed range', () => {
    fc.assert(
      fc.property(inRangePercentageArb, (value) => {
        const text = formatWinPercentage(value);

        // Total over the whole range `readPercentage` accepts: every percentage
        // that reached the screen presents, so no in-range figure can fall
        // through to the no-value statement.
        expect(text, String(value)).not.toBeNull();
        if (text === null) return;

        expect(text, String(value)).toMatch(PRESENTED_FORM);
      }),
      { numRuns: 1000 },
    );
  });

  it('carries exactly one decimal digit — never none, never two', () => {
    fc.assert(
      fc.property(inRangePercentageArb, (value) => {
        const text = formatWinPercentage(value);
        if (text === null) return;

        const figure = text.slice(0, -PERCENTAGE_SIGN.length);
        const point = figure.indexOf('.');

        // `'50%'` and `'50.0%'` claim different precisions, and a column where
        // some figures carry a decimal and some do not is harder to compare.
        expect(point, text).not.toBe(-1);
        expect(figure.indexOf('.', point + 1), text).toBe(-1);
        expect(figure.length - point - 1, text).toBe(1);
      }),
      { numRuns: 1000 },
    );
  });

  it('names the argument: the digits are a nearest tenth to it', () => {
    fc.assert(
      fc.property(inRangePercentageArb, (value) => {
        const text = formatWinPercentage(value);
        if (text === null) return;

        const tenths = presentedTenths(text);

        // Read by splitting, not by `Number`, so only the presented form parses.
        expect(tenths, text).not.toBeNull();
        if (tenths === null) return;

        // Checked against a rounding statement rather than against `toFixed`,
        // the implementation's own route: truncation, an off-by-a-tenth, or a
        // figure unrelated to the argument all fail here.
        expect(roundedToOneDecimal(value, tenths), `${String(value)} -> ${text}`).toBe(
          true,
        );
      }),
      { numRuns: 1000 },
    );
  });

  it('shows the first decimal even when it is zero', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MIN_PERCENTAGE, max: MAX_PERCENTAGE }),
        (whole) => {
          // The requirement's sharp edge: a whole percentage is not presented as
          // a bare integer.
          expect(formatWinPercentage(whole)).toBe(`${String(whole)}.0%`);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('presents both endpoints and negative zero', () => {
    // Stated as examples as well as generated: the endpoints are where a
    // half-open comparison would exclude a legitimate percentage, and `-0` is a
    // value a percentage computation can produce and nobody should be shown.
    expect(formatWinPercentage(0)).toBe('0.0%');
    expect(formatWinPercentage(-0)).toBe('0.0%');
    expect(formatWinPercentage(100)).toBe('100.0%');
  });

  it('carries the percentage sign once, at the end, and no other notation', () => {
    fc.assert(
      fc.property(inRangePercentageArb, (value) => {
        const text = formatWinPercentage(value);
        if (text === null) return;

        // Requirements 6.3 and 10.4 ask for an explicit percentage indication,
        // and it belongs to the figure rather than to a sentence about it, so
        // neither call site has to append it.
        expect(text.endsWith(PERCENTAGE_SIGN), text).toBe(true);
        expect(text.indexOf(PERCENTAGE_SIGN), text).toBe(text.length - 1);
      }),
      { numRuns: 500 },
    );
  });

  it('carries no grouping separator, no sign, and no exponent', () => {
    fc.assert(
      fc.property(inRangePercentageArb, (value) => {
        const text = formatWinPercentage(value);
        if (text === null) return;

        // A locale-dependent formatter is what would introduce these: a comma
        // for the decimal point, a thin space as a group separator, or a
        // non-ASCII digit. `-0` would bring the sign.
        for (const forbidden of [',', '-', '+', 'e', 'E', ' ', '\u00a0', '\u202f']) {
          expect(text.includes(forbidden), `${text} contains ${forbidden}`).toBe(
            false,
          );
        }

        for (const character of text.slice(0, -PERCENTAGE_SIGN.length)) {
          if (character === '.') continue;

          expect(ASCII_DIGITS.includes(character), text).toBe(true);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('never presents a percentage above 100 or below 0', () => {
    fc.assert(
      fc.property(inRangePercentageArb, (value) => {
        const text = formatWinPercentage(value);
        if (text === null) return;

        const tenths = presentedTenths(text);
        if (tenths === null) return;

        // Rounding to one decimal place cannot carry an in-range figure out of
        // range; a presented 100.1% would be a figure nobody earned.
        expect(tenths, text).toBeGreaterThanOrEqual(0);
        expect(tenths, text).toBeLessThanOrEqual(MAX_PERCENTAGE * TENTHS_PER_UNIT);
      }),
      { numRuns: 500 },
    );
  });

  it('orders as the percentages order', () => {
    fc.assert(
      fc.property(
        inRangePercentageArb,
        inRangePercentageArb,
        (first, second) => {
          const [lower, higher] = first <= second ? [first, second] : [second, first];
          const lowerText = formatWinPercentage(lower);
          const higherText = formatWinPercentage(higher);

          if (lowerText === null || higherText === null) return;

          const lowerTenths = presentedTenths(lowerText);
          const higherTenths = presentedTenths(higherText);

          if (lowerTenths === null || higherTenths === null) return;

          // A correctly rounded figure is monotonic in its argument: the better
          // record never reads as the worse one.
          expect(lowerTenths).toBeLessThanOrEqual(higherTenths);
        },
      ),
      { numRuns: 500 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Out of range and not a number: no value at all                             */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 24: Win percentage presentation is
// exactly one decimal place — nothing outside the range yields a figure
// Validates: Requirements 6.4, 6.5
describe('formatWinPercentage — nothing outside the closed range yields a figure', () => {
  it('yields no value for a finite number outside the range', () => {
    fc.assert(
      fc.property(outOfRangeArb, (value) => {
        // Not clamped and not rounded into range: `100.1` presented as
        // `'100.0%'` would turn a backend fault into a figure that looks earned.
        // The caller renders the no-win-percentage statement instead, which is
        // also the presentation for an absent percentage (Requirement 6.4), so
        // the two are indistinguishable on screen.
        expect(formatWinPercentage(value), String(value)).toBeNull();
      }),
      { numRuns: 1000 },
    );
  });

  it('yields no value for NaN or either infinity', () => {
    fc.assert(
      fc.property(nonFiniteArb, (value) => {
        expect(formatWinPercentage(value), String(value)).toBeNull();
      }),
      { numRuns: 150 },
    );
  });

  it('yields no value for each non-finite number named outright', () => {
    for (const value of NON_FINITE) {
      expect({ value: String(value), text: formatWinPercentage(value) }).toEqual({
        value: String(value),
        text: null,
      });
    }
  });

  it('yields no value for an input that is not a number at all', () => {
    fc.assert(
      fc.property(nonNumberArb, (value) => {
        // Off the declared signature, but the module promises `null` rather than
        // a raise or a coerced reading: `'50'` is not a percentage this feature
        // accepts, and the Response_Parser rejects it upstream (Requirement
        // 13.5).
        expect(formatAnything(value)).toBeNull();
      }),
      { numRuns: 1000 },
    );
  });

  it('refuses the very edges of the range from outside', () => {
    // The two values nearest the endpoints from the wrong side: a half-open or
    // rounded-first comparison would admit them.
    expect(formatWinPercentage(-Number.MIN_VALUE)).toBeNull();
    expect(formatWinPercentage(-0.0001)).toBeNull();
    expect(formatWinPercentage(100 + Number.EPSILON * 100)).toBeNull();
    expect(formatWinPercentage(100.0001)).toBeNull();
  });

  it('decides presentability by the range alone, for every input', () => {
    fc.assert(
      fc.property(anyCandidateArb, (value) => {
        const text = formatAnything(value);
        const presentable =
          typeof value === 'number' ? isPresentable(value) : false;

        // The sharp form: the accepted set is exactly the finite numbers in the
        // closed range, stated against the range rather than against the
        // module's branches.
        expect(text === null, String(typeof value)).toBe(!presentable);
      }),
      { numRuns: 1000 },
    );
  });

  it('generates both verdicts, so neither claim is vacuous', () => {
    const sampled = fc.sample(anyCandidateArb, { numRuns: 500, seed: 24 });
    const presented = sampled.filter((value) => formatAnything(value) !== null);

    // Without this, a function returning a constant `null` would satisfy the
    // rejection properties against a generator that never produced a percentage.
    expect(presented.length).toBeGreaterThan(0);
    expect(sampled.length - presented.length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Determined solely by the argument                                          */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 24: Win percentage presentation is
// exactly one decimal place — the digits are determined solely by the argument
// Validates: Requirements 6.5
describe('formatWinPercentage — the digits are determined solely by the argument', () => {
  it('yields the same text on every call', () => {
    fc.assert(
      fc.property(anyCandidateArb, (value) => {
        expect(formatAnything(value)).toBe(formatAnything(value));
      }),
      { numRuns: 500 },
    );
  });

  it('depends on nothing but its argument', () => {
    fc.assert(
      fc.property(
        inRangePercentageArb,
        anyCandidateArb,
        (subject, other) => {
          const first = formatWinPercentage(subject);

          // Interleaving a call for another figure changes nothing, so the
          // module holds no state between the Record_Panel's percentage and the
          // entries of a Pairwise_Section.
          formatAnything(other);

          expect(formatWinPercentage(subject)).toBe(first);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('invokes no locale-dependent formatter', () => {
    const percentages = fc.sample(inRangePercentageArb, {
      numRuns: 200,
      seed: 65,
    });
    const expected = percentages.map((value) => formatWinPercentage(value));

    const realIntl = globalThis.Intl;
    const realNumberToLocaleString = Number.prototype.toLocaleString;
    const refuse = (): never => {
      throw new Error('a locale-dependent formatter was invoked');
    };

    const formatWithoutLocaleFormatters = (): readonly (string | null)[] => {
      try {
        // `Intl` would render `'66,7 %'` in one locale and `'66.7%'` in another,
        // and would group a figure by thousands — so the text a person reads,
        // and the text a test asserts, would depend on where the code ran. With
        // both routes replaced by throwing stand-ins, a module that reached for
        // either raises here instead of passing quietly in CI's locale.
        Object.defineProperty(globalThis, 'Intl', {
          configurable: true,
          value: new Proxy(
            {},
            {
              get: refuse,
              apply: refuse,
              construct: refuse,
            },
          ),
        });
        Number.prototype.toLocaleString = refuse;

        return percentages.map((value) => formatWinPercentage(value));
      } finally {
        Number.prototype.toLocaleString = realNumberToLocaleString;
        Object.defineProperty(globalThis, 'Intl', {
          configurable: true,
          value: realIntl,
        });
      }
    };

    const actual = formatWithoutLocaleFormatters();

    // Asserted after the stand-ins are gone, so a failure message can format
    // itself normally.
    expect(actual).toEqual(expected);
  });

  it('returns a string or null for every input, and raises nothing', () => {
    fc.assert(
      fc.property(anyCandidateArb, (value) => {
        // Total: a `typeof` test, two comparisons, and `toFixed` on a value
        // already known to be a finite number in range. Nothing is coerced, so
        // a hostile `toString` or `valueOf` never runs.
        const text = formatAnything(value);

        expect(text === null || typeof text === 'string').toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it('runs no conversion hook on the argument', () => {
    let hooksRun = 0;
    const hostile = {
      valueOf: () => {
        hooksRun += 1;

        return 50;
      },
      toString: () => {
        hooksRun += 1;

        return '50';
      },
      [Symbol.toPrimitive]: () => {
        hooksRun += 1;

        return 50;
      },
    };

    expect(formatAnything(hostile)).toBeNull();
    expect(hooksRun).toBe(0);
  });
});
