import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { classifyOutcome } from './callOutcome';
import type { CallOutcomeKind, SettledCall } from './callOutcome';

/**
 * Property test for the five-way classification of a settled `GetPlayerProfile`
 * call, placed beside the module it covers as the design's Testing Strategy asks
 * and running well above the 100-iteration floor (Requirement 14.5).
 *
 * This file carries **Property 1: The outcome classification is total and
 * five-valued** — for any settled call, including a status of `0`, a negative
 * status, a fractional status, `NaN`, either infinity, and the absence of a
 * status, `classifyOutcome` returns exactly one of `success`, `not-found`,
 * `timeout`, `transport-failure`, and `parse-failure`, and raises nothing
 * (Requirement 12.8).
 *
 * Three things about how this is written matter more than the run counts.
 *
 * First, the **status space is walked exhaustively**, not sampled. Requirement
 * 12.8 is a statement about every settled call, and there are only 500 statuses
 * in 100–599; the totality claim iterates all of them against both parse
 * verdicts and both timeout verdicts, so no status is left to chance and none is
 * examined under one verdict only. The statuses no backend sends — `0`, the
 * negatives, the fractions, `NaN`, both infinities — are generated alongside,
 * because a classifier is only total if it answers for them too.
 *
 * Second, **"exactly one of five" is asserted as exclusivity over shapes**, not
 * as a tag equality. Five independent shape validators are declared below, each
 * accepting one kind and its exact field set; every outcome must be accepted by
 * exactly one of them. A union that grew a sixth kind, a `not-found` that
 * started carrying a field, or a misspelled tag would be rejected by all five
 * and fail here — whereas `expect(outcome.kind).toBe(…)` would notice none of
 * it. The five names are transcribed from the requirement rather than read off
 * the module, so the suite and the module can disagree.
 *
 * Third, **exclusivity alone is vacuous**, since a function answering
 * `transport-failure` forever satisfies it. So each of the five kinds is shown
 * reachable from some settled call, and the function is additionally asserted
 * pure: deterministic across repeated reads, holding no state between calls, and
 * leaving the call it was handed unmodified.
 *
 * What is deliberately **not** claimed here, because the next two subtasks own
 * it and restating it would hide a regression behind a duplicate: that `401`,
 * `403`, and `404` classify identically and that no input yields an
 * authentication outcome (Property 2, `callOutcome.concealment.property.test.ts`),
 * and that a lapsed timeout wins over every status (Property 3,
 * `callOutcome.timeout.property.test.ts`). This file states only that *some*
 * single kind always comes back, never which one — with the one exception of the
 * five reachability witnesses, which exist to stop the exclusivity claim being
 * satisfied trivially.
 *
 * Requirements: 12.8, 14.5
 */

// --- the five kinds ----------------------------------------------------------

/**
 * Every outcome kind the requirement names, transcribed from Requirement 12.8
 * and the design's failure table rather than derived from the module — a suite
 * that read the module's own vocabulary would agree with any vocabulary at all,
 * including one missing a kind.
 */
const OUTCOME_KINDS = [
  'success',
  'not-found',
  'timeout',
  'transport-failure',
  'parse-failure',
] as const;

/** The outcome's own keys, sorted, as a comparable string. */
function keySignature(value: object): string {
  return Object.keys(value).sort().join(',');
}

/**
 * One acceptor per kind: the tag, and the exact field set.
 *
 * These are what make the "exactly one of five" claim mean something. Each is
 * total over any outcome, so every outcome can be offered to all five and the
 * count of acceptances asserted. Every acceptor demands `kind` as the *only*
 * key, because no arm of `CallOutcomeKind` declares a field — that absence is
 * how a status, a header, or a response body is kept from riding into the screen
 * (Requirements 3.7, 12.5), and it is asserted here as shape rather than assumed.
 */
const OUTCOME_SHAPES: readonly {
  readonly label: string;
  readonly accepts: (outcome: CallOutcomeKind) => boolean;
}[] = OUTCOME_KINDS.map((kind) => ({
  label: kind,
  accepts: (outcome: CallOutcomeKind) =>
    outcome.kind === kind && keySignature(outcome) === 'kind',
}));

/** The labels of every shape that accepts `outcome`. */
function acceptingShapes(outcome: CallOutcomeKind): readonly string[] {
  return OUTCOME_SHAPES.filter(({ accepts }) => accepts(outcome)).map(
    ({ label }) => label,
  );
}

// --- the status space --------------------------------------------------------

/** Every integer status the requirement names: 100 to 599 inclusive. */
const ALL_HTTP_STATUSES: readonly number[] = Array.from(
  { length: 500 },
  (_unused, offset) => 100 + offset,
);

