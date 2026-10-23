import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { GUEST_CLAIM_STATUS_NAMES } from '../wireEnums';
import {
  parseAcceptedGuestClaim,
  parseGuestClaimPreview,
  parseGuestClaimRows,
  parseIssuedClaimLink,
  printGuestClaimRows,
  printIssuedClaimLink,
  type GuestClaimRow,
  type IssuedClaimLink,
} from './guestClaim';

/**
 * The guest-claim Response_Parsers: every printed body parses back to the same
 * value, rows in order; any input settles to a verdict without throwing; a
 * status the contract doesn't name, or an instant with no UTC designator, fails
 * the body; and a list with one bad row is rejected whole.
 */

const instantMsArb = fc
  .integer({ min: Date.UTC(2000, 0, 1) / 1000, max: Date.UTC(2200, 0, 1) / 1000 })
  .map((seconds) => seconds * 1000);

const linkArb: fc.Arbitrary<IssuedClaimLink> = fc.record({
  claimId: fc.uuid(),
  redeemableLink: fc.webUrl(),
  expiresAtMs: instantMsArb,
});

const rowArb: fc.Arbitrary<GuestClaimRow> = fc.record({
  membershipId: fc.uuid(),
  status: fc.constantFrom(...GUEST_CLAIM_STATUS_NAMES),
  expiresAtMs: fc.option(instantMsArb, { nil: null }),
  acceptedByName: fc.option(fc.string({ maxLength: 30 }), { nil: null }),
});

describe('parseIssuedClaimLink', () => {
  it('gives back every printed link', () => {
    fc.assert(
      fc.property(linkArb, (link) => {
        expect(parseIssuedClaimLink(printIssuedClaimLink(link))).toEqual({ ok: true, value: link });
      }),
      { numRuns: 200 },
    );
  });

  it('rejects an empty link and an expiry without a UTC offset', () => {
    fc.assert(
      fc.property(linkArb, (link) => {
        const printed = printIssuedClaimLink(link) as Record<string, unknown>;

        expect(parseIssuedClaimLink({ ...printed, redeemableLink: '' }).ok).toBe(false);
        expect(
          parseIssuedClaimLink({
            ...printed,
            expiresAt: new Date(link.expiresAtMs).toISOString().replace('Z', ''),
          }).ok,
        ).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

describe('parseGuestClaimRows', () => {
  it('gives back every printed list, rows in order', () => {
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 8 }), (rows) => {
        expect(parseGuestClaimRows(printGuestClaimRows(rows))).toEqual({ ok: true, value: rows });
      }),
      { numRuns: 200 },
    );
  });

  it('rejects the whole list when any row carries a status the contract does not name', () => {
    fc.assert(
      fc.property(
        fc.array(rowArb, { minLength: 1, maxLength: 6 }),
        fc.nat(),
        fc.string().filter((value) => !(GUEST_CLAIM_STATUS_NAMES as readonly string[]).includes(value)),
        (rows, where, status) => {
          const printed = printGuestClaimRows(rows) as Record<string, unknown>[];
          const index = where % printed.length;
          printed[index] = { ...printed[index], status };

          expect(parseGuestClaimRows(printed).ok).toBe(false);
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe('every guest-claim parser', () => {
  it('settles every input to a verdict without throwing', () => {
    fc.assert(
      fc.property(fc.anything(), (body) => {
        for (const parse of [
          parseIssuedClaimLink,
          parseGuestClaimRows,
          parseGuestClaimPreview,
          parseAcceptedGuestClaim,
        ]) {
          expect(typeof parse(body).ok).toBe('boolean');
        }
      }),
      { numRuns: 300 },
    );
  });

  it('reads a preview and an accepted claim, and rejects them without their names', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (squadName, guestDisplayName) => {
        expect(parseGuestClaimPreview({ squadName, guestDisplayName })).toEqual({
          ok: true,
          value: { squadName, guestDisplayName },
        });
        expect(parseAcceptedGuestClaim({ squadName })).toEqual({ ok: true, value: { squadName } });
        expect(parseGuestClaimPreview({ squadName }).ok).toBe(false);
        expect(parseAcceptedGuestClaim({}).ok).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
