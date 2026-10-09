// Feature: web-player-stats-screen, Property 23: Instant presentation is determined solely by the instant
// Validates: Requirements 8.9

import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';

import { formatInstantDate } from './instantFormat';
import { MAX_INSTANT_MS } from './parse/primitives';

/**
 * Property tests for the feature's one instant presentation function, placed
 * beside the module they cover and running well above the 100-iteration floor
 * (Requirement 14.5).
 *
 * Property 23 says the text a Progression_Table row carries is a function of
 * **the instant and nothing else**. Four things could make that false, and each
 * gets its own section below:
 *
 * 1. **The call itself.** A formatter that read a clock, memoised, or mutated a
 *    pattern's `lastIndex` would answer differently on a second call. Asserted
 *    by repeating the call and by comparing against an oracle.
 * 2. **The ambient time zone.** `process.env.TZ` is set to each of six zones —
 *    including one at a positive offset (`Pacific/Kiritimati`, UTC+14) and one
 *    at a negative offset (`America/Los_Angeles`, UTC-8) — and the text must not
 *    move. The zone change is proved to have taken effect first
 *    ({@link observedOffsetMinutes}), so a runtime that ignored `TZ` would fail
 *    the non-vacuity test rather than pass this one silently.
 * 3. **The ambient locale.** Two independent checks: the locale environment
 *    variables are varied (cheap, and inert on a runtime whose ICU default is
 *    fixed at startup — so it carries little weight on its own), and every
 *    locale-dependent API the module could possibly reach is **replaced with a
 *    throwing stub** for the duration of a call. The second is the one that
 *    bites: if `formatInstantDate` ever grows a `toLocaleDateString` or an
 *    `Intl.DateTimeFormat`, the sabotage test fails immediately.
 * 4. **The day boundary.** An instant minutes either side of UTC midnight is
 *    where a zone-local date and a UTC date disagree, so those pairs are
 *    generated deliberately and asserted to format by their **UTC** date — the
 *    trade-off the module documents.
 *
 * The expected text comes from {@link oracleText}, which derives the UTC
 * calendar date **without a date value at all** — Howard Hinnant's
 * `civil_from_days`, plus its own month-name table. Reusing `Date.prototype`
 * getters or the module's table would make the oracle agree with any
 * implementation that was internally consistent, including one that had drifted
 * onto zone-local fields.
 *
 * Totality is stated over the whole of `number` and beyond it: `NaN`, both
 * infinities, instants past {@link MAX_INSTANT_MS}, and values that are not
 * numbers at all must each yield a string. The fallback text is **read from the
 * module** rather than transcribed, so the copy can change without touching this
 * file; what is asserted is that it is one fixed string and that it cannot be
 * mistaken for a date.
 */

// --- The form, the units, and the oracle -------------------------------------

const MS_PER_DAY = 86_400_000;

/**
 * The `D MMM YYYY` form: a day of one or two digits with no leading zero, a
 * single space, a three-letter English month, a single space, and a year that
 * may carry a minus sign at the far ends of the representable range.
 *
 * Anchored at both ends, so trailing whitespace or a stray separator fails.
 */
const DATE_FORM =
  /^(?:[1-9]|[12]\d|3[01]) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (?:0|-?[1-9]\d*)$/;

/** The month names the oracle spells, written out independently of the module. */
const ORACLE_MONTHS: readonly string[] = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

interface CivilDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * The UTC civil date of an epoch millisecond count, computed without a date
 * value: Hinnant's `civil_from_days`, which is exact for every day in the
 * representable range and for the proleptic Gregorian years before 1970.
 *
 * The day count is taken by rounding and then correcting the remainder rather
 * than by dividing and flooring. Every intermediate is then an exact integer
 * below 2^53, so the two ends of the range — where a floored float division is
 * within an ulp of the wrong day — are decided by integer arithmetic instead.
 */
