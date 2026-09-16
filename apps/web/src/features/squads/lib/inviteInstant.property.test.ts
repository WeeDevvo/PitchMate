import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  formatInviteInstant,
  inviteInstantAttribute,
  isRepresentableInstant,
  MAX_TIME_VALUE,
} from './inviteInstant';

/**
 * Property tests for the Invite_Instant presentation, placed beside the module
 * they cover as the design's Testing Strategy asks, and running well above the
 * 100-iteration floor (20.1).
 *
 * The numbered claim about the invite listing is Property 28, and it lives with
 * the component. What is settled here is the part of Requirement 11.2 that a
 * rendered test cannot reach on its own: that stating an instant is **total** —
 * every value yields text and nothing throws — and that the machine-readable form
 * beside it names the same point on the time line the entry was given.
 *
 * The generators deliberately reach past the values the Response_Parser produces.
 * A listing must not be breakable by one entry, so the boundary of what a `Date`
 * can represent, the values immediately beyond it, `NaN`, and both infinities are
 * all generated — each of them a value that would make an unguarded
 * `toISOString()` throw or an unguarded format render "Invalid Date".
 */

/** Instants of the kind the parser actually produces: a plausible calendar range. */
const ordinaryInstantArb: fc.Arbitrary<number> = fc.integer({
  min: Date.UTC(1970, 0, 1),
  max: Date.UTC(2100, 0, 1),
});

/** The exact boundary of the representable range, from both directions. */
const boundaryInstantArb: fc.Arbitrary<number> = fc.constantFrom(
  0,
  -0,
  MAX_TIME_VALUE,
  -MAX_TIME_VALUE,
  MAX_TIME_VALUE - 1,
  -MAX_TIME_VALUE + 1,
);

/** Values no `Date` can hold — the ones the totality argument is about. */
const unrepresentableInstantArb: fc.Arbitrary<number> = fc.constantFrom(
  MAX_TIME_VALUE + 1,
  -MAX_TIME_VALUE - 1,
  MAX_TIME_VALUE * 2,
  Number.MAX_SAFE_INTEGER,
  Number.MIN_SAFE_INTEGER,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
);

/** Every kind of value together, so the totality claims are made over all of them. */
const anyInstantArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 4, arbitrary: ordinaryInstantArb },
  { weight: 2, arbitrary: boundaryInstantArb },
  { weight: 2, arbitrary: unrepresentableInstantArb },
  { weight: 1, arbitrary: fc.double() },
  { weight: 1, arbitrary: fc.integer() },
);

// Feature: web-squads-screens, supports Property 28: stating an invite's instants
// is total and never throws
// Validates: Requirements 11.2, 20.1
describe('inviteInstant — stating an instant is total', () => {
  it('yields a non-empty string for every number, and raises nothing', () => {
    fc.assert(
      fc.property(anyInstantArb, (instantMs) => {
        const text = formatInviteInstant(instantMs);

        // 11.2: an entry always states its creation instant. A throw here would
        // take the whole listing with it, and an empty string would be a blank
        // where a fact belongs.
        expect(typeof text).toBe('string');
        expect(text.length).toBeGreaterThan(0);
      }),
      { numRuns: 300 },
    );
  });

  it('never renders the invalid-date text', () => {
    fc.assert(
      fc.property(anyInstantArb, (instantMs) => {
        // The failure mode a guard-free implementation has: `Invalid Date` read as
        // though it were an instant.
        expect(formatInviteInstant(instantMs)).not.toContain('Invalid');
      }),
      { numRuns: 300 },
    );
  });

  it('is deterministic: stating an instant twice yields the same text', () => {
    fc.assert(
      fc.property(anyInstantArb, (instantMs) => {
        // The listing re-renders on every refresh, so a format that varied between
        // calls would make an entry appear to change when nothing had.
        expect(formatInviteInstant(instantMs)).toBe(formatInviteInstant(instantMs));
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: web-squads-screens, supports Property 28: the machine-readable form
// names the same instant the entry was given
// Validates: Requirements 11.2, 20.1
describe('inviteInstant — the machine-readable form', () => {
  it('round-trips a representable instant to the same point on the time line', () => {
    fc.assert(
      fc.property(fc.oneof(ordinaryInstantArb, boundaryInstantArb), (instantMs) => {
        const attribute = inviteInstantAttribute(instantMs);

        expect(attribute).toBeDefined();
        // The attribute is what a test and assistive technology read, so it must
        // name the instant the entry was given rather than a rounded or re-offset
        // one. `Date.parse` of an ISO-8601 instant is the inverse.
        expect(Date.parse(attribute as string)).toBe(instantMs === 0 ? 0 : instantMs);
      }),
      { numRuns: 300 },
    );
  });

  it('is absent for a value no Date can hold, rather than throwing', () => {
    fc.assert(
      fc.property(unrepresentableInstantArb, (instantMs) => {
        // An omitted attribute is a `<time>` element with text and no machine
        // form; a thrown `RangeError` would be an unrendered listing.
        expect(inviteInstantAttribute(instantMs)).toBeUndefined();
        expect(isRepresentableInstant(instantMs)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('agrees with the representability predicate for every number', () => {
    fc.assert(
      fc.property(anyInstantArb, (instantMs) => {
        // One decision, read two ways: the predicate the component could use to
        // branch, and the attribute it actually renders.
        expect(inviteInstantAttribute(instantMs) !== undefined).toBe(
          isRepresentableInstant(instantMs),
        );
      }),
      { numRuns: 300 },
    );
  });
});
