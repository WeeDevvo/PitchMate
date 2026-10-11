import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  classifyOutcome,
  type CallOutcomeKind,
  type SettledCall,
} from './callOutcome';

/**
 * Property test for the concealment half of the Player_Stats_Feature's outcome
 * classification, placed beside the module it covers as the design's Testing
 * Strategy asks and running well above the 100-iteration floor.
 *
 * This file carries **Property 2: Every concealed status classifies identically,
 * and no input yields an authentication outcome.** Two claims, one requirement
 * each:
 *
 *  - **Requirement 3.2.** `GetPlayerProfile` answers one byte-for-byte identical,
 *    `code`-free `404` for a non-existent squad, a non-existent membership, a
 *    cross-squad membership, a caller who is not an active member, *and* a
 *    missing, malformed, or expired token. `401` and `403` are folded into the
 *    same branch, because a status the operation does not declare must not become
 *    the one distinction the concealment exists to remove. So each of the three
 *    classifies as `not-found`, **and the three outcomes are indistinguishable
 *    from one another** — not merely equal in their tag, but equal in their whole
 *    value and in their serialisation, because a field that differed between them
 *    would be a tell a screen could render (3.2).
 *  - **Requirement 3.4.** There is no authentication outcome to branch on,
 *    present, or hand the session over on. That is asserted here as a statement
 *    about the **returned type** rather than about the call sites: over every
 *    generated settled call the kind is one of the five declared names, and the
 *    union is pinned at exactly five members at compile time, so a sixth — an
 *    `auth-failure` arm above all — fails the build before any screen could read
 *    it.
 *
 * Three things about how this is written matter more than the run counts.
 *
 * First, the type-level assertions are the **real** guarantee for 3.4 and the
 * runtime ones are their witnesses. `CALL_OUTCOME_KIND_IS_FIVE_VALUED` and its
 * two companions below are `const` declarations whose annotations evaluate to
 * `true` only while the union has exactly the five declared members; adding an
 * arm makes the annotation `false` and the initialiser stops typechecking. They
 * are additionally read in an assertion so they cannot rot into unused
 * declarations, and so the intent is visible when the suite runs.
 *
 * Second, the **declared names are transcribed** from Requirement 12.8 rather
 * than derived from the module, so this file and `callOutcome.ts` can disagree
 * and a defect shows. A suite that read its expectations out of the module's own
 * vocabulary would accept any vocabulary at all.
 *
 * Third, "identical" is asserted as **indistinguishability between the three
 * statuses**, with a guard against vacuity. A `classifyOutcome` that answered
 * `not-found` for everything would satisfy the identity claim trivially, so the
 * converse is stated too: no status outside the three concealed ones classifies
 * as `not-found`, and three other kinds are shown reachable.
 *
 * The timeout's precedence over every status is **not** this file's claim — it is
 * Property 3's — so every call generated here reports `timedOut: false`, and the
 * one place that matters is noted where it arises.
 *
 * Validates: Requirements 3.2, 3.4
 */

// --- the vocabulary, transcribed from Requirement 12.8 -----------------------

/**
 * The five outcome names the requirement declares, in the order the module's
 * decision table reaches them.
 *
 * Transcribed, not imported: the module exports no tuple of its names, and a
 * list derived from the type would agree with whatever the type said.
 */
const DECLARED_OUTCOME_NAMES = [
  'success',
  'not-found',
  'timeout',
  'transport-failure',
  'parse-failure',
] as const;

/** One of the five declared names. */
type DeclaredOutcomeName = (typeof DECLARED_OUTCOME_NAMES)[number];

/** The names the union under test actually carries. */
type OutcomeName = CallOutcomeKind['kind'];

/**
 * The names an authentication arm would plausibly be given, none of which may
 * exist (3.4).
 *
 * This list is not a type-level guarantee — the two `Exclude` assertions below
 * are, and they catch an arm of *any* name. It is here because it names the
 * actual failure mode in the actual words a later contributor would reach for,
 * and because it is also searched for inside the serialised outcome, where a
 * tell would have to appear as text to be renderable.
 */
const FORBIDDEN_AUTHENTICATION_NAMES: readonly string[] = [
  'auth',
  'auth-failure',
  'authentication',
  'authentication-failure',
  'auth-required',
  'unauthenticated',
  'unauthorized',
  'unauthorised',
  'forbidden',
  'session-expired',
  'session-lost',
  'sign-in-required',
  'signin-required',
  'login-required',
  'token-expired',
  'reauthenticate',
  'not-a-member',
  'no-access',
];

