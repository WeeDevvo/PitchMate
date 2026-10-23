import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { confirmsSquadName } from './deletionConfirmation';

/**
 * The typed-name gate on deleting a squad accepts the squad's own name, with or
 * without surrounding whitespace, and nothing else: no other name, no change of
 * letter case, and never an empty or whitespace-only entry.
 */

/** Squad names as people write them: non-blank, possibly padded by a paste. */
const squadNameArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((name) => name.trim().length > 0);

const paddingArb = fc.constantFrom('', ' ', '  ', '\t', '\n', ' \n ');

describe('confirmsSquadName', () => {
  it('accepts the name itself, whatever whitespace surrounds what was typed', () => {
    fc.assert(
      fc.property(squadNameArb, paddingArb, paddingArb, (name, before, after) => {
        expect(confirmsSquadName(`${before}${name}${after}`, name)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('rejects any other name', () => {
    fc.assert(
      fc.property(squadNameArb, squadNameArb, (name, typed) => {
        fc.pre(typed.trim() !== name.trim());
        expect(confirmsSquadName(typed, name)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('rejects a change of letter case', () => {
    fc.assert(
      fc.property(
        squadNameArb.filter((name) => name.toUpperCase() !== name),
        (name) => {
          expect(confirmsSquadName(name.toUpperCase(), name)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('never accepts an empty or blank entry, even for a blank name', () => {
    fc.assert(
      fc.property(paddingArb, fc.oneof(squadNameArb, paddingArb), (typed, name) => {
        expect(confirmsSquadName(typed, name)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
