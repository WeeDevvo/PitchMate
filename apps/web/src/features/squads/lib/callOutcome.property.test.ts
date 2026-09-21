import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  classifyOutcome,
  type CallOutcomeKind,
  type RejectionReason,
  type SettledCall,
} from './callOutcome';

/**
 * Property test for the seven-way classification of a settled Squads_Api call,
 * placed beside the module it covers as the design's Testing Strategy asks and
 * running well above the 100-iteration floor (20.1).
 *
 * This file carries **Property 39: Every settled call classifies into exactly one
 * of seven outcomes** — for any integer status from 100 to 599 inclusive, for the
 * absence of a response, for a fired timeout, and for each of an accepted and a
 * rejected body, `classifyOutcome` yields exactly one of success, not-found,
 * authentication failure, rejected input, timeout, transport failure, and parse
 * failure (17.8), with the timeout kept distinguishable from a transport failure
 * and from a parse failure (16.3).
 *
 * Four things about how this is written matter more than the run counts.
 *
 * First, the **status space is walked exhaustively**, not sampled. Requirement
 * 17.8 is a statement about every settled call, and there are only 500 statuses
 * in 100–599; the mapping test iterates all of them inside a property over the
 * other three signals, so every status is seen against generated bodies and
 * generated problem codes rather than against whichever few a sampler picked.
 *
 * Second, **"exactly one of seven" is asserted as exclusivity over shapes**, not
 * as a tag equality. Seven independent shape validators are declared below, each
 * accepting one kind and its exact field set; every outcome must be accepted by
 * exactly one. A union that grew an eighth kind, a `not-found` that started
 * carrying a field, or a rejection whose reason fell outside the five names would
 * be rejected by all seven and fail here — whereas `expect(outcome.kind).toBe(…)`
 * would notice none of it.
 *
 * Third, the **expected mapping is an oracle of status sets** transcribed from
 * Requirement 17.8 and the backend error enums, not a second copy of the
 * function's control flow. The oracle's own well-formedness — that its status
 * buckets are pairwise disjoint and that the remainder of 100–599 is exactly the
 * transport-failure region — is asserted first, so a mistake in the oracle shows
 * as a failure of the oracle rather than as a false verdict on the module.
 *
 * Fourth, **Requirement 17.2 is asserted structurally**. The generators feed
 * hostile problem codes and whole ProblemDetails bodies — `detail`, `title`,
 * `instance`, `traceId`, arbitrary extensions — through the classification and
 * assert none of that text is reachable from the outcome, and that a rejection
 * carries a named {@link RejectionReason} and nothing else.
 *
 * Requirements: 16.3, 17.2, 17.8
 */

// --- the seven kinds, and the five reasons ------------------------------------

/** Every outcome kind Requirement 17.8 names, transcribed from the requirement. */
const OUTCOME_KINDS = [
  'success',
  'not-found',
  'auth-failure',
  'rejected-input',
  'timeout',
  'transport-failure',
  'parse-failure',
] as const;

/** Every rejection reason the design declares. */
const REJECTION_REASONS = [
  'display-name-in-use',
  'invite-unusable',
  'invite-limit-reached',
  'validation',
  'conflict',
] as const;

/** The outcome's own keys, sorted, as a comparable string. */
function keySignature(value: object): string {
  return Object.keys(value).sort().join(',');
}

/**
 * One acceptor per kind: the tag, the exact field set, and — for the one kind
 * that carries anything — the validity of what it carries.
 *
 * These are what make the "exactly one of seven" claim mean something. Each is
 * total over any outcome, so every outcome can be offered to all seven and the
 * count of acceptances asserted.
 */