/**
 * Words that would betray an authentication cause, or the status that carried
 * it, if either ever reached the outcome as text.
 *
 * Searched case-insensitively inside the serialised outcome. None of the five
 * declared names contains any of them, so the search is sound rather than
 * merely strict.
 */
const FORBIDDEN_OUTCOME_SUBSTRINGS: readonly string[] = [
  'auth',
  'session',
  'token',
  'unauthor',
  'forbidden',
  'login',
  'sign-in',
  'signin',
  'credential',
  'bearer',
  'member',
  '401',
  '403',
  '404',
];

// --- the type-level assertions: the union has exactly five members -----------

/**
 * `true` exactly when `Size` is the single numeric literal `5`.
 *
 * Both directions on purpose: `number extends 5` is false, but `5 extends
 * number` is true, so a one-way check would pass for a union whose size could
 * not be resolved to a literal at all.
 */
type IsFive<Size> = Size extends 5 ? (5 extends Size ? true : false) : false;

/** `true` exactly when the type is uninhabited. */
type IsNever<Candidate> = [Candidate] extends [never] ? true : false;

/** Collapses a union into the intersection of its members. */
type UnionToIntersection<Union> = (
  Union extends unknown ? (member: Union) => void : never
) extends (member: infer Intersection) => void
  ? Intersection
  : never;

/** One member of a union, picked by overload resolution. */
type LastOfUnion<Union> =
  UnionToIntersection<Union extends unknown ? () => Union : never> extends () => infer Last
    ? Last
    : never;

/**
 * How many members a union has, as a numeric literal.
 *
 * Counts by removing one member at a time and growing a tuple whose length is
 * read at the end. The length is read from the **accumulator** — a type
 * parameter already constrained to a tuple — rather than from the recursion's
 * own result, which the compiler cannot see is an array until it has unrolled.
 */
type UnionSize<Union, Counted extends readonly unknown[] = []> = [Union] extends [
  never,
]
  ? Counted['length']
  : UnionSize<Exclude<Union, LastOfUnion<Union>>, [unknown, ...Counted]>;

/** Every key any arm of the union declares, other than the discriminant. */
type ExtraArmKeys<Union> = Union extends unknown ? Exclude<keyof Union, 'kind'> : never;

/**
 * **The type-level assertion Requirement 3.4 rests on: `CallOutcomeKind` has
 * exactly five members.**
 *
 * Adding a sixth arm — an `auth-failure` most of all — makes this annotation
 * `false`, and `const … : false = true` does not typecheck. So the absence of an
 * authentication outcome is a build-time fact about the type, not a convention
 * every caller has to remember (3.4).
 */
const CALL_OUTCOME_KIND_IS_FIVE_VALUED: IsFive<UnionSize<CallOutcomeKind>> = true;

/** The same count read through the discriminant, so neither spelling can drift. */
const CALL_OUTCOME_NAME_IS_FIVE_VALUED: IsFive<UnionSize<OutcomeName>> = true;

/**
 * No arm carries a name this file does not declare.
 *
 * This is what catches a sixth arm *whatever it is called* — including a name no
 * forbidden list anticipated.
 */
const NO_UNDECLARED_OUTCOME_NAME: IsNever<Exclude<OutcomeName, DeclaredOutcomeName>> =
  true;

/** And none of the five declared names has gone missing from the union. */
const EVERY_DECLARED_OUTCOME_NAME_EXISTS: IsNever<
  Exclude<DeclaredOutcomeName, OutcomeName>
> = true;

/**
 * No arm declares a field beyond its tag (3.2, 3.7).
 *
 * The concealment claim is about indistinguishability, and a field on any arm
 * would be somewhere for a status, a header, a body, or a cause to ride into the
 * screen — at which point two concealed causes could render differently.
 */
const NO_OUTCOME_ARM_CARRIES_A_FIELD: IsNever<ExtraArmKeys<CallOutcomeKind>> = true;

// --- the same assertions, shown non-vacuous on a planted sixth arm -----------

