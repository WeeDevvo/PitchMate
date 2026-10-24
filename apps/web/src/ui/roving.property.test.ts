/**
 * For every set of items and every key, roving movement lands on an enabled
 * item (or reports none), arrows step one enabled item with wrap-around, and
 * Home/End reach the first and last enabled items.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { nextRovingIndex } from './roving';

const MOVEMENT_KEYS = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
const items = fc.array(fc.boolean(), { minLength: 1, maxLength: 8 });

describe('nextRovingIndex', () => {
  it('only ever lands on an enabled item', () => {
    fc.assert(
      fc.property(items, fc.nat(), fc.constantFrom(...MOVEMENT_KEYS), (enabled, seed, key) => {
        const next = nextRovingIndex(key, seed % enabled.length, enabled);
        if (enabled.every((isEnabled) => !isEnabled)) {
          expect(next).toBeNull();
        } else {
          expect(next).not.toBeNull();
          expect(enabled[next!]).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('steps forward then back to where it started', () => {
    fc.assert(
      fc.property(items, fc.nat(), (enabled, seed) => {
        const order = enabled.flatMap((isEnabled, index) => (isEnabled ? [index] : []));
        fc.pre(order.length > 0);
        const start = order[seed % order.length];
        const forward = nextRovingIndex('ArrowRight', start, enabled)!;
        expect(nextRovingIndex('ArrowLeft', forward, enabled)).toBe(start);
      }),
      { numRuns: 200 },
    );
  });

  it('sends Home and End to the first and last enabled items', () => {
    fc.assert(
      fc.property(items, fc.nat(), (enabled, seed) => {
        const order = enabled.flatMap((isEnabled, index) => (isEnabled ? [index] : []));
        fc.pre(order.length > 0);
        const current = seed % enabled.length;
        expect(nextRovingIndex('Home', current, enabled)).toBe(order[0]);
        expect(nextRovingIndex('End', current, enabled)).toBe(order[order.length - 1]);
      }),
      { numRuns: 200 },
    );
  });

  it('ignores keys that are not movement keys', () => {
    expect(nextRovingIndex('Enter', 0, [true, true])).toBeNull();
    expect(nextRovingIndex('a', 0, [true, true])).toBeNull();
  });
});