const OUTCOME_SHAPES: readonly {
  readonly label: string;
  readonly accepts: (outcome: CallOutcomeKind) => boolean;
}[] = [
  {
    label: 'success',
    accepts: (outcome) =>
      outcome.kind === 'success' && keySignature(outcome) === 'kind',
  },
  {
    label: 'not-found',
    accepts: (outcome) =>
      // 17.7: evidence about nothing, so it carries no field that could
      // distinguish an absent squad from an inaccessible one.
      outcome.kind === 'not-found' && keySignature(outcome) === 'kind',
  },
  {
    label: 'auth-failure',
    accepts: (outcome) =>
      outcome.kind === 'auth-failure' && keySignature(outcome) === 'kind',
  },
  {
    label: 'rejected-input',
    accepts: (outcome) =>
      outcome.kind === 'rejected-input' &&
      // 17.2: a rejection carries a named reason and nothing else — no detail,
      // no title, no status, no path.
      keySignature(outcome) === 'kind,reason' &&
      (REJECTION_REASONS as readonly string[]).includes(outcome.reason),
  },
  {
    label: 'timeout',
    accepts: (outcome) =>
      outcome.kind === 'timeout' && keySignature(outcome) === 'kind',
  },
  {
    label: 'transport-failure',
    accepts: (outcome) =>
      outcome.kind === 'transport-failure' && keySignature(outcome) === 'kind',
  },
  {
    label: 'parse-failure',
    accepts: (outcome) =>
      outcome.kind === 'parse-failure' && keySignature(outcome) === 'kind',
  },
];

/** The labels of every shape that accepts `outcome`. */
function acceptingShapes(outcome: CallOutcomeKind): readonly string[] {
  return OUTCOME_SHAPES.filter(({ accepts }) => accepts(outcome)).map(
    ({ label }) => label,
  );
}

// --- the oracle: status buckets from Requirement 17.8 ------------------------

/** Every integer status the requirement names: 100 to 599 inclusive. */
const ALL_HTTP_STATUSES: readonly number[] = Array.from(
  { length: 500 },
  (_unused, offset) => 100 + offset,
);

/**
 * What a status decides on its own. `body-decides` is the `2xx` region, where the
 * parser's verdict picks between success and parse failure rather than the status
 * doing so.
 */
type StatusVerdict =
  | 'auth-failure'
  | 'not-found'
  | 'rejected-input'
  | 'body-decides'
  | 'transport-failure';

/**
 * The status buckets, transcribed from Requirement 17.8 and the design's failure
 * table: `401` is the session outcome, `403` and `404` are the one non-disclosing
 * branch, `400`/`409`/`410` are the rejections a person can act on, and `2xx` is
 * where a body exists to parse. Everything else — every `1xx`, `3xx`, and `5xx`,
 * the `503` a stats computation failure answers with included — is a transport
 * failure by remainder rather than by enumeration.
 */
const STATUS_BUCKETS: readonly {
  readonly verdict: Exclude<StatusVerdict, 'transport-failure'>;
  readonly statuses: readonly number[];
}[] = [
  { verdict: 'auth-failure', statuses: [401] },
  { verdict: 'not-found', statuses: [403, 404] },
  { verdict: 'rejected-input', statuses: [400, 409, 410] },
  {
    verdict: 'body-decides',
    statuses: Array.from({ length: 100 }, (_unused, offset) => 200 + offset),
  },
];

/**
 * The verdict a status names, or `transport-failure` when no bucket claims it.
 *
 * Throws when two buckets claim the same status, so an ill-formed oracle cannot
 * quietly return the first match; the disjointness test below states that
 * separately.
 */
function verdictForStatus(status: number): StatusVerdict {
  const claiming = STATUS_BUCKETS.filter(({ statuses }) =>
    statuses.includes(status),
  );

  if (claiming.length > 1) {
    throw new Error(
      `oracle is ill-formed: status ${String(status)} is claimed by ${claiming
        .map(({ verdict }) => verdict)
        .join(' and ')}`,
    );
  }

  return claiming[0]?.verdict ?? 'transport-failure';
}

/**
 * The reason a rejecting status names when the body names none, transcribed from
 * the design: `400` is a validation rejection, `409` a state conflict, and `410`
 * is emitted for an unusable invite and nothing else.
 */