/**
 * Non-vacuity for the three assertions above, in the same style as Property
 * 14's planted member: each is re-stated against a deliberately widened union
 * and must answer the opposite.
 *
 * An `IsFive` that resolved to `true` for everything, or an `IsNever` that
 * swallowed a real difference, would make the assertions above decoration. Here
 * the machinery is handed exactly the mistake it exists to catch — a sixth
 * member, an `auth-failure` arm, and an arm carrying a status — and each
 * initialiser is `false`, which typechecks only because the machinery saw it.
 */
const SIX_MEMBERS_ARE_NOT_FIVE: IsFive<
  UnionSize<'a' | 'b' | 'c' | 'd' | 'e' | 'f'>
> = false;

/** A planted `auth-failure` arm is reported as an undeclared name. */
const PLANTED_AUTHENTICATION_ARM_IS_DETECTED: IsNever<
  Exclude<OutcomeName | 'auth-failure', DeclaredOutcomeName>
> = false;

/** A planted field on an arm is reported as an extra key. */
const PLANTED_ARM_FIELD_IS_DETECTED: IsNever<
  ExtraArmKeys<CallOutcomeKind | { readonly kind: 'timeout'; readonly status: number }>
> = false;

// --- generators --------------------------------------------------------------

/** The three statuses the endpoint conceals every absent and inaccessible subject behind. */
const CONCEALED_STATUSES = [401, 403, 404] as const;

const concealedStatusArb: fc.Arbitrary<number> = fc.constantFrom(
  ...CONCEALED_STATUSES,
);

/** Every integer status the requirement speaks about: 100 to 599 inclusive. */
const ALL_HTTP_STATUSES: readonly number[] = Array.from(
  { length: 500 },
  (_unused, offset) => 100 + offset,
);

