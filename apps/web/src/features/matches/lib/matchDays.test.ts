import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { anyDayAtThreshold, countsByDay } from './availability';
import {
  CANDIDATE_DAY_MAX_COUNT,
  LOCATION_MAX_LENGTH,
  chronological,
  dayParts,
  formatDay,
  headlineDayMs,
  localInputToInstantMs,
  validateDraft,
} from './matchDays';

const NOW = new Date(2030, 0, 1, 12, 0).getTime();

/** A `datetime-local` value for a local wall-clock time. */
function local(year: number, month: number, day: number, hour = 19, minute = 0): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

describe('localInputToInstantMs', () => {
  it('reads a well-formed value as that local wall-clock time', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2000, max: 2099 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        (year, month, day, hour, minute) => {
          const instant = localInputToInstantMs(local(year, month, day, hour, minute));
          const expected = new Date(year, month - 1, day, hour, minute);
          // A wall-clock time skipped by a daylight-saving change names nothing.
          if (expected.getHours() !== hour) {
            expect(instant).toBeNull();
          } else {
            expect(instant).toBe(expected.getTime());
          }
        },
      ),
    );
  });

  it('rejects an empty, malformed or impossible value', () => {
    for (const value of ['', ' ', '2030-02-30T19:00', '2030-13-01T19:00', '2030-01-01T24:00', '2030-01-01', 'tomorrow', '2030-01-01T19:00Z']) {
      expect(localInputToInstantMs(value)).toBeNull();
    }
  });
});

describe('validateDraft', () => {
  const valid = { location: '  Riverside 5s  ', days: [local(2030, 3, 2), '', local(2030, 3, 4)] };

  it('trims the location, ignores blank day fields, and sends ISO instants in order', () => {
    const result = validateDraft(valid, NOW);
    expect(result).toEqual({
      ok: true,
      location: 'Riverside 5s',
      candidateDays: [
        new Date(2030, 2, 2, 19).toISOString(),
        new Date(2030, 2, 4, 19).toISOString(),
      ],
    });
  });

  it('requires a location of at most the backend limit', () => {
    expect(validateDraft({ ...valid, location: '   ' }, NOW)).toMatchObject({
      ok: false,
      locationProblem: 'location-required',
    });
    expect(
      validateDraft({ ...valid, location: 'x'.repeat(LOCATION_MAX_LENGTH + 1) }, NOW),
    ).toMatchObject({ ok: false, locationProblem: 'location-too-long' });
    expect(validateDraft({ ...valid, location: 'x'.repeat(LOCATION_MAX_LENGTH) }, NOW).ok).toBe(
      true,
    );
  });

  it('names the first problem with the candidate days', () => {
    const problem = (days: string[]) =>
      (validateDraft({ location: 'Pitch', days }, NOW) as { daysProblem: string | null })
        .daysProblem;

    expect(problem([])).toBe('day-required');
    expect(problem(['', ' '])).toBe('day-required');
    expect(
      problem(
        Array.from({ length: CANDIDATE_DAY_MAX_COUNT + 1 }, (_, index) => local(2030, 4, index + 1)),
      ),
    ).toBe('too-many-days');
    expect(problem(['2030-02-30T19:00'])).toBe('day-invalid');
    expect(problem([local(2029, 12, 31)])).toBe('day-in-past');
    expect(problem([local(2030, 1, 1, 12, 0)])).toBe('day-in-past');
    expect(problem([local(2030, 3, 2), local(2030, 3, 2)])).toBe('day-duplicated');
  });

  it('accepts exactly the backend maximum of distinct future days', () => {
    const days = Array.from({ length: CANDIDATE_DAY_MAX_COUNT }, (_, index) =>
      local(2030, 4, index + 1),
    );
    const result = validateDraft({ location: 'Pitch', days }, NOW);
    expect(result.ok).toBe(true);
  });

  it('reports a location problem and a day problem together', () => {
    expect(validateDraft({ location: '', days: [] }, NOW)).toEqual({
      ok: false,
      locationProblem: 'location-required',
      daysProblem: 'day-required',
    });
  });
});

describe('ordering and headline days', () => {
  it('orders days chronologically without mutating the input', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 4_000_000_000_000 })), (days) => {
        const copy = [...days];
        const ordered = chronological(days);
        expect(days).toEqual(copy);
        expect([...ordered].sort((a, b) => a - b)).toEqual(ordered);
        expect([...ordered].sort()).toEqual([...days].sort());
      }),
    );
  });

  it('files a match under its confirmed day, else its earliest candidate day', () => {
    expect(headlineDayMs(5, [1, 2])).toBe(5);
    expect(headlineDayMs(null, [3, 1, 2])).toBe(1);
    expect(headlineDayMs(null, [])).toBeNull();
  });
});

describe('countsByDay', () => {
  it('counts every candidate day once, untallied days as zero, in day order', () => {
    expect(
      countsByDay(
        [30, 10, 20],
        [
          { dayMs: 20, count: 4 },
          { dayMs: 99, count: 7 },
        ],
      ),
    ).toEqual([
      { dayMs: 10, count: 0 },
      { dayMs: 20, count: 4 },
      { dayMs: 30, count: 0 },
    ]);
  });

  it('knows when any day has reached the threshold', () => {
    expect(anyDayAtThreshold([{ dayMs: 1, count: 9 }], 10)).toBe(false);
    expect(anyDayAtThreshold([{ dayMs: 1, count: 9 }, { dayMs: 2, count: 10 }], 10)).toBe(true);
    expect(anyDayAtThreshold([], 10)).toBe(false);
  });
});

describe('dayParts', () => {
  it('splits a day into the pieces formatDay writes', () => {
    const format = new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    });
    const instant = Date.UTC(2026, 9, 24, 19, 0);

    expect(dayParts(instant, format)).toEqual({ dow: 'Sat', num: '24', mon: 'Oct', time: '19:00' });
    expect(formatDay(instant, format)).toBe('Sat 24 Oct, 19:00');
  });
});
