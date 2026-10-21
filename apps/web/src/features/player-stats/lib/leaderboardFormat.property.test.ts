import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  LEADERBOARD_STATISTIC_LABELS,
  LEADERBOARD_STATISTIC_ORDER,
  competitionPositions,
  formatLeaderboardValue,
} from './leaderboardFormat';
import { formatWinPercentage } from './numberFormat';
import { LEADERBOARD_STATISTIC_NAMES } from './wireEnums';

/**
 * Property tests for leaderboard presentation.
 *
 * Positions follow standard competition ranking over values already in rank
 * order: one position per entry, the first at 1, never decreasing, level values
 * sharing a position, and every other entry at its own place in the list. Values
 * read as the profile screen reads the same statistic.
 */

/** Values in descending order, as the backend sends a board, with ties likely. */
const rankedValuesArb: fc.Arbitrary<number[]> = fc
  .array(fc.integer({ min: 0, max: 8 }), { maxLength: 24 })
  .map((values) => [...values].sort((a, b) => b - a));

describe('competitionPositions', () => {
  it('gives one position per value, starting at 1 and never decreasing', () => {
    fc.assert(
      fc.property(rankedValuesArb, (values) => {
        const positions = competitionPositions(values);

        expect(positions).toHaveLength(values.length);
        if (values.length > 0) {
          expect(positions[0]).toBe(1);
        }
        for (let index = 1; index < positions.length; index += 1) {
          expect(positions[index]).toBeGreaterThanOrEqual(positions[index - 1]!);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('shares a position between level values and otherwise uses the place in the list', () => {
    fc.assert(
      fc.property(rankedValuesArb, (values) => {
        const positions = competitionPositions(values);

        values.forEach((value, index) => {
          if (index > 0 && values[index - 1] === value) {
            expect(positions[index]).toBe(positions[index - 1]);
          } else {
            expect(positions[index]).toBe(index + 1);
          }
        });
      }),
      { numRuns: 200 },
    );
  });

  it('numbers a board with no ties 1 to n', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer(), { maxLength: 20 }), (unique) => {
        const values = [...unique].sort((a, b) => b - a);

        expect(competitionPositions(values)).toEqual(values.map((_, index) => index + 1));
      }),
      { numRuns: 100 },
    );
  });
});

describe('formatLeaderboardValue', () => {
  it('reads a win percentage exactly as the profile screen does', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 100, noNaN: true }), (value) => {
        expect(formatLeaderboardValue('WinPercentage', value)).toBe(formatWinPercentage(value));
      }),
      { numRuns: 200 },
    );
  });

  it('reads every other statistic as its digits', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...LEADERBOARD_STATISTIC_NAMES.filter((name) => name !== 'WinPercentage')),
        fc.integer({ min: -5_000, max: 1_000_000 }),
        (statistic, value) => {
          expect(formatLeaderboardValue(statistic, value)).toBe(String(value));
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('the switcher vocabulary', () => {
  it('offers every statistic exactly once, rating first', () => {
    expect([...LEADERBOARD_STATISTIC_ORDER].sort()).toEqual([...LEADERBOARD_STATISTIC_NAMES].sort());
    expect(new Set(LEADERBOARD_STATISTIC_ORDER).size).toBe(LEADERBOARD_STATISTIC_ORDER.length);
    expect(LEADERBOARD_STATISTIC_ORDER[0]).toBe('DisplayRating');
  });

  it('names every board, with no two boards sharing a name', () => {
    const labels = LEADERBOARD_STATISTIC_NAMES.map((name) => LEADERBOARD_STATISTIC_LABELS[name]);

    for (const label of labels) {
      expect(label.trim().length).toBeGreaterThan(0);
    }
    expect(new Set(labels).size).toBe(labels.length);
  });
});