function civilFromEpochMs(instantMs: number): CivilDate {
  // A date value truncates its argument toward zero; the oracle must too, or the
  // two would disagree for a fractional count.
  const truncated = Math.trunc(instantMs);

  let days = Math.round(truncated / MS_PER_DAY);
  const remainder = truncated - days * MS_PER_DAY;
  if (remainder < 0) days -= 1;
  else if (remainder >= MS_PER_DAY) days += 1;

  // Shift the era so the leap day lands at the end of the year.
  const shifted = days + 719_468;
  const era = Math.floor(shifted / 146_097);
  const dayOfEra = shifted - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const shiftedYear = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra -
    (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
  const month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;

  return { year: month <= 2 ? shiftedYear + 1 : shiftedYear, month, day };
}

/** The text a representable instant must format as, derived independently. */
function oracleText(instantMs: number): string {
  const { year, month, day } = civilFromEpochMs(instantMs);
  const monthName = ORACLE_MONTHS[month - 1];

  // The oracle's own arithmetic is checked here: a month outside 1..12 would
  // mean the algorithm, not the module, is wrong.
  expect(monthName).toBeDefined();

  return `${String(day)} ${monthName ?? '?'} ${String(year)}`;
}

/** Whether a value is an instant the module can place on a calendar. */
const isRepresentable = (instantMs: number): boolean =>
  Number.isFinite(instantMs) && Math.abs(instantMs) <= MAX_INSTANT_MS;

/**
 * `formatInstantDate` seen as a function of an unknown, so the totality the
 * module documents for a value that is not a number at all can be stated. It
 * guards on `typeof` before anything else; the cast exists only because the
 * declared parameter rules such a call out at compile time.
 */
const formatAnything = formatInstantDate as unknown as (
  value: unknown,
) => string;

/**
 * The module's text for an unrepresentable instant, read from the module rather
 * than transcribed, so this file asserts the *shape* of the fallback (one fixed
 * string, not a date) and not a particular wording.
 */
const UNREPRESENTABLE_TEXT = formatInstantDate(Number.NaN);

// --- The ambient time zone ---------------------------------------------------

/** The zone the suite started in, restored after every test. */
const ORIGINAL_TZ = process.env.TZ;

/** The locale environment the suite started in, restored after every test. */
const LOCALE_ENV_NAMES = ['LANG', 'LANGUAGE', 'LC_ALL', 'LC_TIME'] as const;
const ORIGINAL_LOCALE_ENV = LOCALE_ENV_NAMES.map(
  (name) => [name, process.env[name]] as const,
);

/**
 * Zones spanning both sides of UTC, with an uneven offset and a southern-summer
 * DST rule thrown in: a formatter reading zone-local fields would answer
 * differently under at least one of them for most instants.
 */
const TIME_ZONES: readonly string[] = [
  'UTC',
  'Pacific/Kiritimati', // UTC+14, the furthest ahead
  'Asia/Kolkata', // UTC+05:30, not a whole hour
  'Europe/London', // UTC+00/+01, so the offset moves within the year
  'America/Los_Angeles', // UTC-08/-07
  'Pacific/Marquesas', // UTC-09:30
];

function setEnvironmentValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function restoreEnvironment(): void {
  setEnvironmentValue('TZ', ORIGINAL_TZ);
  for (const [name, value] of ORIGINAL_LOCALE_ENV) {
    setEnvironmentValue(name, value);
  }
}

/** Runs `body` with the ambient zone set to `zone`, then restores it. */
function withTimeZone<T>(zone: string, body: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = zone;

  try {
    return body();
  } finally {
    setEnvironmentValue('TZ', previous);
  }
}

/**
 * The runtime's offset, in minutes west of UTC, for a fixed instant — the
 * observable that proves a `TZ` change took effect.
 */
const OFFSET_PROBE_MS = Date.UTC(2026, 0, 15, 12, 0, 0);

const observedOffsetMinutes = (zone: string): number =>
  withTimeZone(zone, () => new Date(OFFSET_PROBE_MS).getTimezoneOffset());

/** The zone-local calendar day of an instant: the value a UTC date must ignore. */
const localDayOfMonth = (zone: string, instantMs: number): number =>
  withTimeZone(zone, () => new Date(instantMs).getDate());

// --- The ambient locale ------------------------------------------------------

/** Locale environments to vary across; values deliberately unlike each other. */
const LOCALE_ENVIRONMENTS: readonly string[] = [
  'C',
  'en_US.UTF-8',
  'en_GB.UTF-8',
  'de_DE.UTF-8',
  'ja_JP.UTF-8',
  'ar_EG.UTF-8',
];

/** Runs `body` with every locale environment variable set to `locale`. */
function withLocaleEnvironment<T>(locale: string, body: () => T): T {
  const previous = LOCALE_ENV_NAMES.map(
    (name) => [name, process.env[name]] as const,
  );

  for (const name of LOCALE_ENV_NAMES) {
    process.env[name] = locale;
  }

  try {
    return body();
  } finally {
    for (const [name, value] of previous) {
      setEnvironmentValue(name, value);
    }
  }
}

/**
 * Every locale-dependent API the module could reach, replaced by a stub that
 * throws, for the duration of one call.
 *
 * This is the load-bearing half of the locale claim. The environment-variable
 * test above cannot fail on a runtime that fixes its default locale at startup,
 * so on its own it would be vacuous; a throwing `Intl` cannot be ignored. The
 * returned record also says which stubs were touched, so the failure names the
 * API rather than only the raise.
 *
 * Nothing but `formatInstantDate` is invoked inside the block: `expect` itself
 * may format a number or a date, and asserting under the sabotage would blame
 * the test harness for the test's own doing.
 */
interface SabotageOutcome<T> {
  readonly value: T | undefined;
  readonly raised: unknown;
  readonly touched: readonly string[];
}

function withLocaleApisSabotaged<T>(body: () => T): SabotageOutcome<T> {
  const touched: string[] = [];

  const explode = (name: string) =>
    function sabotaged(): never {
      touched.push(name);
      throw new Error(`locale-dependent API invoked: ${name}`);
    };

  const savedDateMethods = {
    toLocaleDateString: Date.prototype.toLocaleDateString,
    toLocaleString: Date.prototype.toLocaleString,
    toLocaleTimeString: Date.prototype.toLocaleTimeString,
  };
  const savedNumberToLocaleString = Number.prototype.toLocaleString;
  const savedArrayToLocaleString = Array.prototype.toLocaleString;
  const savedIntl: unknown = Reflect.get(globalThis, 'Intl');

  Date.prototype.toLocaleDateString = explode('Date.toLocaleDateString');
  Date.prototype.toLocaleString = explode('Date.toLocaleString');
  Date.prototype.toLocaleTimeString = explode('Date.toLocaleTimeString');
  Number.prototype.toLocaleString = explode('Number.toLocaleString');
  Array.prototype.toLocaleString = explode('Array.toLocaleString');

  const intlTrap = new Proxy(
    {},
    {
      get(_target, property) {
        touched.push(`Intl.${String(property)}`);
        throw new Error(`locale-dependent API invoked: Intl.${String(property)}`);
      },
    },
  );
  Object.defineProperty(globalThis, 'Intl', {
    value: intlTrap,
    configurable: true,
    writable: true,
    enumerable: false,
  });

  let value: T | undefined;
  let raised: unknown;

  try {
    value = body();
  } catch (error) {
    raised = error;
  } finally {
    Date.prototype.toLocaleDateString = savedDateMethods.toLocaleDateString;
    Date.prototype.toLocaleString = savedDateMethods.toLocaleString;
    Date.prototype.toLocaleTimeString = savedDateMethods.toLocaleTimeString;
    Number.prototype.toLocaleString = savedNumberToLocaleString;
    Array.prototype.toLocaleString = savedArrayToLocaleString;
    Object.defineProperty(globalThis, 'Intl', {
      value: savedIntl,
      configurable: true,
      writable: true,
      enumerable: false,
    });
  }

  return { value, raised, touched };
}

// --- Generators --------------------------------------------------------------

/** 1970-01-01, and the instants that have historically broken date arithmetic. */
const BOUNDARY_INSTANTS: readonly number[] = [
  0,
  -0,
  1,
  -1,
  0.5,
  -0.5,
  999.999,
  -999.999,
  MS_PER_DAY,
  MS_PER_DAY - 1,
  -MS_PER_DAY,
  -1_000,
  Date.UTC(1970, 0, 1),
  Date.UTC(1969, 11, 31, 23, 59, 59, 999),
  Date.UTC(1900, 1, 28), // 1900 is not a leap year
  Date.UTC(1900, 2, 1),
  Date.UTC(2000, 1, 29), // 2000 is
  Date.UTC(2024, 1, 29),
  Date.UTC(2024, 1, 29, 23, 59, 59, 999),
  Date.UTC(2024, 2, 1),
  Date.UTC(2025, 11, 25),
  Date.UTC(2026, 0, 1),
  Date.UTC(2026, 1, 1),
  Date.UTC(2026, 11, 31, 23, 59, 59, 999),
  Date.UTC(1, 0, 1),
  MAX_INSTANT_MS,
  -MAX_INSTANT_MS,
  MAX_INSTANT_MS - 1,
  -MAX_INSTANT_MS + 1,
];

/** The largest whole day index inside the representable range. */
const MAX_DAY_INDEX = Math.floor(MAX_INSTANT_MS / MS_PER_DAY);

/**
 * The era in which every zone in {@link TIME_ZONES} has a settled offset: 1970
 * to 2100. Used only where a test asserts something about a zone's offset; the
 * formatting properties themselves run over the whole representable range.
 */
const MODERN_FIRST_DAY_INDEX = 1;
const MODERN_LAST_DAY_INDEX = Math.floor(Date.UTC(2100, 0, 1) / MS_PER_DAY);

/**
 * A representable instant, weighted across the ranges that matter: the decade a
 * Progression_Point actually falls in, the whole of the modern era, the extremes
 * of the representable range, and instants a hair either side of UTC midnight.
 */
const representableInstantArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(...BOUNDARY_INSTANTS) },
  {
    weight: 5,
    arbitrary: fc.integer({
      min: Date.UTC(2020, 0, 1),
      max: Date.UTC(2030, 0, 1),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.integer({
      min: Date.UTC(1900, 0, 1),
      max: Date.UTC(2100, 0, 1),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.integer({ min: -MAX_INSTANT_MS, max: MAX_INSTANT_MS }),
  },
  {
    // Either side of a UTC midnight, where a zone-local reading would disagree.
    weight: 4,
    arbitrary: fc
      .tuple(
        fc.integer({ min: -MAX_DAY_INDEX + 1, max: MAX_DAY_INDEX - 1 }),
        fc.integer({ min: -60_000, max: 60_000 }),
      )
      .map(([dayIndex, nudge]) => dayIndex * MS_PER_DAY + nudge),
  },
  {
    weight: 2,
    arbitrary: fc
      .double({ min: -MAX_INSTANT_MS, max: MAX_INSTANT_MS, noNaN: true })
      .filter(isRepresentable),
  },
);

/**
 * Values outside the representable range, the fallback's whole domain.
 *
 * Filtered through {@link isRepresentable} rather than trusted: at this
 * magnitude a double's spacing is a whole millisecond, so `MAX_INSTANT_MS + 0.5`
 * rounds *back onto* the bound and is a perfectly good instant. Naming such a
 * value here would assert the fallback for an instant the module can place.
 */
const unrepresentableNumberArb: fc.Arbitrary<number> = fc
  .oneof(
    {
      weight: 6,
      arbitrary: fc.constantFrom(
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        MAX_INSTANT_MS + 1,
        -MAX_INSTANT_MS - 1,
        MAX_INSTANT_MS + 0.5,
        MAX_INSTANT_MS * 2,
        1e18,
        -1e18,
        Number.MAX_VALUE,
        -Number.MAX_VALUE,
        Number.MAX_SAFE_INTEGER,
        Number.MIN_SAFE_INTEGER,
      ),
    },
    {
      weight: 4,
      arbitrary: fc.integer({
        min: MAX_INSTANT_MS + 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
    },
    {
      weight: 4,
      arbitrary: fc.integer({
        min: Number.MIN_SAFE_INTEGER,
        max: -MAX_INSTANT_MS - 1,
      }),
    },
  )
  .filter((value) => !isRepresentable(value));

/** Values that are not numbers at all: off the signature, inside the promise. */
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
      '2026-02-01T00:00:00Z',
      1_767_225_600_000n,
      [],
      [0],
      {},
      { instantMs: 0 },
      new Date(0),
      Object(0),
      Symbol('instant'),
      () => 0,
      Object.create(null),
      new Map(),
      new Set(),
      // A hostile conversion: a coercing formatter would run this.
      {
        valueOf() {
          throw new Error('valueOf must not run');
        },
      },
      {
        toString() {
          throw new Error('toString must not run');
        },
      },
    ),
  },
  {
    weight: 3,
    arbitrary: fc
      .anything({ maxDepth: 2, withBigInt: true, withMap: true, withSet: true })
      .filter((value) => typeof value !== 'number'),
  },
);

afterEach(() => {
  // A leaked TZ or LANG would quietly change the next test file's world.
  restoreEnvironment();
});

/* -------------------------------------------------------------------------- */
/* The text is the UTC calendar date, and nothing else                        */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 23: Instant presentation is
// determined solely by the instant — the text is the instant's UTC date
// Validates: Requirements 8.9
describe('the formatted instant is its UTC calendar date', () => {
  it('agrees with an independently derived UTC date for every representable instant', () => {
    fc.assert(
      fc.property(representableInstantArb, (instantMs) => {
        // The oracle uses no date value and its own month table, so agreement
        // means the module read UTC fields rather than merely being consistent.
        expect(formatInstantDate(instantMs)).toBe(oracleText(instantMs));
      }),
      { numRuns: 2000 },
    );
  });

  it('emits the fixed D MMM YYYY form, with no padding and no separator', () => {
    fc.assert(
      fc.property(representableInstantArb, (instantMs) => {
        const text = formatInstantDate(instantMs);

        expect(text).toMatch(DATE_FORM);
        // Exactly two single spaces: no locale would be so obliging.
        expect(text.split(' ')).toHaveLength(3);
        expect(text).not.toMatch(/[/,.]/);
        expect(text.trim()).toBe(text);
      }),
      { numRuns: 1000 },
    );
  });

  it('truncates a fractional millisecond toward zero rather than rounding it', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -MAX_DAY_INDEX + 1, max: MAX_DAY_INDEX - 1 }),
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        (dayIndex, fraction) => {
          // The instant a date value names is the truncation of its argument, so
          // a sub-millisecond fraction may never carry the date onto the next
          // day — rounding at 999.5 ms would do exactly that at a boundary.
          const midnight = dayIndex * MS_PER_DAY;

          expect(formatInstantDate(midnight + fraction)).toBe(
            formatInstantDate(midnight),
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  it('formats a fractional instant as the instant it truncates to', () => {
    fc.assert(
      fc.property(
        representableInstantArb,
        fc.double({ min: -0.999, max: 0.999, noNaN: true }),
        (instantMs, fraction) => {
          const fractional = instantMs + fraction;
          fc.pre(isRepresentable(fractional));

          // Stated over both signs: truncation toward zero moves a negative
          // instant later and a positive one earlier, and the module must agree
          // with the date value it builds either way.
          expect(formatInstantDate(fractional)).toBe(
            formatInstantDate(Math.trunc(fractional)),
          );
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('distinguishes every distinct UTC day', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -MAX_DAY_INDEX + 1, max: MAX_DAY_INDEX - 1 }),
        (dayIndex) => {
          // Not a tautology of the oracle: two neighbouring days must not
          // collapse onto one label, which a truncated or clamped field would do.
          const text = formatInstantDate(dayIndex * MS_PER_DAY);

          expect(formatInstantDate((dayIndex + 1) * MS_PER_DAY)).not.toBe(text);
          expect(formatInstantDate((dayIndex - 1) * MS_PER_DAY)).not.toBe(text);
        },
      ),
      { numRuns: 500 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Repetition                                                                 */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 23: Instant presentation is
// determined solely by the instant — the call is a pure function
// Validates: Requirements 8.9
describe('the same instant yields the same text on every call', () => {
  it('answers identically on repeated invocation', () => {
    fc.assert(
      fc.property(representableInstantArb, (instantMs) => {
        const first = formatInstantDate(instantMs);

        // Four calls rather than two: a memoised, clock-reading, or
        // `lastIndex`-carrying implementation tends to drift on a later pass.
        expect(formatInstantDate(instantMs)).toBe(first);
        expect(formatInstantDate(instantMs)).toBe(first);
        expect(formatInstantDate(instantMs)).toBe(first);
      }),
      { numRuns: 1000 },
    );
  });

  it('answers identically for the unrepresentable, too', () => {
    fc.assert(
      fc.property(unrepresentableNumberArb, (value) => {
        const first = formatInstantDate(value);

        expect(formatInstantDate(value)).toBe(first);
      }),
      { numRuns: 500 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The ambient time zone                                                      */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 23: Instant presentation is
// determined solely by the instant — the ambient zone is not an input
// Validates: Requirements 8.9
describe('the ambient time zone does not reach the text', () => {
  it('observes a different offset in each zone, so the zone change is real', () => {
    // Non-vacuity. Were `TZ` ignored by the runtime, every zone test below would
    // pass while proving nothing; this is the test that would fail instead.
    const offsets = TIME_ZONES.map((zone) => observedOffsetMinutes(zone));

    expect(offsets).toContain(0); // UTC
    // `getTimezoneOffset` counts minutes *west* of UTC, so ahead of UTC is
    // negative: Kiritimati must be, Los Angeles must not.
    expect(observedOffsetMinutes('Pacific/Kiritimati')).toBeLessThan(0);
    expect(observedOffsetMinutes('America/Los_Angeles')).toBeGreaterThan(0);
    expect(observedOffsetMinutes('Asia/Kolkata') % 60).not.toBe(0);
    expect(new Set(offsets).size).toBeGreaterThanOrEqual(5);
  });

  it('yields one text across every zone', () => {
    fc.assert(
      fc.property(representableInstantArb, (instantMs) => {
        const texts = TIME_ZONES.map((zone) =>
          withTimeZone(zone, () => formatInstantDate(instantMs)),
        );

        for (const [index, text] of texts.entries()) {
          expect(text, TIME_ZONES[index]).toBe(oracleText(instantMs));
        }
      }),
      { numRuns: 500 },
    );
  });

  it('restores the starting zone after each run', () => {
    withTimeZone('Pacific/Kiritimati', () => formatInstantDate(0));

    expect(process.env.TZ).toBe(ORIGINAL_TZ);
  });
});

/* -------------------------------------------------------------------------- */
/* The day boundary                                                           */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 23: Instant presentation is
// determined solely by the instant — a day boundary formats by its UTC date
// Validates: Requirements 8.9
describe('instants either side of a UTC day boundary format by their UTC date', () => {
  it('labels the last millisecond of a day and the first of the next distinctly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -MAX_DAY_INDEX + 2, max: MAX_DAY_INDEX - 2 }),
        (dayIndex) => {
          const midnight = dayIndex * MS_PER_DAY;
          const lastMoment = midnight - 1;

          for (const zone of TIME_ZONES) {
            const [beforeText, afterText] = withTimeZone(
              zone,
              () =>
                [
                  formatInstantDate(lastMoment),
                  formatInstantDate(midnight),
                ] as const,
            );

            expect(beforeText, zone).toBe(oracleText(lastMoment));
            expect(afterText, zone).toBe(oracleText(midnight));
            expect(beforeText, zone).not.toBe(afterText);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('ignores a zone-local date that has already turned over', () => {
    fc.assert(
      fc.property(
        // The modern era, where the zone database states a settled offset for
        // each of the six zones. The property holds beyond it, but the
        // non-vacuity check below would be asserting against a historical
        // offset — `Pacific/Kiritimati` sat at UTC-10:40 until 1995, so the
        // 1969 boundary straddles nothing there.
        fc.integer({ min: MODERN_FIRST_DAY_INDEX, max: MODERN_LAST_DAY_INDEX }),
        (dayIndex) => {
          const midnight = dayIndex * MS_PER_DAY;
          const lastMoment = midnight - 1;
          const utcDay = civilFromEpochMs(midnight).day;
          const previousUtcDay = civilFromEpochMs(lastMoment).day;

          // Non-vacuity: one of the two instants really does fall on a
          // different calendar day in at least one of these zones than it does
          // in UTC, which is the disagreement the module resolves in UTC's
          // favour. Any zone ahead of UTC turns the earlier instant over; any
          // zone behind it turns the later one over.
          const turnsOver = TIME_ZONES.some(
            (zone) =>
              localDayOfMonth(zone, lastMoment) !== previousUtcDay ||
              localDayOfMonth(zone, midnight) !== utcDay,
          );

          expect(turnsOver).toBe(true);

          // And the text follows the UTC date in every zone regardless.
          for (const zone of TIME_ZONES) {
            expect(
              withTimeZone(zone, () => formatInstantDate(lastMoment)),
              zone,
            ).toBe(oracleText(lastMoment));
            expect(
              withTimeZone(zone, () => formatInstantDate(midnight)),
              zone,
            ).toBe(oracleText(midnight));
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('labels a match completed late in the evening by its UTC day', () => {
    // The trade-off the module documents, as a worked example rather than a
    // generated one: 23:30 on 1 February in Kiritimati (UTC+14) is 09:30 UTC on
    // the same date, and 16:30 on 31 January in Los Angeles (UTC-8) is 00:30 UTC
    // on 1 February. Both label as the UTC date.
    const sameDay = Date.UTC(2026, 1, 1, 9, 30);
    const crossesBack = Date.UTC(2026, 1, 1, 0, 30);

    expect(localDayOfMonth('Pacific/Kiritimati', sameDay)).toBe(1);
    expect(localDayOfMonth('America/Los_Angeles', crossesBack)).toBe(31);

    expect(
      withTimeZone('Pacific/Kiritimati', () => formatInstantDate(sameDay)),
    ).toBe('1 Feb 2026');
    expect(
      withTimeZone('America/Los_Angeles', () => formatInstantDate(crossesBack)),
    ).toBe('1 Feb 2026');
  });
});

/* -------------------------------------------------------------------------- */
/* The ambient locale                                                         */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 23: Instant presentation is
// determined solely by the instant — the ambient locale is not an input
// Validates: Requirements 8.9
describe('the ambient locale does not reach the text', () => {
  it('yields one text across every locale environment', () => {
    fc.assert(
      fc.property(representableInstantArb, (instantMs) => {
        for (const locale of LOCALE_ENVIRONMENTS) {
          const text = withLocaleEnvironment(locale, () =>
            formatInstantDate(instantMs),
          );

          expect(text, locale).toBe(oracleText(instantMs));
        }
      }),
      { numRuns: 300 },
    );
  });

  it('yields one text across every zone and locale together', () => {
    fc.assert(
      fc.property(
        representableInstantArb,
        fc.constantFrom(...TIME_ZONES),
        fc.constantFrom(...LOCALE_ENVIRONMENTS),
        (instantMs, zone, locale) => {
          const text = withLocaleEnvironment(locale, () =>
            withTimeZone(zone, () => formatInstantDate(instantMs)),
          );

          expect(text, `${zone} / ${locale}`).toBe(oracleText(instantMs));
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('formats with every locale-dependent API replaced by a throwing stub', () => {
    fc.assert(
      fc.property(representableInstantArb, (instantMs) => {
        // The call happens under the sabotage; the assertions happen after it is
        // lifted, because `expect` itself may format a number or a date and a
        // raise from the harness would be mistaken for a raise from the module.
        const outcome = withLocaleApisSabotaged(() =>
          formatInstantDate(instantMs),
        );

        expect(outcome.touched, String(instantMs)).toStrictEqual([]);
        expect(outcome.raised, String(instantMs)).toBeUndefined();
        expect(outcome.value, String(instantMs)).toBe(oracleText(instantMs));
      }),
      { numRuns: 500 },
    );
  });

  it('has the sabotage genuinely in place', () => {
    // Non-vacuity for the test above: the stubs must really throw, or it would
    // pass against a module riddled with `Intl`.
    const outcome = withLocaleApisSabotaged(() =>
      new Date(0).toLocaleDateString(),
    );

    expect(outcome.raised).toBeInstanceOf(Error);
    expect(outcome.touched).toStrictEqual(['Date.toLocaleDateString']);

    const intlOutcome = withLocaleApisSabotaged(() =>
      new Intl.DateTimeFormat().format(0),
    );

    expect(intlOutcome.raised).toBeInstanceOf(Error);
    expect(intlOutcome.touched).toStrictEqual(['Intl.DateTimeFormat']);

    // And restored afterwards, or every later test would be formatting through
    // a stub.
    expect(() => new Date(0).toLocaleDateString()).not.toThrow();
  });

  it('differs from what a locale-dependent formatter would have produced', () => {
    // The hazard is real, not hypothetical: a locale formatter on the very same
    // instant produces text of another shape entirely, which is the output
    // Requirement 8.9 rules out.
    const instantMs = Date.UTC(2026, 1, 1, 12, 0, 0);
    const ours = formatInstantDate(instantMs);

    expect(ours).toBe('1 Feb 2026');
    expect(new Date(instantMs).toLocaleDateString('en-US')).not.toBe(ours);
  });
});

/* -------------------------------------------------------------------------- */
/* Totality                                                                   */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 23: Instant presentation is
// determined solely by the instant — every input yields a string
// Validates: Requirements 8.9
describe('every input yields a string without raising', () => {
  it('answers with one fixed text for every unrepresentable number', () => {
    fc.assert(
      fc.property(unrepresentableNumberArb, (value) => {
        const text = formatInstantDate(value);

        expect(typeof text).toBe('string');
        expect(text).toBe(UNREPRESENTABLE_TEXT);
      }),
      { numRuns: 1000 },
    );
  });

  it('answers with a string for a value that is not a number at all', () => {
    fc.assert(
      fc.property(nonNumberArb, (value) => {
        // Nothing here may be coerced: two of the generated objects raise from
        // `valueOf` and `toString` if a conversion is attempted.
        const text = formatAnything(value);

        expect(typeof text).toBe('string');
        expect(text).toBe(UNREPRESENTABLE_TEXT);
      }),
      { numRuns: 1000 },
    );
  });

  it('states an absence rather than asserting a date it cannot place', () => {
    // A fallback that read as a date — the epoch, an empty cell, '1 Jan 1970' —
    // would put a figure on the Progression_Table that no match carries.
    expect(UNREPRESENTABLE_TEXT.length).toBeGreaterThan(0);
    expect(UNREPRESENTABLE_TEXT.trim()).toBe(UNREPRESENTABLE_TEXT);
    expect(UNREPRESENTABLE_TEXT).not.toMatch(DATE_FORM);
    expect(UNREPRESENTABLE_TEXT).not.toMatch(/\d/);

    fc.assert(
      fc.property(representableInstantArb, (instantMs) => {
        // And is never the text a real instant formats as.
        expect(formatInstantDate(instantMs)).not.toBe(UNREPRESENTABLE_TEXT);
      }),
      { numRuns: 500 },
    );
  });

  it('answers the same for the unrepresentable in every zone and locale', () => {
    fc.assert(
      fc.property(
        unrepresentableNumberArb,
        fc.constantFrom(...TIME_ZONES),
        fc.constantFrom(...LOCALE_ENVIRONMENTS),
        (value, zone, locale) => {
          const text = withLocaleEnvironment(locale, () =>
            withTimeZone(zone, () => formatInstantDate(value)),
          );

          expect(text, `${zone} / ${locale}`).toBe(UNREPRESENTABLE_TEXT);
        },
      ),
      { numRuns: 500 },
    );
  });
});
