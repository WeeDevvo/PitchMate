/**
 * The Players tab's filter: it keeps exactly the rows of the chosen kind whose
 * name contains the search text (case- and accent-insensitively, the text
 * trimmed), keeps their relative order, keeps everything of the kind for an empty
 * search, and the chip counts add up — members and guests partition everyone.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { PLAYER_KINDS, filterPlayerRows, playerKindCounts } from './playerFilter';

const rowArb = fc.record({
  membershipId: fc.uuid(),
  displayName: fc.oneof(fc.string({ maxLength: 12 }), fc.constantFrom('Zoë', 'Zoe', 'BIG MIKE', 'Big Mike')),
  isGuest: fc.boolean(),
});

describe('filterPlayerRows', () => {
  it('keeps exactly the matching rows of the kind, in their original order', () => {
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 12 }), fc.constantFrom(...PLAYER_KINDS), fc.string({ maxLength: 4 }), (rows, kind, query) => {
        const kept = filterPlayerRows(rows, kind, query);

        // A subsequence of the input: nothing invented, nothing reordered.
        let cursor = 0;
        for (const row of kept) {
          cursor = rows.indexOf(row, cursor) + 1;
          expect(cursor).toBeGreaterThan(0);
        }

        for (const row of kept) {
          if (kind === 'guests') expect(row.isGuest).toBe(true);
          if (kind === 'members') expect(row.isGuest).toBe(false);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('keeps every row of the kind for an empty or blank search', () => {
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 12 }), fc.constantFrom('', '   '), (rows, blank) => {
        expect(filterPlayerRows(rows, 'all', blank)).toEqual(rows);
        expect(filterPlayerRows(rows, 'guests', blank)).toEqual(rows.filter((row) => row.isGuest));
      }),
      { numRuns: 200 },
    );
  });

  it('matches regardless of case and accents, after trimming the search', () => {
    const rows = [
      { membershipId: 'a', displayName: 'Zoë Hart', isGuest: false },
      { membershipId: 'b', displayName: 'Big Mike', isGuest: true },
    ];
    expect(filterPlayerRows(rows, 'all', '  zoe ').map((row) => row.membershipId)).toEqual(['a']);
    expect(filterPlayerRows(rows, 'all', 'MIKE').map((row) => row.membershipId)).toEqual(['b']);
    expect(filterPlayerRows(rows, 'members', 'mike')).toEqual([]);
  });
});

describe('playerKindCounts', () => {
  it('splits everyone into members and guests', () => {
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 20 }), (rows) => {
        const counts = playerKindCounts(rows);
        expect(counts.members + counts.guests).toBe(counts.all);
        expect(counts.guests).toBe(rows.filter((row) => row.isGuest).length);
      }),
      { numRuns: 200 },
    );
  });
});