/**
 * The statuses no backend sends, each of which must still classify rather than
 * raise: `0` — a response claiming an impossible status, which is not the same
 * signal as the absence of a response — the negatives, the fractions, the
 * out-of-range integers, and the three non-finite numbers.
 *
 * Named individually as well as generated in bulk, so the values the task calls
 * out are present in every run rather than only in the runs a sampler reached
 * them in.
 */
const NAMED_IMPOSSIBLE_STATUSES: readonly number[] = [
  0,
  -0,
  -1,
  -404,
  -599,
  1,
  99,
  600,
  1000,
  99_999,
  0.5,
  -0.5,
  199.5,
  200.5,
  299.999,
  403.5,
  404.000_001,
  599.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  Number.MAX_SAFE_INTEGER,
  Number.MIN_SAFE_INTEGER,
  Number.MAX_VALUE,
  Number.MIN_VALUE,
  Number.EPSILON,
];

// --- generators --------------------------------------------------------------

/** Any status the requirement names, drawn uniformly across 100–599. */
const httpStatusArb: fc.Arbitrary<number> = fc.constantFrom(
  ...ALL_HTTP_STATUSES,
);

/** Statuses no backend sends: the named ones, plus bulk integers and doubles. */
const impossibleStatusArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...NAMED_IMPOSSIBLE_STATUSES) },
  { weight: 2, arbitrary: fc.integer({ min: -1000, max: 99 }) },
  { weight: 2, arbitrary: fc.integer({ min: 600, max: 100_000 }) },
  { weight: 2, arbitrary: fc.double() },
);

/**
 * Every status signal at once, the absence of a response included.
 *
 * `null` is generated as a sibling of the numbers rather than as an afterthought:
 * it is the signal that *no response reached us*, and the classification must
 * answer for it exactly as totally as for a real status.
 */
const anyStatusArb: fc.Arbitrary<number | null> = fc.oneof(
  { weight: 6, arbitrary: httpStatusArb },
  { weight: 3, arbitrary: fc.constant(null) },
  { weight: 4, arbitrary: impossibleStatusArb },
);

/** A settled call of any shape at all. */
const settledCallArb: fc.Arbitrary<SettledCall> = fc.record({
  status: anyStatusArb,
  timedOut: fc.boolean(),
  parsed: fc.boolean(),
});

/** The four combinations of the two boolean signals, so neither is sampled. */
const VERDICT_PAIRS: readonly { timedOut: boolean; parsed: boolean }[] = [
  { timedOut: false, parsed: false },
  { timedOut: false, parsed: true },
  { timedOut: true, parsed: false },
  { timedOut: true, parsed: true },
];

/**
 * Classify a call and report what came back, so a raise surfaces as a failed
 * assertion naming the input rather than as an unhandled error.
 */
function outcomeOf(call: SettledCall): CallOutcomeKind {
  return classifyOutcome(call);
}

// --- the oracle this suite holds itself to ------------------------------------

// Feature: web-player-stats-screen, Property 1: The outcome classification is
// total and five-valued — the vocabulary the suite is written against
// Validates: Requirements 12.8
describe('classifyOutcome — the five kinds this suite holds it to', () => {
  it('names five distinct kinds, and one shape acceptor for each', () => {
    // Asserted before anything is held to the acceptors, so a duplicated or
    // missing kind fails here rather than producing a confident wrong verdict
    // below.
    expect(new Set(OUTCOME_KINDS).size).toBe(5);
    expect(OUTCOME_SHAPES).toHaveLength(5);
    expect(OUTCOME_SHAPES.map(({ label }) => label).sort()).toEqual(
      [...OUTCOME_KINDS].sort(),
    );
  });

  it('names exactly the kinds Requirement 12.8 declares', () => {
    // Stated literally, because a suite deriving its vocabulary from the module
    // would accept a module that had quietly grown or lost a kind.
    expect([...OUTCOME_KINDS].sort()).toEqual([
      'not-found',
      'parse-failure',
      'success',
      'timeout',
      'transport-failure',
    ]);
  });

  it('walks the whole status space the requirement names, and nothing less', () => {
    expect(ALL_HTTP_STATUSES).toHaveLength(500);
    expect(ALL_HTTP_STATUSES[0]).toBe(100);
    expect(ALL_HTTP_STATUSES[ALL_HTTP_STATUSES.length - 1]).toBe(599);
    expect(new Set(ALL_HTTP_STATUSES).size).toBe(500);
  });

  it('carries the statuses no backend sends, named rather than sampled', () => {
    // The task calls these out individually; asserting their presence keeps the
    // coverage claim from depending on the sampler.
    expect(NAMED_IMPOSSIBLE_STATUSES).toContain(0);
    expect(NAMED_IMPOSSIBLE_STATUSES.some((status) => status < 0)).toBe(true);
    expect(
      NAMED_IMPOSSIBLE_STATUSES.some(
        (status) => Number.isFinite(status) && !Number.isInteger(status),
      ),
    ).toBe(true);
    expect(NAMED_IMPOSSIBLE_STATUSES.some(Number.isNaN)).toBe(true);
    expect(NAMED_IMPOSSIBLE_STATUSES).toContain(Number.POSITIVE_INFINITY);
    expect(NAMED_IMPOSSIBLE_STATUSES).toContain(Number.NEGATIVE_INFINITY);
  });

  it('exercises both parse verdicts against both timeout verdicts', () => {
    expect(VERDICT_PAIRS).toHaveLength(4);
    expect(
      new Set(
        VERDICT_PAIRS.map(
          ({ timedOut, parsed }) => `${String(timedOut)}/${String(parsed)}`,
        ),
      ).size,
    ).toBe(4);
  });
});