const DEFAULT_REASON_BY_STATUS: ReadonlyMap<number, RejectionReason> = new Map([
  [400, 'validation'],
  [409, 'conflict'],
  [410, 'invite-unusable'],
]);

/**
 * The reason each backend problem code names, transcribed from
 * `Domain/Squads/SquadErrorCode.cs` and `Application/Stats/StatsErrorCode.cs`.
 *
 * A `Map` rather than an object literal, so a candidate named `'toString'` or
 * `'__proto__'` reads nothing here either and the oracle cannot disagree with the
 * module for the wrong reason.
 */
const REASON_BY_PROBLEM_CODE: ReadonlyMap<string, RejectionReason> = new Map([
  ['DisplayNameInUse', 'display-name-in-use'],
  ['InviteUnusable', 'invite-unusable'],
  ['InviteLimitReached', 'invite-limit-reached'],
  ['ValidationFailed', 'validation'],
  ['ExpiryRequired', 'validation'],
  ['UnsupportedStatistic', 'validation'],
  ['OwnerConstraint', 'conflict'],
  ['ClaimNotEligible', 'conflict'],
  ['SquadPendingDeletion', 'conflict'],
  ['ConcurrencyConflict', 'conflict'],
]);

/**
 * The backend codes that deliberately name no reason: the first two are answered
 * as `403`/`404` and the third as a `200` no-op, and the last two belong to
 * statuses that are not rejections at all. Each must fall back to the status
 * default rather than being guessed at.
 */
const UNNAMED_BACKEND_CODES: readonly string[] = [
  'Unauthorized',
  'NotAMember',
  'AlreadyMember',
  'NotFound',
  'ComputationFailed',
];

/** The reason a rejecting status and a problem code name together. */
function expectedReason(
  status: number,
  problemCode: string | null,
): RejectionReason {
  const fromStatus = DEFAULT_REASON_BY_STATUS.get(status);

  if (fromStatus === undefined) {
    throw new Error(
      `oracle is ill-formed: status ${String(status)} names no default reason`,
    );
  }

  const fromCode =
    problemCode === null ? undefined : REASON_BY_PROBLEM_CODE.get(problemCode);

  return fromCode ?? fromStatus;
}

/** The whole expected outcome for a settled call the oracle can speak about. */
function expectedOutcomeForStatus(
  status: number,
  parsed: boolean,
  problemCode: string | null,
): CallOutcomeKind {
  const verdict = verdictForStatus(status);

  switch (verdict) {
    case 'body-decides':
      return { kind: parsed ? 'success' : 'parse-failure' };
    case 'rejected-input':
      return {
        kind: 'rejected-input',
        reason: expectedReason(status, problemCode),
      };
    default:
      return { kind: verdict };
  }
}

// --- generators ---------------------------------------------------------------

/** The codes that name a reason, generated by name. */
const namedProblemCodeArb: fc.Arbitrary<string> = fc.constantFrom(
  ...REASON_BY_PROBLEM_CODE.keys(),
);

/**
 * Codes that name no reason: the backend codes that never accompany a rejection,
 * near misses in case and whitespace, the inherited property names a table read
 * without an own-property guard would resolve to a `Function`, and arbitrary
 * strings including a plausible code a later backend might add.
 */
const unnamedProblemCodeArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.constantFrom(
      ...UNNAMED_BACKEND_CODES,
      '',
      ' ',
      '   ',
      'displayNameInUse',
      'DISPLAYNAMEINUSE',
      'display-name-in-use',
      'DisplayNameInUse ',
      ' DisplayNameInUse',
      'InviteUnusable\n',
      'SomeCodeAddedLater',
      'toString',
      'valueOf',
      'constructor',
      '__proto__',
      'hasOwnProperty',
      'prototype',
      'undefined',
      'null',
      '0',
    ),
  },
  {
    weight: 3,
    arbitrary: fc
      .string({ maxLength: 32 })
      .filter((candidate) => !REASON_BY_PROBLEM_CODE.has(candidate)),
  },
  {
    weight: 1,
    arbitrary: fc
      .string({ unit: 'grapheme', maxLength: 12 })
      .filter((candidate) => !REASON_BY_PROBLEM_CODE.has(candidate)),
  },
);