/** Statuses no backend sends, which must still classify rather than conceal. */
const impossibleStatusArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom(
      0,
      -0,
      -1,
      -401,
      -404,
      1,
      99,
      600,
      1000,
      40_401,
      4040,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
      400.5,
      401.5,
      403.5,
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

/** Any status signal at all, the absence of a response included. */
const anyStatusArb: fc.Arbitrary<number | null> = fc.oneof(
  { weight: 4, arbitrary: concealedStatusArb },
  { weight: 6, arbitrary: fc.constantFrom(...ALL_HTTP_STATUSES) },
  { weight: 3, arbitrary: fc.constant(null) },
  { weight: 3, arbitrary: impossibleStatusArb },
);

/**
 * A settled call of any shape whatsoever, the lapsed timeout included.
 *
 * `timedOut` is generated here, in the suite about the five names, because 3.4
 * is a claim about *every* input. The identity claim about the three concealed
 * statuses keeps `timedOut: false`, since a lapsed limit is a `timeout` by
 * Property 3 and so says nothing about concealment.
 */
const anySettledCallArb: fc.Arbitrary<SettledCall> = fc.record({
  status: anyStatusArb,
  timedOut: fc.boolean(),
  parsed: fc.boolean(),
});

/** A settled call whose own limit never fired. */
const settledInTimeArb: fc.Arbitrary<SettledCall> = fc.record({
  status: anyStatusArb,
  timedOut: fc.constant(false),
  parsed: fc.boolean(),
});

/** The canonical concealed outcome, written out rather than taken from the module. */
const NOT_FOUND: CallOutcomeKind = { kind: 'not-found' };

// --- the type-level assertions, read where the suite runs --------------------

// Feature: web-player-stats-screen, Property 2: Every concealed status classifies
// identically, and no input yields an authentication outcome — the union is
// pinned at five members
// Validates: Requirements 3.2, 3.4
describe('CallOutcomeKind — exactly five members, none of them authentication', () => {
  it('has exactly five members, asserted at compile time', () => {
    // The guarantee is the annotation on each constant: a sixth arm makes it
    // `false` and the declaration stops typechecking (3.4). They are read here
    // so they cannot decay into unused declarations, and so the intent is
    // visible when the suite runs.
    expect(CALL_OUTCOME_KIND_IS_FIVE_VALUED).toBe(true);
    expect(CALL_OUTCOME_NAME_IS_FIVE_VALUED).toBe(true);
  });

  it('declares exactly the five names, with none undeclared and none missing', () => {
    expect(NO_UNDECLARED_OUTCOME_NAME).toBe(true);
    expect(EVERY_DECLARED_OUTCOME_NAME_EXISTS).toBe(true);

    // The transcription itself: five distinct names, stated literally, because a
    // list derived from the module would agree with any list at all.
    expect(DECLARED_OUTCOME_NAMES).toHaveLength(5);
    expect(new Set(DECLARED_OUTCOME_NAMES).size).toBe(5);
  });

  it('names no authentication outcome among the five', () => {
    // 3.4 in the words a contributor would actually reach for. The `Exclude`
    // assertion above is the general guarantee; this names the specific mistake.
    for (const name of DECLARED_OUTCOME_NAMES) {
      expect(FORBIDDEN_AUTHENTICATION_NAMES).not.toContain(name);
    }
  });

  it('declares no field on any arm, so no cause can ride along', () => {
    expect(NO_OUTCOME_ARM_CARRIES_A_FIELD).toBe(true);
  });

  it('detects a planted sixth member, an auth arm, and a planted field', () => {
    // Non-vacuity: the same machinery, handed the mistakes it exists to catch,
    // answers the opposite. Without this the three assertions above would hold
    // for a check that answered `true` unconditionally.
    expect(SIX_MEMBERS_ARE_NOT_FIVE).toBe(false);
    expect(PLANTED_AUTHENTICATION_ARM_IS_DETECTED).toBe(false);
    expect(PLANTED_ARM_FIELD_IS_DETECTED).toBe(false);
  });
});

// --- claim one: the three concealed statuses classify identically ------------

// Feature: web-player-stats-screen, Property 2: Every concealed status classifies
// identically, and no input yields an authentication outcome — every concealed
// status is not-found
// Validates: Requirements 3.2, 3.4
describe('classifyOutcome — every concealed status classifies as not-found', () => {
  it('classifies 401, 403, and 404 as not-found for every parse verdict', () => {
    fc.assert(
      fc.property(concealedStatusArb, fc.boolean(), (status, parsed) => {
        // 3.2: the token-shaped causes the backend hides behind `404` reach this
        // branch, and so do the `401` and `403` a contract drift might start
        // emitting. The parse verdict is generated because no concealed status
        // carries a body this feature reads, so it may not swing the outcome.
        expect(classifyOutcome({ status, timedOut: false, parsed })).toEqual(
          NOT_FOUND,
        );
      }),
      { numRuns: 500 },
    );
  });

  it('classifies each of the three identically, for every parse verdict', () => {
    fc.assert(
      fc.property(fc.boolean(), (parsed) => {
        // The identity claim proper: not three outcomes that happen to share a
        // tag, but one value. Compared pairwise and by serialisation, because a
        // field present on one and absent on another would be exactly the tell
        // the concealment removes (3.2).
        const outcomes = CONCEALED_STATUSES.map((status) =>
          classifyOutcome({ status, timedOut: false, parsed }),
        );

        for (const outcome of outcomes) {
          expect(outcome).toEqual(outcomes[0]);
          expect(outcome).toEqual(NOT_FOUND);
          expect(JSON.stringify(outcome)).toBe(JSON.stringify(outcomes[0]));
        }

        expect(new Set(outcomes.map((outcome) => JSON.stringify(outcome))).size).toBe(
          1,
        );
      }),
      { numRuns: 200 },
    );
  });

  it('carries nothing but its kind on a concealed outcome', () => {
    fc.assert(
      fc.property(concealedStatusArb, fc.boolean(), (status, parsed) => {
        // The runtime witness for the type-level no-field assertion: nothing on
        // the value distinguishes an absent squad from an absent membership from
        // an absent session (3.2, 3.7).
        const outcome = classifyOutcome({ status, timedOut: false, parsed });

        expect(Object.keys(outcome)).toEqual(['kind']);
      }),
      { numRuns: 300 },
    );
  });

  it('ignores the parse verdict entirely for a concealed status', () => {
    fc.assert(
      fc.property(concealedStatusArb, (status) => {
        // Stated as an equality between the two verdicts rather than against the
        // expected value, so a classification that started reading the body of a
        // rejection — and could therefore differ between two concealed causes —
        // fails here.
        expect(classifyOutcome({ status, timedOut: false, parsed: true })).toEqual(
          classifyOutcome({ status, timedOut: false, parsed: false }),
        );
      }),
      { numRuns: 200 },
    );
  });

  it('conceals nothing beyond those three statuses, so the identity is not vacuous', () => {
    fc.assert(
      fc.property(fc.boolean(), (parsed) => {
        // The converse, walked over the whole status space rather than sampled:
        // a classification answering `not-found` for everything would satisfy the
        // identity claim trivially, and would also fold a `500` into the
        // Not_Found_Treatment where Requirement 4.3 wants the
        // Generic_Profile_Failure.
        for (const status of ALL_HTTP_STATUSES) {
          const concealed =
            classifyOutcome({ status, timedOut: false, parsed }).kind === 'not-found';

          expect(concealed, `status ${String(status)}`).toBe(
            (CONCEALED_STATUSES as readonly number[]).includes(status),
          );
        }
      }),
      { numRuns: 150 },
    );
  });

  it('reaches three other kinds, so not-found is not the only answer', () => {
    // Reachability witnesses rather than a mapping oracle — the full mapping is
    // Property 1's claim. Three distinct non-concealed kinds are enough to show
    // the identity above is a statement about the three statuses and not about
    // the function being constant.
    const witnesses: readonly (readonly [SettledCall, string])[] = [
      [{ status: 200, timedOut: false, parsed: true }, 'success'],
      [{ status: 200, timedOut: false, parsed: false }, 'parse-failure'],
      [{ status: 500, timedOut: false, parsed: false }, 'transport-failure'],
    ];

    expect(witnesses.map(([call]) => classifyOutcome(call).kind)).toEqual(
      witnesses.map(([, kind]) => kind),
    );
    expect(new Set(witnesses.map(([, kind]) => kind)).size).toBe(3);
  });
});

// --- claim two: no input yields an authentication outcome -------------------

// Feature: web-player-stats-screen, Property 2: Every concealed status classifies
// identically, and no input yields an authentication outcome — no settled call
// produces one
// Validates: Requirements 3.2, 3.4
describe('classifyOutcome — no settled call yields an authentication outcome', () => {
  it('yields one of the five declared names for every settled call', () => {
    fc.assert(
      fc.property(anySettledCallArb, (call) => {
        // 3.4: there is no authentication outcome to branch on because the
        // returned value is always one of these five, whatever arrived — a
        // `401`, a lapsed limit, an absent response, an impossible status.
        const outcome = classifyOutcome(call);

        expect(DECLARED_OUTCOME_NAMES).toContain(outcome.kind);
      }),
      { numRuns: 2000 },
    );
  });

  it('yields no authentication-shaped kind for every settled call', () => {
    fc.assert(
      fc.property(anySettledCallArb, (call) => {
        const outcome = classifyOutcome(call);

        expect(FORBIDDEN_AUTHENTICATION_NAMES).not.toContain(outcome.kind);
      }),
      { numRuns: 1000 },
    );
  });

  it('lets no authentication word or concealed status reach the outcome as text', () => {
    fc.assert(
      fc.property(anySettledCallArb, (call) => {
        // A tell has to be renderable to matter, so the whole serialised outcome
        // is searched: no cause, no status, and no session wording is reachable
        // from it (3.2, 3.7).
        const serialised = JSON.stringify(classifyOutcome(call)).toLowerCase();

        for (const forbidden of FORBIDDEN_OUTCOME_SUBSTRINGS) {
          expect(serialised, forbidden).not.toContain(forbidden);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('answers a 401 exactly as it answers a 404, for every parse verdict', () => {
    fc.assert(
      fc.property(fc.boolean(), (parsed) => {
        // The one comparison 3.4 is really about: the status an expired session
        // would arrive as, held against the status an absent player arrives as.
        // If these two ever diverged, a screen could infer the session had ended
        // and hand it over — which this feature must never do on the strength of
        // a stats call.
        expect(classifyOutcome({ status: 401, timedOut: false, parsed })).toEqual(
          classifyOutcome({ status: 404, timedOut: false, parsed }),
        );
        expect(classifyOutcome({ status: 403, timedOut: false, parsed })).toEqual(
          classifyOutcome({ status: 404, timedOut: false, parsed }),
        );
      }),
      { numRuns: 200 },
    );
  });

  it('is deterministic, so no outcome depends on when it was asked', () => {
    fc.assert(
      fc.property(settledInTimeArb, (call) => {
        // A concealed cause that classified differently on a second reading
        // would be distinguishable by repetition alone.
        expect(classifyOutcome(call)).toEqual(classifyOutcome(call));
        expect(classifyOutcome(call)).toEqual(classifyOutcome(call));
      }),
      { numRuns: 500 },
    );
  });
});
