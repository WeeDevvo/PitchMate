import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import { JUST_NOW_LABEL, relativeTimeLabel } from './relativeTime';

/**
 * Property tests for the App_Shell's single pure relative time label, placed
 * beside the module they cover as Requirement 14.2 asks, and run well above the
 * 100-iteration floor.
 *
 * These carry **Property 19: Relative time labels are deterministic and clamp
 * the future**:
 *
 *  - *for any creation instant at or before the injected current instant*, the
 *    label is non-empty and names the band the elapsed time falls in — under one
 *    minute below 60 seconds, whole minutes rounded down below 60 minutes, whole
 *    hours rounded down below 24 hours, whole days rounded down below 7 days,
 *    and the calendar date at 7 days or above (Requirement 5.5);
 *  - *for any creation instant after the injected current instant*, the label is
 *    the one for the smallest supported elapsed interval (Requirement 5.11);
 *  - *determinism and totality* — the same pair of inputs always yields the same
 *    non-empty label, the ambient clock is never read, and no input raises,
 *    `NaN`, the infinities, and unrepresentable instants included
 *    (Requirement 14.11).
 *
 * The band bounds and the elapsed counts are re-derived here from the acceptance
 * criteria in plain arithmetic rather than lifted from the module, and the
 * calendar date is checked by **parsing the label back** and comparing it with a
 * floor-to-day computation, so the test never restates the module's own
 * `Date`-component formatting as its expectation. What is asserted about the
 * lower bands is their *content* — the count and the unit named — not one fixed
 * phrasing, because the criteria fix the bands and the counts, not the wording;
 * the exact strings are pinned once in the boundary table below, where a
 * regression in phrasing is a deliberate, visible change.
 *
 * Every band boundary is generated directly (59_999 / 60_000, 3_599_999 /
 * 3_600_000, 86_399_999 / 86_400_000, 604_799_999 / 604_800_000) rather than
 * left to shrinking to discover.
 *
 * Validates: Requirements 5.5, 5.11, 14.11
 */

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/** The widest instant a date can represent, ±100,000,000 days from the epoch. */
const MAX_TIME_VALUE = 8_640_000_000_000_000;

const MONTH_NAMES = [
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
] as const;

/**
 * Current instants inside a plausible, comfortably representable window (2001
 * through 2096), so a creation instant derived by subtraction always has a
 * calendar date and the arithmetic in this file stays exact in integers.
 */
const nowArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.integer({ min: 1_000_000_000_000, max: 4_000_000_000_000 }),
  },
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      MS_PER_WEEK,
      1_700_000_000_000,
      1_741_780_800_000, // 12 Mar 2025, 12:00 UTC
      4_000_000_000_000,
    ),
  },
);

/**
 * Assert a label naming a whole count of a unit: `<count> <unit>[s] ago`, with
 * the count exactly as expected and the unit pluralised only above one.
 */
function expectCountLabel(label: string, count: number, unit: string): void {
  expect(label).not.toBe('');
  expect(label).toMatch(
    new RegExp(`^\\d+ ${unit}${count === 1 ? '' : 's'} ago$`),
  );
  expect(Number.parseInt(label, 10)).toBe(count);
  // A singular count never carries the plural unit, and vice versa.
  expect(label.includes(`${unit}s`)).toBe(count !== 1);
}

/**
 * Assert a label is the calendar date of `createdAtMs` in UTC, by parsing the
 * label back into an instant and comparing it with the UTC midnight of the
 * creation instant derived by floor division — arithmetic independent of the
 * `Date` components the module formats from.
 */
function expectCalendarDateLabel(label: string, createdAtMs: number): void {
  const parts = label.split(' ');
  expect(parts).toHaveLength(3);

  const [dayText, monthName, yearText] = parts;
  const monthIndex = MONTH_NAMES.indexOf(monthName as (typeof MONTH_NAMES)[number]);
  expect(monthIndex).toBeGreaterThanOrEqual(0);
  expect(dayText).toMatch(/^\d{1,2}$/);
  expect(yearText).toMatch(/^\d{4}$/);

  const labelled = new Date(0);
  labelled.setUTCFullYear(
    Number.parseInt(yearText, 10),
    monthIndex,
    Number.parseInt(dayText, 10),
  );

  const utcMidnightOfCreation = Math.floor(createdAtMs / MS_PER_DAY) * MS_PER_DAY;
  expect(labelled.getTime()).toBe(utcMidnightOfCreation);
}