/** A problem `code` extension: named, unnamed, or absent. */
const problemCodeArb: fc.Arbitrary<string | null> = fc.oneof(
  { weight: 4, arbitrary: namedProblemCodeArb },
  { weight: 4, arbitrary: unnamedProblemCodeArb },
  { weight: 3, arbitrary: fc.constant(null) },
);

/** Any status the requirement names, drawn uniformly across 100–599. */
const httpStatusArb: fc.Arbitrary<number> = fc.constantFrom(
  ...ALL_HTTP_STATUSES,
);

/**
 * Statuses no backend sends, which must still classify rather than throw: the
 * absent response is generated separately, but `0`, a negative, a fraction, and
 * the three non-finite numbers all arrive here.
 */
const impossibleStatusArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom(
      0,
      -0,
      -1,
      -404,
      1,
      99,
      600,
      1000,
      99_999,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
      400.5,
      401.5,
      404.000_001,
      599.5,
      0.5,
      -0.5,
    ),
  },
  { weight: 2, arbitrary: fc.integer({ min: -1000, max: 99 }) },
  { weight: 2, arbitrary: fc.integer({ min: 600, max: 100_000 }) },
  { weight: 2, arbitrary: fc.double({ noNaN: true }) },
);

/** Every status signal at once, the absence of a response included. */
const anyStatusArb: fc.Arbitrary<number | null> = fc.oneof(
  { weight: 6, arbitrary: httpStatusArb },
  { weight: 3, arbitrary: fc.constant(null) },
  { weight: 3, arbitrary: impossibleStatusArb },
);

/** A settled call of any shape at all. */
const settledCallArb: fc.Arbitrary<SettledCall> = fc.record({
  status: anyStatusArb,
  timedOut: fc.boolean(),
  problemCode: problemCodeArb,
  parsed: fc.boolean(),
});

/** The statuses that reject, generated by name. */
const rejectingStatusArb: fc.Arbitrary<number> = fc.constantFrom(
  ...DEFAULT_REASON_BY_STATUS.keys(),
);

/**
 * Backend-supplied prose: the `detail`, `title`, and `instance` a ProblemDetails
 * body carries, filtered so a generated string can never coincide with a name the
 * outcome is allowed to contain. Without that filter the absence assertion would
 * be unsound rather than merely strict.
 */
const RESERVED_OUTCOME_WORDS: readonly string[] = [
  ...OUTCOME_KINDS,
  ...REJECTION_REASONS,
  'kind',
  'reason',
];

/**
 * Every character sequence a serialised outcome can legitimately contain: the
 * seven kinds, the five reasons, the two field names, and JSON punctuation.
 *
 * A generated text that is a substring of this — `'a'`, `'-'`, `'in'` — would be
 * found inside `{"kind":"transport-failure"}` no matter what the module did, so
 * such texts are excluded and the absence assertion becomes sound rather than
 * merely strict.
 */
const OUTCOME_VOCABULARY: string = JSON.stringify({
  kinds: OUTCOME_KINDS,
  reasons: REJECTION_REASONS,
  fields: ['kind', 'reason'],
});

const backendTextArb: fc.Arbitrary<string> = fc
  .oneof(
    {
      weight: 4,
      arbitrary: fc.constantFrom(
        'The display name "Dave" is already taken in squad 7f3c.',
        'Squad 9c1e-4b2a does not exist.',
        'One or more validation errors occurred.',
        '/api/squads/9c1e-4b2a/guests',
        'Npgsql.PostgresException: duplicate key value violates unique constraint',
        'trace-id: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        'Bad Request',
        'Conflict',
        '500 Internal Server Error',
        'DisplayNameInUse',
      ),
    },
    { weight: 3, arbitrary: fc.string({ minLength: 6, maxLength: 64 }) },
    {
      weight: 1,
      arbitrary: fc.string({ unit: 'grapheme', minLength: 4, maxLength: 24 }),
    },
  )
  .filter(
    (text) =>
      text.length > 0 &&
      !RESERVED_OUTCOME_WORDS.some((reserved) => text.includes(reserved)) &&
      !OUTCOME_VOCABULARY.includes(text),
  );

