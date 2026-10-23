import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  parsePendingDeletionSquadList,
  parseSquadDeletion,
  printPendingDeletionSquadList,
  printSquadDeletion,
  type PendingDeletionSquad,
} from './squadDeletion';

/**
 * The squad-deletion Response_Parsers: every printed body parses back to the
 * same value, entries in order; any input settles to a verdict without
 * throwing; and a purge instant with no UTC designator, or one bad entry, fails
 * the whole body.
 */

/** Whole-second instants across a wide range, as the backend writes them. */
const instantMsArb = fc
  .integer({ min: Date.UTC(2000, 0, 1) / 1000, max: Date.UTC(2200, 0, 1) / 1000 })
  .map((seconds) => seconds * 1000);

const pendingSquadArb: fc.Arbitrary<PendingDeletionSquad> = fc.record({
  squadId: fc.uuid(),
  name: fc.string({ maxLength: 40 }),
  purgeAtMs: instantMsArb,
});

describe('parseSquadDeletion', () => {
  it('gives back every printed deletion', () => {
    fc.assert(
      fc.property(instantMsArb, (purgeAtMs) => {
        const parsed = parseSquadDeletion(printSquadDeletion({ purgeAtMs }));
        expect(parsed).toEqual({ ok: true, value: { purgeAtMs } });
      }),
      { numRuns: 200 },
    );
  });

  it('rejects a purge instant written without a UTC offset', () => {
    fc.assert(
      fc.property(instantMsArb, (purgeAtMs) => {
        const local = new Date(purgeAtMs).toISOString().replace('Z', '');
        expect(parseSquadDeletion({ purgeAt: local }).ok).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('settles every input to a verdict without throwing', () => {
    fc.assert(
      fc.property(fc.anything(), (body) => {
        expect(typeof parseSquadDeletion(body).ok).toBe('boolean');
      }),
      { numRuns: 200 },
    );
  });
});

describe('parsePendingDeletionSquadList', () => {
  it('gives back every printed list, entries in order', () => {
    fc.assert(
      fc.property(fc.array(pendingSquadArb, { maxLength: 8 }), (squads) => {
        const parsed = parsePendingDeletionSquadList(printPendingDeletionSquadList(squads));
        expect(parsed).toEqual({ ok: true, value: squads });
      }),
      { numRuns: 200 },
    );
  });

  it('rejects the whole list when any entry is missing a member', () => {
    fc.assert(
      fc.property(
        fc.array(pendingSquadArb, { minLength: 1, maxLength: 6 }),
        fc.nat(),
        fc.constantFrom('squadId', 'name', 'purgeAt'),
        (squads, where, member) => {
          const printed = printPendingDeletionSquadList(squads) as Record<string, unknown>[];
          const index = where % printed.length;
          const broken = { ...printed[index] };
          delete broken[member];
          printed[index] = broken;

          expect(parsePendingDeletionSquadList(printed).ok).toBe(false);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('settles every input to a verdict without throwing', () => {
    fc.assert(
      fc.property(fc.anything(), (body) => {
        expect(typeof parsePendingDeletionSquadList(body).ok).toBe('boolean');
      }),
      { numRuns: 200 },
    );
  });
});
