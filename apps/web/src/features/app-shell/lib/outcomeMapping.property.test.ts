import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  mapCallOutcome,
  NOT_FOUND_STATUS,
  SUCCESS_STATUS_MAX,
  SUCCESS_STATUS_MIN,
  UNAUTHENTICATED_STATUS,
  type CallOutcomeKind,
} from './outcomeMapping';

/**
 * Property tests for the single pure notification call outcome mapper, placed
 * beside the module they cover as Requirement 14.2 asks, and run well above the
 * 100-iteration floor.
 *
 * These carry **Property 10: Every response status maps to exactly one call
 * outcome**:
 *
 *  - *single-valuedness* — every returned response status, and the absence of a
 *    response, yields exactly one of `success`, `unauthenticated`,
 *    `not-found`, and `failure`, and never more than one (Requirements 11.6,
 *    14.15);
 *  - *agreement with the stated mapping* — `200`–`299` inclusive is `success`
 *    (including the mark-read endpoint's `204`), `401` is `unauthenticated`,
 *    `404` is `not-found`, and every other status is `failure` (Requirements
 *    11.6, 11.9);
 *  - *totality* — the function raises nothing for any numeric status at all,
 *    including `NaN`, both infinities, fractional, negative, and absurdly large
 *    statuses, and for `null`, which stands for a transport failure or a
 *    Notification_Call_Timeout abort and folds into `failure` (Requirements
 *    11.8, 14.15).
 *
 * The mapping is deliberately re-derived here from the acceptance criteria
 * rather than lifted from the module, so a change of the module's branch
 * structure cannot silently drag the expectation along with it. The two named
 * boundary constants are read from the module only to state *which* range the
 * criteria are talking about.
 *
 * Validates: Requirements 11.6, 11.8, 11.9, 14.15
 */

/** The four outcomes the mapping is allowed to yield (Requirement 11.6). */
const ALL_OUTCOMES: readonly CallOutcomeKind[] = [
  'success',
  'unauthenticated',
  'not-found',
  'failure',
];

/**
 * An independent reading of Requirement 11.6's mapping, written from the
 * criterion: the success range first, then the two single-status cases, then
 * failure for everything else including the absence of a response.
 */
function expectedOutcome(status: number | null): CallOutcomeKind {
  if (status === null) {
    return 'failure';
  }

  if (
    Number.isFinite(status) &&
    status >= SUCCESS_STATUS_MIN &&
    status <= SUCCESS_STATUS_MAX
  ) {
    return 'success';
  }

  if (status === UNAUTHENTICATED_STATUS) {
    return 'unauthenticated';
  }

  if (status === NOT_FOUND_STATUS) {
    return 'not-found';
  }

  return 'failure';
}

/**
 * Assert the outcome is exactly one member of the four-outcome set — a string
 * that is one of them and, by the set having no duplicates, not two of them.
 */
function expectExactlyOneOutcome(outcome: CallOutcomeKind): void {
  expect(typeof outcome).toBe('string');
  expect(ALL_OUTCOMES).toContain(outcome);
  expect(ALL_OUTCOMES.filter((candidate) => candidate === outcome)).toHaveLength(1);
}

/** Every integer response status the design's Property 10 range covers. */
const httpStatusArb: fc.Arbitrary<number> = fc.integer({ min: 100, max: 599 });

/** The success range on its own, so it is sampled densely rather than by luck. */
const successStatusArb: fc.Arbitrary<number> = fc.integer({
  min: SUCCESS_STATUS_MIN,
  max: SUCCESS_STATUS_MAX,
});

/** Integer statuses outside `200`–`299`, `401`, and `404`. */
const otherStatusArb: fc.Arbitrary<number> = httpStatusArb.filter(
  (status) =>
    (status < SUCCESS_STATUS_MIN || status > SUCCESS_STATUS_MAX) &&
    status !== UNAUTHENTICATED_STATUS &&
    status !== NOT_FOUND_STATUS,
);

/** Statuses no backend should produce, which the mapping must still survive. */
const hostileStatusArb: fc.Arbitrary<number> = fc.oneof(
  fc.constantFrom(
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    0,
    -0,
    -1,
    -404,
    199.999_999,
    200.000_000_1,
    299.5,
    401.5,
    404.000_1,
    Number.MAX_SAFE_INTEGER,
    -Number.MAX_SAFE_INTEGER,
    Number.MAX_VALUE,
    Number.MIN_VALUE,
    Number.EPSILON,
  ),
  fc.integer({ min: -1_000_000, max: 1_000_000 }),
  fc.double(),
  fc.double({ min: 100, max: 600, noNaN: true }),
);

/** Any status the mapping accepts at all: a number, or the absence of one. */
const anyStatusArb: fc.Arbitrary<number | null> = fc.oneof(
  { arbitrary: fc.constant(null), weight: 1 },
  { arbitrary: httpStatusArb, weight: 4 },
  { arbitrary: hostileStatusArb, weight: 3 },
);

describe('Property 10: every response status maps to exactly one call outcome', () => {
  it('yields exactly one of the four outcomes for every status and for no response', () => {
    fc.assert(
      fc.property(anyStatusArb, (status) => {
        expectExactlyOneOutcome(mapCallOutcome(status));
      }),
      { numRuns: 1000 },
    );
  });

  it('agrees with the mapping the acceptance criteria state, over 100 to 599 and no response', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(null), httpStatusArb),
        (status: number | null) => {
          expect(mapCallOutcome(status)).toBe(expectedOutcome(status));
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('maps every status in 200 to 299 inclusive, the 204 included, to success', () => {
    fc.assert(
      fc.property(successStatusArb, (status) => {
        expect(mapCallOutcome(status)).toBe('success');
      }),
      { numRuns: 500 },
    );

    expect(mapCallOutcome(204)).toBe('success');
    expect(mapCallOutcome(SUCCESS_STATUS_MIN)).toBe('success');
    expect(mapCallOutcome(SUCCESS_STATUS_MAX)).toBe('success');
  });

  it('maps 401 to unauthenticated and 404 to not-found, and no other status to either', () => {
    expect(mapCallOutcome(UNAUTHENTICATED_STATUS)).toBe('unauthenticated');
    expect(mapCallOutcome(NOT_FOUND_STATUS)).toBe('not-found');

    fc.assert(
      fc.property(anyStatusArb, (status) => {
        const outcome = mapCallOutcome(status);

        if (outcome === 'unauthenticated') {
          expect(status).toBe(UNAUTHENTICATED_STATUS);
        }

        if (outcome === 'not-found') {
          expect(status).toBe(NOT_FOUND_STATUS);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('maps every other status, and the absence of a response, to failure', () => {
    fc.assert(
      fc.property(
        fc.oneof(otherStatusArb, hostileStatusArb, fc.constant(null)),
        (status: number | null) => {
          if (status !== null && status >= 200 && status <= 299) {
            return; // Covered by the success property above.
          }

          if (status === UNAUTHENTICATED_STATUS || status === NOT_FOUND_STATUS) {
            return; // Covered by the single-status property above.
          }

          expect(mapCallOutcome(status)).toBe('failure');
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('raises no exception for any numeric status or for no response (totality)', () => {
    fc.assert(
      fc.property(anyStatusArb, (status) => {
        expect(() => mapCallOutcome(status)).not.toThrow();
      }),
      { numRuns: 1000 },
    );
  });

  it('is deterministic: the same status always yields the same outcome', () => {
    fc.assert(
      fc.property(anyStatusArb, (status) => {
        expect(mapCallOutcome(status)).toBe(mapCallOutcome(status));
      }),
      { numRuns: 500 },
    );
  });
});