/**
 * A settled call carrying the rest of a ProblemDetails body alongside the four
 * signals, as an over-generous caller might hand it in. The extra fields are not
 * on {@link SettledCall} at all — which is the point: the type offers them no way
 * through, and this asserts the function does not find one either.
 */
function withProblemBody(
  call: SettledCall,
  extras: Readonly<Record<string, unknown>>,
): SettledCall {
  return { ...extras, ...call } as SettledCall;
}

// --- the property -------------------------------------------------------------

// Feature: web-squads-screens, Property 39: Every settled call classifies into exactly one of seven outcomes
// Validates: Requirements 16.3, 17.8
describe('classifyOutcome — the oracle it is held to', () => {
  it('claims each status at most once and leaves the remainder to transport failure', () => {
    // Asserted before anything is held to the oracle, so an overlapping bucket
    // fails here rather than producing a confident wrong verdict below.
    const claimed = STATUS_BUCKETS.flatMap(({ statuses }) => statuses);

    expect(new Set(claimed).size).toBe(claimed.length);
    expect(claimed).toHaveLength(1 + 2 + 3 + 100);

    const remainder = ALL_HTTP_STATUSES.filter(
      (status) => !claimed.includes(status),
    );

    // 100–199, 300–399, and 500–599 in full, plus the 4xx statuses no bucket
    // names — 394 statuses whose only outcome is a transport failure.
    expect(remainder).toHaveLength(500 - claimed.length);
    expect(remainder).toContain(100);
    expect(remainder).toContain(302);
    expect(remainder).toContain(402);
    expect(remainder).toContain(500);
    expect(remainder).toContain(503);
    expect(remainder).toContain(599);
    expect(
      remainder.every((status) => verdictForStatus(status) === 'transport-failure'),
    ).toBe(true);
  });

  it('names exactly the seven kinds and the five reasons the design declares', () => {
    expect(new Set(OUTCOME_KINDS).size).toBe(7);
    expect(new Set(REJECTION_REASONS).size).toBe(5);
    expect(OUTCOME_SHAPES.map(({ label }) => label).sort()).toEqual(
      [...OUTCOME_KINDS].sort(),
    );
  });
});

// Feature: web-squads-screens, Property 39: Every settled call classifies into exactly one of seven outcomes
// Validates: Requirements 16.3, 17.8
describe('classifyOutcome — exactly one of seven outcomes', () => {
  it('yields an outcome accepted by exactly one of the seven shapes, for any settled call', () => {
    fc.assert(
      fc.property(settledCallArb, (call) => {
        // The property proper (17.8): one kind, and only one, for every settled
        // call — a fired timeout, an absent response, any status, either body
        // verdict, any problem code.
        const outcome = classifyOutcome(call);

        expect(acceptingShapes(outcome)).toHaveLength(1);
        expect((OUTCOME_KINDS as readonly string[]).includes(outcome.kind)).toBe(
          true,
        );
      }),
      { numRuns: 2000 },
    );
  });

  it('classifies every integer status from 100 to 599 inclusive as its status names', () => {
    fc.assert(
      fc.property(fc.boolean(), problemCodeArb, (parsed, problemCode) => {
        // The status space is walked in full rather than sampled, against a
        // generated body verdict and a generated problem code, so no status is
        // left to chance and none is examined only with an absent code.
        for (const status of ALL_HTTP_STATUSES) {
          expect(
            classifyOutcome({ status, timedOut: false, problemCode, parsed }),
          ).toEqual(expectedOutcomeForStatus(status, parsed, problemCode));
        }
      }),
      { numRuns: 150 },
    );
  });

  it('reaches each of the seven kinds from some settled call', () => {
    // The exclusivity property alone is satisfied by a function that always
    // answered `transport-failure`, so the seven are shown reachable too.
    const witnesses: readonly (readonly [SettledCall, string])[] = [
      [{ status: 200, timedOut: false, problemCode: null, parsed: true }, 'success'],
      [
        { status: 404, timedOut: false, problemCode: null, parsed: false },
        'not-found',
      ],
      [
        { status: 401, timedOut: false, problemCode: null, parsed: false },
        'auth-failure',
      ],
      [
        { status: 409, timedOut: false, problemCode: null, parsed: false },
        'rejected-input',
      ],
      [{ status: null, timedOut: true, problemCode: null, parsed: false }, 'timeout'],
      [
        { status: 500, timedOut: false, problemCode: null, parsed: false },
        'transport-failure',
      ],
      [
        { status: 200, timedOut: false, problemCode: null, parsed: false },
        'parse-failure',
      ],
    ];

    expect(witnesses.map(([call]) => classifyOutcome(call).kind)).toEqual(
      witnesses.map(([, kind]) => kind),
    );
    expect(new Set(witnesses.map(([, kind]) => kind)).size).toBe(7);
  });
});

