/**
 * Candidate days collected through the tiles: the tiles offer today and the 27
 * days after it, one per calendar day across a daylight-saving change; slots
 * read in date-then-time order; a picked day without a time is reported before
 * anything is sent; and a complete set of slots is checked and sent exactly as
 * `validateDraft` would check and send the same days typed in by hand.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  CANDIDATE_WINDOW_DAYS,
  earliestTime,
  orderedSlots,
  pickedDates,
  upcomingDates,
  validateSlots,
  type CandidateSlot,
} from './candidateSlots';
import { validateDraft } from './matchDays';

/** A local midday, so the tests read the same in every time zone they run in. */
const NOW = new Date(2026, 9, 20, 12, 0, 0).getTime();

describe('upcomingDates', () => {
  it('offers today and the days after it, one tile per calendar day, in order', () => {
    const tiles = upcomingDates(NOW);

    expect(tiles).toHaveLength(CANDIDATE_WINDOW_DAYS);
    expect(tiles[0].date).toBe('2026-10-20');
    expect(tiles[CANDIDATE_WINDOW_DAYS - 1].date).toBe('2026-11-16');
    // The UK clocks change on 25 October 2026; no day is skipped or repeated.
    expect(new Set(tiles.map((tile) => tile.date)).size).toBe(CANDIDATE_WINDOW_DAYS);
    expect([...tiles.map((tile) => tile.date)].sort()).toEqual(tiles.map((tile) => tile.date));
  });

  it('names each tile by its weekday, day and month', () => {
    const [today] = upcomingDates(NOW, 1, new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }));

    expect(today).toEqual({ date: '2026-10-20', dow: 'Tue', num: '20', mon: 'Oct', label: 'Tue 20 Oct' });
  });
});

describe('slots', () => {
  const slot = (id: number, date: string, time: string): CandidateSlot => ({ id, date, time });

  it('lists the picked dates once each, and the slots by date then time', () => {
    const slots = [slot(1, '2026-10-22', '19:30'), slot(2, '2026-10-21', ''), slot(3, '2026-10-22', '18:00')];

    expect(pickedDates(slots)).toEqual(['2026-10-21', '2026-10-22']);
    expect(orderedSlots(slots).map((each) => each.id)).toEqual([2, 3, 1]);
  });

  it('shows the earliest time set on a date on its tile, and nothing until one is set', () => {
    const slots = [slot(1, '2026-10-22', '19:30'), slot(2, '2026-10-22', '18:00'), slot(3, '2026-10-23', '')];

    expect(earliestTime(slots, '2026-10-22')).toBe('18:00');
    expect(earliestTime(slots, '2026-10-23')).toBeUndefined();
    expect(earliestTime(slots, '2026-10-24')).toBeUndefined();
  });

  it('reports a picked day with no time before anything else about the days', () => {
    const result = validateSlots('Hackney Marshes', [slot(1, '2026-10-22', '19:00'), slot(2, '2026-10-23', '')], NOW);

    expect(result).toEqual({ ok: false, locationProblem: null, daysProblem: 'time-required' });
  });

  it('checks complete slots exactly as the same days typed by hand', () => {
    const dateArb = fc.integer({ min: -2, max: CANDIDATE_WINDOW_DAYS }).map((offset) => {
      const day = new Date(2026, 9, 20 + offset);
      return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    });
    const timeArb = fc
      .tuple(fc.integer({ min: 0, max: 23 }), fc.constantFrom(0, 15, 30, 45))
      .map(([hour, minute]) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);

    fc.assert(
      fc.property(
        fc.string({ maxLength: 8 }),
        fc.array(fc.tuple(dateArb, timeArb), { maxLength: 16 }),
        (location, picks) => {
          const slots = picks.map(([date, time], index) => slot(index, date, time));
          expect(validateSlots(location, slots, NOW)).toEqual(
            validateDraft({ location, days: picks.map(([date, time]) => `${date}T${time}`) }, NOW),
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
