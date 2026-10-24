import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { classifyOutcome, type SettledCall } from './callOutcome';

const problemCodeArb = fc.option(
  fc.oneof(
    fc.constantFrom(
      'ValidationFailed',
      'InvalidState',
      'ThresholdNotMet',
      'AlreadyParticipant',
      'ConcurrencyConflict',
      'Unauthorized',
      'NotAParticipant',
      'toString',
      '__proto__',
    ),
    fc.string(),
  ),
  { nil: null },
);

const settledArb: fc.Arbitrary<SettledCall> = fc.record({
  status: fc.option(fc.integer({ min: 100, max: 599 }), { nil: null }),
  timedOut: fc.boolean(),
  problemCode: problemCodeArb,
  parsed: fc.boolean(),
});

describe('classifyOutcome', () => {
  it('yields exactly one outcome for every settled call, and raises nothing', () => {
    fc.assert(
      fc.property(settledArb, (call) => {
        const outcome = classifyOutcome(call);
        expect([
          'success',
          'not-found',
          'rejected',
          'timeout',
          'transport-failure',
          'parse-failure',
        ]).toContain(outcome.kind);
      }),
      { numRuns: 500 },
    );
  });

  it('reports a timeout whatever else the call carries', () => {
    fc.assert(
      fc.property(settledArb, (call) => {
        expect(classifyOutcome({ ...call, timedOut: true })).toEqual({ kind: 'timeout' });
      }),
    );
  });

  it('conceals 401, 403 and 404 alike, whatever the problem code', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(401, 403, 404),
        problemCodeArb,
        fc.boolean(),
        (status, problemCode, parsed) => {
          expect(classifyOutcome({ status, timedOut: false, problemCode, parsed })).toEqual({
            kind: 'not-found',
          });
        },
      ),
    );
  });

  it('names a recognised rejection by its problem code', () => {
    const cases = [
      [400, 'ValidationFailed', 'validation'],
      [409, 'InvalidState', 'invalid-state'],
      [409, 'ThresholdNotMet', 'threshold-not-met'],
      [409, 'AlreadyParticipant', 'conflict'],
      [409, 'ConcurrencyConflict', 'conflict'],
    ] as const;

    for (const [status, problemCode, reason] of cases) {
      expect(classifyOutcome({ status, timedOut: false, problemCode, parsed: false })).toEqual({
        kind: 'rejected',
        reason,
      });
    }
  });

  it('falls back to the status for an unrecognised or inherited problem code', () => {
    for (const problemCode of [null, 'Mystery', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(
        classifyOutcome({ status: 400, timedOut: false, problemCode, parsed: false }),
      ).toEqual({ kind: 'rejected', reason: 'validation' });
      expect(
        classifyOutcome({ status: 409, timedOut: false, problemCode, parsed: false }),
      ).toEqual({ kind: 'rejected', reason: 'conflict' });
    }
  });

  it('accepts a 2xx only when its body parsed', () => {
    fc.assert(
      fc.property(fc.integer({ min: 200, max: 299 }), problemCodeArb, (status, problemCode) => {
        expect(classifyOutcome({ status, timedOut: false, problemCode, parsed: true })).toEqual({
          kind: 'success',
        });
        expect(classifyOutcome({ status, timedOut: false, problemCode, parsed: false })).toEqual({
          kind: 'parse-failure',
        });
      }),
    );
  });

  it('treats no response and every other status as a transport failure', () => {
    expect(classifyOutcome({ status: null, timedOut: false, problemCode: null, parsed: true })).toEqual(
      { kind: 'transport-failure' },
    );
    for (const status of [302, 410, 422, 500, 503]) {
      expect(classifyOutcome({ status, timedOut: false, problemCode: null, parsed: true })).toEqual({
        kind: 'transport-failure',
      });
    }
  });
});