// Feature: web-squads-screens, Property 39: Every settled call classifies into exactly one of seven outcomes
// Validates: Requirements 16.3, 17.8
describe('classifyOutcome — the timeout stays distinguishable', () => {
  it('yields timeout whenever the feature own limit fired, whatever else arrived', () => {
    fc.assert(
      fc.property(anyStatusArb, problemCodeArb, fc.boolean(), (status, problemCode, parsed) => {
        // 16.3: a call can both lapse and settle. The timeout is read first, so a
        // status arriving after the 10-second limit — a success, a `404`, a
        // rejection — cannot mask it.
        expect(classifyOutcome({ status, timedOut: true, problemCode, parsed })).toEqual({
          kind: 'timeout',
        });
      }),
      { numRuns: 1000 },
    );
  });

  it('separates the timeout from the transport failure and the parse failure', () => {
    fc.assert(
      fc.property(problemCodeArb, (problemCode) => {
        // 16.3 asks for three distinguishable outcomes where a screen shows one
        // message; the three inputs that produce them are asserted side by side
        // so a collapse of any pair fails.
        const timedOut = classifyOutcome({
          status: null,
          timedOut: true,
          problemCode,
          parsed: false,
        });
        const noResponse = classifyOutcome({
          status: null,
          timedOut: false,
          problemCode,
          parsed: false,
        });
        const unparsedBody = classifyOutcome({
          status: 200,
          timedOut: false,
          problemCode,
          parsed: false,
        });

        expect([timedOut.kind, noResponse.kind, unparsedBody.kind]).toEqual([
          'timeout',
          'transport-failure',
          'parse-failure',
        ]);
        expect(new Set([timedOut.kind, noResponse.kind, unparsedBody.kind]).size).toBe(
          3,
        );
      }),
      { numRuns: 200 },
    );
  });

  it('yields transport failure when no response arrived and no limit fired', () => {
    fc.assert(
      fc.property(problemCodeArb, fc.boolean(), (problemCode, parsed) => {
        // A network error, a DNS failure, or an abort: `null` is the absence of a
        // response, and no problem code or body verdict changes that.
        expect(
          classifyOutcome({ status: null, timedOut: false, problemCode, parsed }),
        ).toEqual({ kind: 'transport-failure' });
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: web-squads-screens, Property 39: Every settled call classifies into exactly one of seven outcomes
// Validates: Requirements 16.3, 17.8
describe('classifyOutcome — the rejection reason', () => {
  it('reads the reason from the problem code when the code names one', () => {
    fc.assert(
      fc.property(rejectingStatusArb, namedProblemCodeArb, fc.boolean(), (status, problemCode, parsed) => {
        const reason = REASON_BY_PROBLEM_CODE.get(problemCode);

        expect(classifyOutcome({ status, timedOut: false, problemCode, parsed })).toEqual({
          kind: 'rejected-input',
          reason,
        });
      }),
      { numRuns: 500 },
    );
  });

  it('falls back to the status default when the code names none', () => {
    fc.assert(
      fc.property(rejectingStatusArb, unnamedProblemCodeArb, fc.boolean(), (status, problemCode, parsed) => {
        // An unmapped code, a code a later backend adds, and an inherited
        // property name all land here. Each must name the status default rather
        // than throwing, yielding nothing, or — for `'toString'` and
        // `'constructor'` — resolving to a `Function` off the table's prototype.
        expect(classifyOutcome({ status, timedOut: false, problemCode, parsed })).toEqual({
          kind: 'rejected-input',
          reason: DEFAULT_REASON_BY_STATUS.get(status),
        });
      }),
      { numRuns: 1000 },
    );
  });

  it('names a reason from the five, for every rejecting call', () => {
    fc.assert(
      fc.property(rejectingStatusArb, problemCodeArb, fc.boolean(), (status, problemCode, parsed) => {
        const outcome = classifyOutcome({ status, timedOut: false, problemCode, parsed });

        expect(outcome.kind).toBe('rejected-input');
        expect(
          outcome.kind === 'rejected-input' &&
            (REJECTION_REASONS as readonly string[]).includes(outcome.reason),
        ).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('turns no other status into a rejection, whatever code the body carried', () => {
    fc.assert(
      fc.property(
        httpStatusArb.filter((status) => !DEFAULT_REASON_BY_STATUS.has(status)),
        problemCodeArb,
        fc.boolean(),
        (status, problemCode, parsed) => {
          // A `DisplayNameInUse` on a `500`, or on a `200`, is not a rejection a
          // person can correct; the status decides, and the code only names the
          // reason once the status has said there is one.
          const outcome = classifyOutcome({ status, timedOut: false, problemCode, parsed });

          expect(outcome.kind).not.toBe('rejected-input');
          expect(outcome).toEqual(
            classifyOutcome({ status, timedOut: false, problemCode: null, parsed }),
          );
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('reads the body verdict only for a 2xx', () => {
    fc.assert(
      fc.property(
        httpStatusArb.filter((status) => verdictForStatus(status) !== 'body-decides'),
        problemCodeArb,
        (status, problemCode) => {
          // 16.4: only a success carries a value a screen would render, so
          // `parsed` may not swing the outcome of any other status.
          expect(classifyOutcome({ status, timedOut: false, problemCode, parsed: true })).toEqual(
            classifyOutcome({ status, timedOut: false, problemCode, parsed: false }),
          );
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('does not coerce a problem code, so a hostile toString or valueOf never runs', () => {
    fc.assert(
      fc.property(rejectingStatusArb, namedProblemCodeArb, (status, code) => {
        let conversions = 0;
        const hostile = {
          valueOf() {
            conversions += 1;
            return code;
          },
          toString() {
            conversions += 1;
            return code;
          },
        };

        const outcome = classifyOutcome({
          status,
          timedOut: false,
          problemCode: hostile as unknown as string,
          parsed: false,
        });

        expect(outcome).toEqual({
          kind: 'rejected-input',
          reason: DEFAULT_REASON_BY_STATUS.get(status),
        });
        expect(conversions).toBe(0);
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: web-squads-screens, Property 39: Every settled call classifies into exactly one of seven outcomes
// Validates: Requirements 16.3, 17.8
describe('classifyOutcome — no backend-supplied text rides out', () => {
  it('carries nothing but its kind, and a rejection nothing but a named reason', () => {
    fc.assert(
      fc.property(settledCallArb, (call) => {
        // 17.2: the field set is the mechanism. There is no field on any kind
        // that could hold a detail, a title, a status, or a request path, so a
        // screen reaching for the backend wording finds none.
        const outcome = classifyOutcome(call);

        if (outcome.kind === 'rejected-input') {
          expect(Object.keys(outcome).sort()).toEqual(['kind', 'reason']);
        } else {
          expect(Object.keys(outcome)).toEqual(['kind']);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('lets no detail, title, instance, or extension content reach the outcome', () => {
    fc.assert(
      fc.property(
        settledCallArb,
        backendTextArb,
        backendTextArb,
        backendTextArb,
        backendTextArb,
        (call, detail, title, instance, traceId) => {
          // The whole of a ProblemDetails body is offered — including as the
          // `code` extension itself — and the serialised outcome is searched for
          // every piece of it.
          const outcome = classifyOutcome(
            withProblemBody({ ...call, problemCode: detail }, {
              detail,
              title,
              instance,
              traceId,
              errors: { displayName: [detail] },
              extensions: { title, instance },
            }),
          );
          const serialised = JSON.stringify(outcome);

          for (const text of [detail, title, instance, traceId]) {
            expect(serialised).not.toContain(text);
          }
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('yields the same outcome whether or not the rest of the problem body is present', () => {
    fc.assert(
      fc.property(settledCallArb, backendTextArb, (call, text) => {
        // Nothing outside the four signals is read, so the extra content cannot
        // change the classification either — it is inert, not merely unrendered.
        expect(
          classifyOutcome(
            withProblemBody(call, { detail: text, title: text, status: 599, code: text }),
          ),
        ).toEqual(classifyOutcome(call));
      }),
      { numRuns: 500 },
    );
  });
});

// Feature: web-squads-screens, Property 39: Every settled call classifies into exactly one of seven outcomes
// Validates: Requirements 16.3, 17.8
describe('classifyOutcome — total, pure, and reproducible', () => {
  it('classifies a status no backend sends without throwing', () => {
    fc.assert(
      fc.property(impossibleStatusArb, problemCodeArb, fc.boolean(), (status, problemCode, parsed) => {
        // `0`, a negative, `NaN`, either infinity, a fraction: a response
        // claiming an impossible status still settles into one of the seven.
        const outcome = classifyOutcome({ status, timedOut: false, problemCode, parsed });

        expect(acceptingShapes(outcome)).toHaveLength(1);
      }),
      { numRuns: 1000 },
    );
  });

  it('treats a status outside 100 to 599 as a transport failure', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(
            0,
            -0,
            -1,
            99,
            600,
            1000,
            Number.NaN,
            Number.POSITIVE_INFINITY,
            Number.NEGATIVE_INFINITY,
            Number.MAX_SAFE_INTEGER,
            Number.MIN_SAFE_INTEGER,
          ),
          fc.integer({ min: -1000, max: 99 }),
          fc.integer({ min: 600, max: 100_000 }),
        ),
        problemCodeArb,
        fc.boolean(),
        (status, problemCode, parsed) => {
          // Deliberately excludes fractions inside 200–299: a `Response.status`
          // is always an integer, so `250.5` is unreachable, and the module reads
          // it as a success rather than as a transport failure. Asserting either
          // way there would fix behaviour no call can produce, so this states only
          // the region that matters and the totality test above covers the rest.
          expect(classifyOutcome({ status, timedOut: false, problemCode, parsed })).toEqual({
            kind: 'transport-failure',
          });
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('answers the same for the same call, every time', () => {
    fc.assert(
      fc.property(settledCallArb, (call) => {
        const first = classifyOutcome(call);

        expect(classifyOutcome(call)).toEqual(first);
        expect(classifyOutcome({ ...call })).toEqual(first);
      }),
      { numRuns: 500 },
    );
  });

  it('mutates nothing it was given', () => {
    fc.assert(
      fc.property(settledCallArb, (call) => {
        // Purity is what lets the same classification serve a live call and a
        // replayed one; a mutated input would make the second answer differ.
        const before = JSON.stringify(call);

        classifyOutcome(call);

        expect(JSON.stringify(call)).toBe(before);
      }),
      { numRuns: 500 },
    );
  });
});
