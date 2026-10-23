import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseSquadExport } from './squadExport';

/**
 * The export Response_Parser keeps the backend's body exactly as it arrived (the
 * same object, so the saved file is the backend's document), takes the squad's
 * identity and name from it, rejects a body missing any of its three
 * collections, and settles any input without throwing.
 */

const exportBodyArb = fc.record({
  squadId: fc.uuid(),
  name: fc.string({ maxLength: 40 }),
  isPendingDeletion: fc.boolean(),
  purgeAt: fc.constant(null),
  memberships: fc.array(fc.object(), { maxLength: 3 }),
  invites: fc.array(fc.object(), { maxLength: 3 }),
  features: fc.array(fc.object(), { maxLength: 3 }),
});

describe('parseSquadExport', () => {
  it('keeps the body as sent and reads its identity and name', () => {
    fc.assert(
      fc.property(exportBodyArb, (body) => {
        const parsed = parseSquadExport(body);

        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
          expect(parsed.value.body).toBe(body);
          expect(parsed.value.squadId).toBe(body.squadId);
          expect(parsed.value.name).toBe(body.name);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('rejects a body missing any of its collections', () => {
    fc.assert(
      fc.property(
        exportBodyArb,
        fc.constantFrom('memberships', 'invites', 'features'),
        (body, collection) => {
          const broken: Record<string, unknown> = { ...body };
          delete broken[collection];
          expect(parseSquadExport(broken).ok).toBe(false);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('settles every input to a verdict without throwing', () => {
    fc.assert(
      fc.property(fc.anything(), (body) => {
        expect(typeof parseSquadExport(body).ok).toBe('boolean');
      }),
      { numRuns: 200 },
    );
  });
});
