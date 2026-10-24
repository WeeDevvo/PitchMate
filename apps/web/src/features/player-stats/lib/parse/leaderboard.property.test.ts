import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  wireCountArb,
  wireDisplayNameArb,
  wireDisplayRatingArb,
  wireIdentityArb,
  wirePercentageArb,
} from '../../testing/playerProfileFixtures';
import {
  LEADERBOARD_STATISTIC_NAMES,
  type LeaderboardStatistic,
} from '../wireEnums';
import {
  parseLeaderboard,
  printLeaderboard,
  type Leaderboard,
} from './leaderboard';

/**
 * Property tests for the leaderboard Response_Parser.
 *
 * 1. **Round trip.** Printing any valid board and parsing it back, for the
 *    statistic it ranks by, gives the same board, entries in the same order.
 * 2. **Totality.** Any value at all settles to a verdict and nothing throws.
 * 3. **The requested statistic only.** A well-formed board ranking by any other
 *    statistic is rejected, so one board's figures never appear under another's
 *    name.
 * 4. **Values are held to their statistic.** A count statistic rejects a
 *    fraction or a negative, a percentage rejects a value outside 0 to 100, and
 *    one bad entry rejects the whole board.
 */

const statisticArb: fc.Arbitrary<LeaderboardStatistic> = fc.constantFrom(
  ...LEADERBOARD_STATISTIC_NAMES,
);

/** A value the contract admits for `statistic`. */
function valueArbFor(statistic: LeaderboardStatistic): fc.Arbitrary<number> {
  switch (statistic) {
    case 'WinPercentage':
      return wirePercentageArb;
    case 'DisplayRating':
      return wireDisplayRatingArb;
    default:
      return wireCountArb;
  }
}

/** A valid board for one statistic. */
function boardArbFor(statistic: LeaderboardStatistic): fc.Arbitrary<Leaderboard> {
  return fc
    .array(
      fc.record({
        membershipId: wireIdentityArb,
        displayName: wireDisplayNameArb,
        value: valueArbFor(statistic),
      }),
      { maxLength: 16 },
    )
    .map((entries) => ({ statistic, entries }));
}

const boardArb: fc.Arbitrary<Leaderboard> = statisticArb.chain(boardArbFor);

const COUNT_STATISTICS: readonly LeaderboardStatistic[] = [
  'Appearances',
  'WinStreak',
  'UnbeatenStreak',
  'BibAppearances',
];

describe('parseLeaderboard', () => {
  it('gives back every printed board, entries in order', () => {
    fc.assert(
      fc.property(boardArb, (board) => {
        const parsed = parseLeaderboard(printLeaderboard(board), board.statistic);

        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
          expect(parsed.value.statistic).toBe(board.statistic);
          expect(parsed.value.entries.map((entry) => entry.membershipId)).toEqual(
            board.entries.map((entry) => entry.membershipId),
          );
          expect(parsed.value).toEqual(board);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('settles every input to a verdict without throwing', () => {
    fc.assert(
      fc.property(fc.anything(), statisticArb, (body, statistic) => {
        const parsed = parseLeaderboard(body, statistic);

        expect(typeof parsed.ok).toBe('boolean');
      }),
      { numRuns: 300 },
    );
  });

  it('rejects a board ranking by any statistic other than the one requested', () => {
    fc.assert(
      fc.property(
        statisticArb,
        statisticArb,
        fc.array(
          fc.record({ membershipId: wireIdentityArb, displayName: wireDisplayNameArb }),
          { maxLength: 4 },
        ),
        (sent, requested, people) => {
          fc.pre(sent !== requested);
          // Zero is a valid value for every statistic, so only the name differs.
          const body = {
            statistic: sent,
            entries: people.map((person) => ({ ...person, value: 0 })),
          };

          expect(parseLeaderboard(body, sent).ok).toBe(true);
          expect(parseLeaderboard(body, requested).ok).toBe(false);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('rejects a fraction or a negative on a count board, and the whole board with it', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...COUNT_STATISTICS),
        fc.oneof(
          fc.integer({ min: -1_000, max: -1 }),
          fc.double({ min: 0.01, max: 400, noNaN: true }).filter((value) => !Number.isInteger(value)),
        ),
        boardArb,
        fc.nat(),
        (statistic, badValue, valid, where) => {
          const entries = valid.entries.map((entry) => ({ ...entry, value: 0 }));
          const index = where % (entries.length + 1);
          const bad = {
            membershipId: '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b',
            displayName: 'Dave',
            value: badValue,
          };
          entries.splice(index, 0, bad);

          expect(parseLeaderboard({ statistic, entries }, statistic).ok).toBe(false);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('rejects a win percentage outside 0 to 100', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.double({ min: 100.0001, max: 1e6, noNaN: true }),
          fc.double({ min: -1e6, max: -0.0001, noNaN: true }),
        ),
        (value) => {
          const body = {
            statistic: 'WinPercentage',
            entries: [
              {
                membershipId: '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b',
                displayName: 'Dave',
                value,
              },
            ],
          };

          expect(parseLeaderboard(body, 'WinPercentage').ok).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects an entry missing any of its three members', () => {
    fc.assert(
      fc.property(
        boardArb.filter((board) => board.entries.length > 0),
        fc.constantFrom('membershipId', 'displayName', 'value'),
        fc.nat(),
        (board, member, where) => {
          const printed = printLeaderboard(board) as {
            statistic: string;
            entries: Record<string, unknown>[];
          };
          const index = where % printed.entries.length;
          const broken = { ...printed.entries[index] };
          delete broken[member];
          printed.entries[index] = broken;

          expect(parseLeaderboard(printed, board.statistic).ok).toBe(false);
        },
      ),
      { numRuns: 150 },
    );
  });
});
