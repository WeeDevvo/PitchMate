import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { guestClaimEntries, guestClaimViewFor } from './guestClaimView';
import type { GuestClaimRow } from './parse/guestClaim';
import { GUEST_CLAIM_STATUS_NAMES, MEMBERSHIP_STATE_NAMES } from './wireEnums';

/**
 * Properties of the admins' claim-list view:
 *
 * - a viewer without admin authority is offered nothing, whatever the row;
 * - a claim in flight decides the view whatever the row, so an admin always
 *   sees a link out, an accepted claim or a completed one;
 * - with no claim, only an active, non-erased guest is offered a link;
 * - the list keeps the rows' order, holds no row whose view is `none`, and
 *   holds every row whose view isn't.
 */

const rowArb = fc.record({
  membershipId: fc.uuid(),
  isGuest: fc.boolean(),
  state: fc.constantFrom(...MEMBERSHIP_STATE_NAMES),
  isFormerPlayer: fc.boolean(),
});

const claimFor = (membershipId: string): fc.Arbitrary<GuestClaimRow> =>
  fc.record({
    membershipId: fc.constant(membershipId),
    status: fc.constantFrom(...GUEST_CLAIM_STATUS_NAMES),
    expiresAtMs: fc.option(fc.integer({ min: 0, max: 4_102_444_800_000 }), { nil: null }),
    acceptedByName: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
  });

const VIEW_BY_STATUS = {
  LinkIssued: 'link-issued',
  LinkExpired: 'link-expired',
  Accepted: 'accepted',
  Claimed: 'claimed',
} as const;

describe('guestClaimViewFor', () => {
  it('offers nothing to a viewer without admin authority', () => {
    fc.assert(
      fc.property(
        rowArb,
        rowArb.chain((row) => fc.option(claimFor(row.membershipId), { nil: undefined })),
        (row, claim) => {
          expect(guestClaimViewFor(row, claim, false)).toEqual({ kind: 'none' });
        },
      ),
      { numRuns: 200 },
    );
  });

  it('lets a claim in flight decide the view, whatever the row', () => {
    fc.assert(
      fc.property(
        rowArb.chain((row) => fc.tuple(fc.constant(row), claimFor(row.membershipId))),
        ([row, claim]) => {
          const view = guestClaimViewFor(row, claim, true);

          expect(view.kind).toBe(VIEW_BY_STATUS[claim.status]);
          if (view.kind === 'accepted') {
            expect(view.acceptedByName).toBe(claim.acceptedByName);
          }
          if (view.kind === 'link-issued') {
            expect(view.expiresAtMs).toBe(claim.expiresAtMs);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('offers a link, with no claim, exactly to an active guest who was not erased', () => {
    fc.assert(
      fc.property(rowArb, (row) => {
        const linkable = row.isGuest && row.state === 'Active' && !row.isFormerPlayer;

        expect(guestClaimViewFor(row, undefined, true).kind).toBe(linkable ? 'unclaimed' : 'none');
      }),
      { numRuns: 200 },
    );
  });
});

describe('guestClaimEntries', () => {
  it('keeps the rows order and exactly the rows with something to show', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(rowArb, { selector: (row) => row.membershipId, maxLength: 10 }),
        fc.boolean(),
        fc.nat(),
        (rows, viewerIsAdmin, seed) => {
          // Give some rows a claim, chosen deterministically from the seed.
          const claims: GuestClaimRow[] = rows
            .filter((_, index) => (seed >> index) % 2 === 1)
            .map((row, index) => ({
              membershipId: row.membershipId,
              status: GUEST_CLAIM_STATUS_NAMES[index % GUEST_CLAIM_STATUS_NAMES.length]!,
              expiresAtMs: null,
              acceptedByName: null,
            }));

          const entries = guestClaimEntries(rows, claims, viewerIsAdmin);
          const expected = rows.filter(
            (row) =>
              guestClaimViewFor(
                row,
                claims.find((claim) => claim.membershipId === row.membershipId),
                viewerIsAdmin,
              ).kind !== 'none',
          );

          expect(entries.map((entry) => entry.row)).toEqual(expected);
          expect(entries.every((entry) => entry.view.kind !== 'none')).toBe(true);
          if (!viewerIsAdmin) {
            expect(entries).toEqual([]);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