describe('Property 19: relative time labels are deterministic and clamp the future', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('labels an elapsed time below 60 seconds as under one minute', () => {
    fc.assert(
      fc.property(
        nowArb,
        fc.oneof(
          { weight: 3, arbitrary: fc.integer({ min: 0, max: MS_PER_MINUTE - 1 }) },
          {
            weight: 2,
            arbitrary: fc.constantFrom(
              0,
              1,
              999,
              MS_PER_SECOND,
              59 * MS_PER_SECOND,
              MS_PER_MINUTE - 1,
            ),
          },
        ),
        (nowMs, elapsed) => {
          expect(relativeTimeLabel(nowMs - elapsed, nowMs)).toBe(JUST_NOW_LABEL);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('names the whole minutes rounded down from 60 seconds to below 60 minutes', () => {
    fc.assert(
      fc.property(
        nowArb,
        fc.oneof(
          { weight: 3, arbitrary: fc.integer({ min: MS_PER_MINUTE, max: MS_PER_HOUR - 1 }) },
          {
            weight: 2,
            arbitrary: fc.constantFrom(
              MS_PER_MINUTE,
              MS_PER_MINUTE + 1,
              2 * MS_PER_MINUTE - 1,
              119 * MS_PER_SECOND,
              5 * MS_PER_MINUTE,
              59 * MS_PER_MINUTE,
              MS_PER_HOUR - 1,
            ),
          },
        ),
        (nowMs, elapsed) => {
          const minutes = Math.floor(elapsed / MS_PER_MINUTE);
          expect(minutes).toBeGreaterThanOrEqual(1);
          expect(minutes).toBeLessThanOrEqual(59);

          expectCountLabel(relativeTimeLabel(nowMs - elapsed, nowMs), minutes, 'minute');
        },
      ),
      { numRuns: 500 },
    );
  });

  it('names the whole hours rounded down from 60 minutes to below 24 hours', () => {
    fc.assert(
      fc.property(
        nowArb,
        fc.oneof(
          { weight: 3, arbitrary: fc.integer({ min: MS_PER_HOUR, max: MS_PER_DAY - 1 }) },
          {
            weight: 2,
            arbitrary: fc.constantFrom(
              MS_PER_HOUR,
              MS_PER_HOUR + 1,
              2 * MS_PER_HOUR - 1,
              3 * MS_PER_HOUR,
              23 * MS_PER_HOUR,
              MS_PER_DAY - 1,
            ),
          },
        ),
        (nowMs, elapsed) => {
          const hours = Math.floor(elapsed / MS_PER_HOUR);
          expect(hours).toBeGreaterThanOrEqual(1);
          expect(hours).toBeLessThanOrEqual(23);

          expectCountLabel(relativeTimeLabel(nowMs - elapsed, nowMs), hours, 'hour');
        },
      ),
      { numRuns: 500 },
    );
  });

  it('names the whole days rounded down from 24 hours to below 7 days', () => {
    fc.assert(
      fc.property(
        nowArb,
        fc.oneof(
          { weight: 3, arbitrary: fc.integer({ min: MS_PER_DAY, max: MS_PER_WEEK - 1 }) },
          {
            weight: 2,
            arbitrary: fc.constantFrom(
              MS_PER_DAY,
              MS_PER_DAY + 1,
              2 * MS_PER_DAY - 1,
              6 * MS_PER_DAY,
              MS_PER_WEEK - 1,
            ),
          },
        ),
        (nowMs, elapsed) => {
          const days = Math.floor(elapsed / MS_PER_DAY);
          expect(days).toBeGreaterThanOrEqual(1);
          expect(days).toBeLessThanOrEqual(6);

          expectCountLabel(relativeTimeLabel(nowMs - elapsed, nowMs), days, 'day');
        },
      ),
      { numRuns: 500 },
    );
  });

  it('names the calendar date of the creation instant at 7 days or above', () => {
    fc.assert(
      fc.property(
        nowArb,
        fc.oneof(
          {
            weight: 3,
            arbitrary: fc.integer({ min: MS_PER_WEEK, max: 900_000_000_000 }),
          },
          {
            weight: 2,
            arbitrary: fc.constantFrom(
              MS_PER_WEEK,
              MS_PER_WEEK + 1,
              8 * MS_PER_DAY,
              30 * MS_PER_DAY,
              365 * MS_PER_DAY,
            ),
          },
        ),
        (nowMs, elapsed) => {
          const createdAtMs = nowMs - elapsed;
          fc.pre(createdAtMs >= 0);

          expectCalendarDateLabel(relativeTimeLabel(createdAtMs, nowMs), createdAtMs);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('clamps a creation instant after the injected current instant to the smallest band', () => {
    fc.assert(
      fc.property(
        nowArb,
        fc.oneof(
          { weight: 3, arbitrary: fc.integer({ min: 1, max: 4_000_000_000_000 }) },
          {
            weight: 2,
            arbitrary: fc.constantFrom(
              1,
              MS_PER_SECOND,
              MS_PER_MINUTE,
              MS_PER_HOUR,
              MS_PER_DAY,
              MS_PER_WEEK,
              365 * MS_PER_DAY,
            ),
          },
        ),
        (nowMs, ahead) => {
          // However far ahead the creation instant is, the label is the one for
          // the smallest supported elapsed interval — never a future reading and
          // never a calendar date (Requirement 5.11).
          expect(relativeTimeLabel(nowMs + ahead, nowMs)).toBe(JUST_NOW_LABEL);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('depends only on the elapsed time below 7 days, so shifting both instants changes nothing', () => {
    fc.assert(
      fc.property(
        nowArb,
        nowArb,
        fc.integer({ min: 0, max: MS_PER_WEEK - 1 }),
        (firstNow, secondNow, elapsed) => {
          expect(relativeTimeLabel(firstNow - elapsed, firstNow)).toBe(
            relativeTimeLabel(secondNow - elapsed, secondNow),
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  it('is deterministic and never reads the ambient clock', () => {
    fc.assert(
      fc.property(
        fc.double({ noDefaultInfinity: true, noNaN: true }),
        fc.double({ noDefaultInfinity: true, noNaN: true }),
        (createdAtMs, nowMs) => {
          const clock = vi.spyOn(Date, 'now').mockImplementation(() => {
            throw new Error('the ambient clock must never be read');
          });

          try {
            const first = relativeTimeLabel(createdAtMs, nowMs);

            expect(first).not.toBe('');
            expect(relativeTimeLabel(createdAtMs, nowMs)).toBe(first);
            expect(clock).not.toHaveBeenCalled();
          } finally {
            clock.mockRestore();
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it('yields a non-empty label and raises no exception for any pair of numbers (totality)', () => {
    const numberArb: fc.Arbitrary<number> = fc.oneof(
      { weight: 4, arbitrary: nowArb },
      { weight: 2, arbitrary: fc.double() },
      { weight: 2, arbitrary: fc.integer() },
      {
        weight: 2,
        arbitrary: fc.constantFrom(
          0,
          -0,
          Number.NaN,
          Number.POSITIVE_INFINITY,
          Number.NEGATIVE_INFINITY,
          Number.MIN_VALUE,
          Number.MAX_VALUE,
          Number.MAX_SAFE_INTEGER,
          -Number.MAX_SAFE_INTEGER,
          MAX_TIME_VALUE,
          MAX_TIME_VALUE + 1,
          -MAX_TIME_VALUE,
          -MAX_TIME_VALUE - 1,
        ),
      },
    );

    fc.assert(
      fc.property(numberArb, numberArb, (createdAtMs, nowMs) => {
        let label = '';
        expect(() => {
          label = relativeTimeLabel(createdAtMs, nowMs);
        }).not.toThrow();

        expect(typeof label).toBe('string');
        expect(label.length).toBeGreaterThan(0);
        expect(label.trim()).toBe(label);
      }),
      { numRuns: 1000 },
    );
  });

  it('falls back to the smallest band rather than an invalid date for an unrepresentable instant', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          -MAX_TIME_VALUE - 1,
          -MAX_TIME_VALUE - MS_PER_DAY,
          -1e16,
          -Number.MAX_VALUE,
        ),
        (createdAtMs) => {
          // Elapsed is far above 7 days, so this is the calendar date band, but
          // the instant has no calendar date; the label is still non-empty
          // (Requirement 14.11).
          expect(relativeTimeLabel(createdAtMs, 0)).toBe(JUST_NOW_LABEL);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('holds every stated band boundary exactly', () => {
    // The bounds and the phrasing are the contract (Requirement 5.5), pinned
    // here literally because the generated properties read the counts from the
    // same arithmetic the module uses and so could not catch a shifted bound.
    const now = 1_741_780_800_000; // 12 Mar 2025, 12:00 UTC

    const cases: readonly [elapsed: number, label: string][] = [
      [0, 'Just now'],
      [MS_PER_MINUTE - 1, 'Just now'],
      [MS_PER_MINUTE, '1 minute ago'],
      [2 * MS_PER_MINUTE - 1, '1 minute ago'],
      [2 * MS_PER_MINUTE, '2 minutes ago'],
      [MS_PER_HOUR - 1, '59 minutes ago'],
      [MS_PER_HOUR, '1 hour ago'],
      [2 * MS_PER_HOUR - 1, '1 hour ago'],
      [3 * MS_PER_HOUR, '3 hours ago'],
      [MS_PER_DAY - 1, '23 hours ago'],
      [MS_PER_DAY, '1 day ago'],
      [2 * MS_PER_DAY - 1, '1 day ago'],
      [6 * MS_PER_DAY, '6 days ago'],
      [MS_PER_WEEK - 1, '6 days ago'],
      [MS_PER_WEEK, '5 Mar 2025'],
      [MS_PER_WEEK + MS_PER_DAY, '4 Mar 2025'],
      [-1, 'Just now'],
      [-MS_PER_WEEK, 'Just now'],
    ];

    for (const [elapsed, expected] of cases) {
      expect(relativeTimeLabel(now - elapsed, now)).toBe(expected);
    }

    expect(JUST_NOW_LABEL).toBe('Just now');
  });
});