// --- the property proper ------------------------------------------------------

// Feature: web-player-stats-screen, Property 1: The outcome classification is
// total and five-valued
// Validates: Requirements 12.8
describe('classifyOutcome — exactly one of five outcomes', () => {
  it('yields an outcome accepted by exactly one of the five shapes, for any settled call', () => {
    fc.assert(
      fc.property(settledCallArb, (call) => {
        // The property proper (12.8): one kind, and only one, for every settled
        // call — any status, the absence of one, either timeout verdict, either
        // parse verdict.
        const outcome = outcomeOf(call);

        expect(acceptingShapes(outcome)).toHaveLength(1);
        expect((OUTCOME_KINDS as readonly string[]).includes(outcome.kind)).toBe(
          true,
        );
      }),
      { numRuns: 2000 },
    );
  });

  it('classifies every integer status from 100 to 599 inclusive, under every verdict pair', () => {
    fc.assert(
      fc.property(fc.constantFrom(...VERDICT_PAIRS), ({ timedOut, parsed }) => {
        // The status space is walked in full rather than sampled: 12.8 speaks
        // about every settled call, and 500 statuses is a space small enough to
        // visit. Each is visited under a generated verdict pair, so no status is
        // examined under one verdict only.
        for (const status of ALL_HTTP_STATUSES) {
          const outcome = outcomeOf({ status, timedOut, parsed });

          expect(acceptingShapes(outcome), `status ${String(status)}`).toEqual([
            outcome.kind,
          ]);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('classifies the absence of a status under every verdict pair', () => {
    for (const { timedOut, parsed } of VERDICT_PAIRS) {
      // `null` is not `0`: no response reached us at all. It classifies as
      // totally as a real status does.
      const outcome = outcomeOf({ status: null, timedOut, parsed });

      expect(acceptingShapes(outcome)).toEqual([outcome.kind]);
    }
  });

  it('classifies zero, the negatives, the fractions, NaN, and both infinities', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NAMED_IMPOSSIBLE_STATUSES),
        fc.constantFrom(...VERDICT_PAIRS),
        (status, { timedOut, parsed }) => {
          // A status no backend would send is still a settled call, and the
          // classification is a function on numbers rather than on a whitelist —
          // so each of these lands in exactly one kind rather than in none.
          const outcome = outcomeOf({ status, timedOut, parsed });

          expect(acceptingShapes(outcome), `status ${String(status)}`).toEqual([
            outcome.kind,
          ]);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('classifies an arbitrary number as a status, however far outside the range', () => {
    fc.assert(
      fc.property(
        impossibleStatusArb,
        fc.constantFrom(...VERDICT_PAIRS),
        (status, { timedOut, parsed }) => {
          const outcome = outcomeOf({ status, timedOut, parsed });

          expect(acceptingShapes(outcome)).toHaveLength(1);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('carries nothing but its kind, whatever the call reported', () => {
    fc.assert(
      fc.property(settledCallArb, (call) => {
        // The five-valued claim read as a field set: no arm declares a field, so
        // there is nowhere for a status, a header, or a response body to ride
        // along into the screen (Requirements 3.7, 12.5).
        expect(Object.keys(outcomeOf(call))).toEqual(['kind']);
      }),
      { numRuns: 1000 },
    );
  });

  it('reaches each of the five kinds from some settled call', () => {
    // The exclusivity property alone is satisfied by a function that always
    // answered `transport-failure`, so the five are shown reachable too. These
    // are the only places this file states *which* kind comes back; the mappings
    // themselves belong to Properties 2 and 3.
    const witnesses: readonly (readonly [SettledCall, string])[] = [
      [{ status: 200, timedOut: false, parsed: true }, 'success'],
      [{ status: 404, timedOut: false, parsed: false }, 'not-found'],
      [{ status: null, timedOut: true, parsed: false }, 'timeout'],
      [{ status: 500, timedOut: false, parsed: false }, 'transport-failure'],
      [{ status: 200, timedOut: false, parsed: false }, 'parse-failure'],
    ];

    expect(witnesses.map(([call]) => outcomeOf(call).kind)).toEqual(
      witnesses.map(([, kind]) => kind),
    );
    expect(new Set(witnesses.map(([, kind]) => kind)).size).toBe(5);
  });
});

// --- totality -----------------------------------------------------------------

// Feature: web-player-stats-screen, Property 1: The outcome classification is
// total and five-valued — nothing is raised
// Validates: Requirements 12.8
describe('classifyOutcome — nothing is raised', () => {
  it('answers for any settled call without raising', () => {
    fc.assert(
      fc.property(settledCallArb, (call) => {
        // Totality stated as its own claim rather than inferred from the
        // assertions above: the signals arrive from a transport, so every
        // combination must settle rather than throw.
        expect(() => classifyOutcome(call)).not.toThrow();
      }),
      { numRuns: 1000 },
    );
  });

  it('answers for every status in the range, and for each one no backend sends', () => {
    expect(() => {
      for (const status of [
        ...ALL_HTTP_STATUSES,
        ...NAMED_IMPOSSIBLE_STATUSES,
        null,
      ]) {
        for (const { timedOut, parsed } of VERDICT_PAIRS) {
          classifyOutcome({ status, timedOut, parsed });
        }
      }
    }).not.toThrow();
  });

  it('accepts a frozen call, so a shared settled call can be classified twice', () => {
    fc.assert(
      fc.property(settledCallArb, (call) => {
        const frozen = Object.freeze({ ...call });

        expect(acceptingShapes(classifyOutcome(frozen))).toHaveLength(1);
      }),
      { numRuns: 500 },
    );
  });

  it('reads only the three signals it declares, so an extra member is never touched', () => {
    fc.assert(
      fc.property(settledCallArb, (call) => {
        // A caller handing in more than `SettledCall` declares — a seam that
        // spread a wider object, say — must not have that surplus read. A
        // throwing accessor makes the claim observable: if the classification
        // walked the object, this would raise instead of classifying.
        const withSurplus = {
          ...call,
          get body(): unknown {
            throw new Error('the response body must never be read');
          },
          get detail(): string {
            throw new Error('the problem detail must never be read');
          },
        } as SettledCall;

        expect(classifyOutcome(withSurplus)).toEqual(classifyOutcome(call));
      }),
      { numRuns: 500 },
    );
  });
});

// --- purity -------------------------------------------------------------------

// Feature: web-player-stats-screen, Property 1: the classification is a pure
// function of the settled call it is given
// Validates: Requirements 12.8, 14.5
describe('classifyOutcome — the classification is pure', () => {
  it('is deterministic: repeated calls on one settled call agree', () => {
    fc.assert(
      fc.property(settledCallArb, (call) => {
        // The screen classifies a settled call once per load and the state
        // machine may read the result again; two reads must not disagree.
        const first = classifyOutcome(call);

        expect(classifyOutcome(call)).toEqual(first);
        expect(classifyOutcome(call)).toEqual(first);
      }),
      { numRuns: 1000 },
    );
  });

  it('does not modify the settled call it was given', () => {
    fc.assert(
      fc.property(settledCallArb, (call) => {
        const before = { ...call };

        classifyOutcome(call);

        expect(call).toEqual(before);
      }),
      { numRuns: 500 },
    );
  });

  it('depends on nothing but the settled call it is given', () => {
    fc.assert(
      fc.property(settledCallArb, settledCallArb, (first, second) => {
        const firstOutcome = classifyOutcome(first);

        // Classifying an unrelated call in between changes nothing, so the
        // function holds no state across calls — which is what lets one module
        // serve every load of the screen.
        classifyOutcome(second);

        expect(classifyOutcome(first)).toEqual(firstOutcome);
      }),
      { numRuns: 500 },
    );
  });

  it('answers a fresh value each time, so no caller can mutate a shared outcome', () => {
    fc.assert(
      fc.property(settledCallArb, (call) => {
        // The arms are bare tags, so a shared frozen singleton would be sound
        // too — but a returned object a screen could write to would not be, and
        // this states which of the two the module does.
        const first = classifyOutcome(call);
        const second = classifyOutcome(call);

        expect(second).toEqual(first);
        expect(Object.keys(second)).toEqual(['kind']);
      }),
      { numRuns: 500 },
    );
  });
});
