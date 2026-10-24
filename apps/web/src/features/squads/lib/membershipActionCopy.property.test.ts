import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { DEMOTION_COPY, REMOVAL_COPY } from './membershipActionCopy';
import * as messages from './messages';
import { REMOVAL_CONFIRM_STATEMENT } from './messages';

/**
 * Property tests for the membership-action copy: every string each action
 * presents is one of the fixed messages from `./messages` (so the message
 * rules — no interpolation, no digits — bind it too), each action's five
 * strings are pairwise distinct, and the removal copy states that rating and
 * history are kept, as the product rule asks.
 */

const COPIES = [
  ['remove', REMOVAL_COPY],
  ['demote', DEMOTION_COPY],
] as const;

const fixedMessages = new Set(
  Object.values(messages).filter((value): value is string => typeof value === 'string'),
);

describe('membership action copy', () => {
  it('draws every field of every action from the fixed messages', () => {
    fc.assert(
      fc.property(fc.constantFrom(...COPIES), ([name, copy]) => {
        for (const value of Object.values(copy)) {
          expect(fixedMessages.has(value), `${name}: ${value}`).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('keeps each action’s strings pairwise distinct', () => {
    for (const [name, copy] of COPIES) {
      const values = Object.values(copy);
      expect(new Set(values).size, name).toBe(values.length);
    }
  });

  it('tells the person confirming a removal that rating and history are kept', () => {
    expect(REMOVAL_COPY.statement).toBe(REMOVAL_CONFIRM_STATEMENT);
    expect(REMOVAL_COPY.statement).toMatch(/rating/i);
    expect(REMOVAL_COPY.statement).toMatch(/history/i);
    expect(REMOVAL_COPY.statement).toMatch(/kept/i);
  });
});
