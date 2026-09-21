import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { REDEEM_OUTCOME_CODES, redeemOutcomeFromCode } from '../enumCodes';
import { isSquadIdentifier } from '../identifiers';
import type { ParseResult } from './primitives';
import { parseRedemption, type Redemption } from './redemption';

/**
 * Property test for the `RedeemInvite` body shape, placed beside the module it
 * covers as the design's Testing Strategy asks and running well above the
 * 100-iteration floor (20.1).
 *
 * This file carries **Property 35** for `redemption.ts`: for any value supplied as a
 * response body — absent, `null`, a primitive of every type, an array, an object
 * with each field missing, an object with each field mistyped, an enum field
 * carrying a code the Enum_Code_Map does not name, and a value nested a hundred
 * levels deep — the parser yields exactly one of a fully populated Redemption and a
 * parse failure, and raises nothing (16.4, 16.6).
 *
 * This is the one operation with **two valid wire forms**, and the shape of the
 * assertions follows from that.
 *
 * **The empty body is a success, not a failure.** The already-a-member no-op returns
 * `200` with no body, which the transport seam hands on as an absence. Failing it
 * would turn "you are already in this squad" into the Generic_Squads_Failure, telling
 * a person their invite did not work when nothing needed doing. So `undefined` and
 * `null` parse — and they parse to the *same* value an empty object parses to, which
 * is asserted rather than assumed.
 *
 * **Every field is optional, and none is unvalidated.** A present `membershipId`
 * that is not an identity, and a present `outcome` the map does not name, each fail
 * the body. `RedeemOutcome` is one of the two **0-based** wire enums, so the
 * out-of-range generator leads with `3` — the code a 1-based misreading would name,
 * and the very code the task names for `SkillTier`, which is 0-based for the same
 * reason.
 *
 * **`squadId` is read although the backend does not send it.** Requirements 4.6 and
 * 5.8 describe a branch that navigates straight to a redeemed squad when a redemption
 * yields a squad identity; today that field is always absent, so the assertions cover
 * both the absent form (the normal path) and the present form (the branch that lands
 * unchanged when the backend adds it).
 *
 * Requirements: 4.6, 5.8, 16.4, 16.6, 20.10
 */

/* -------------------------------------------------------------------------- */
/* The totality harness                                                       */
/* -------------------------------------------------------------------------- */

/** A value's own keys, sorted, as a comparable string. */
function keySignature(value: object): string {
  return Object.keys(value).sort().join(',');
}

/**
 * Settles one parse and asserts Property 35's frame: no exception, exactly one of
 * the two result shapes with exactly its own fields, a fully populated value on
 * success, and a non-empty diagnostic reason on failure.
 */
function settle<T>(
  parse: () => ParseResult<T>,
  isFullyPopulated: (value: T) => boolean,
): ParseResult<T> {
  let outcome: ParseResult<T>;

  try {
    outcome = parse();
  } catch (raised) {
    // 16.4: the parser raises nothing, for any input at all.
    throw new Error(`the parser raised instead of failing: ${String(raised)}`, {
      cause: raised,
    });
  }

  expect(typeof outcome).toBe('object');
  expect(outcome).not.toBeNull();
  expect(typeof outcome.ok).toBe('boolean');

  if (outcome.ok) {
    expect(keySignature(outcome)).toBe('ok,value');
    expect(isFullyPopulated(outcome.value)).toBe(true);
  } else {
    expect(keySignature(outcome)).toBe('ok,reason');
    expect(typeof outcome.reason).toBe('string');
    expect(outcome.reason.length).toBeGreaterThan(0);
  }

  return outcome;
}

/* -------------------------------------------------------------------------- */
/* Generators over the whole input space                                      */
/* -------------------------------------------------------------------------- */

/** A well-formed identity, for the generators that need one to spoil. */
const WELL_FORMED_IDENTITY = '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b';

/** Values of every primitive type, together with the two absences. */
const primitiveArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 8,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      true,
      false,
      0,
      -0,
      1,
      2,
      3,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '',
      ' ',
      '0',
      '1',
      '3',
      'joined',
      'already-member',
      '{}',
      WELL_FORMED_IDENTITY,
      0n,
      Symbol('wire'),
    ),
  },
  { weight: 2, arbitrary: fc.string({ maxLength: 32 }) },
  { weight: 2, arbitrary: fc.double() },
  { weight: 1, arbitrary: fc.integer({ min: -4, max: 8 }) },
  { weight: 1, arbitrary: fc.boolean() },
);

/** Arrays, plain objects, and the exotic object shapes a body could carry. */
const structuralArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.constantFrom<unknown>(
      [],
      [{}],
      [[]],
      {},
      { outcome: 0 },
      { membershipId: WELL_FORMED_IDENTITY },
      Object.create(null),
      new Date(0),
      new Map<unknown, unknown>([['outcome', 0]]),
      new Set<unknown>([1]),
      () => ({}),
      Object(1),
      Object('a'),
    ),
  },
  { weight: 3, arbitrary: fc.array(primitiveArb, { maxLength: 4 }) },
  {
    weight: 3,
    arbitrary: fc.dictionary(fc.string({ maxLength: 8 }), primitiveArb, {
      maxKeys: 5,
    }),
  },
  {
    weight: 3,
    arbitrary: fc.anything({
      maxDepth: 3,
      withBigInt: true,
      withDate: true,
      withMap: true,
      withSet: true,
      withNullPrototype: true,
      withObjectString: true,
    }),
  },
);

/** The whole input space Property 35 quantifies over. */
const anyBodyArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 4, arbitrary: primitiveArb },
  { weight: 5, arbitrary: structuralArb },
);

/** Wraps `leaf` in `depth` levels of alternating arrays and objects. */
function nest(leaf: unknown, depth: number): unknown {
  let value: unknown = leaf;

  for (let level = 0; level < depth; level += 1) {
    value = level % 2 === 0 ? [value] : { value };
  }

  return value;
}

/** A value nested to between 1 and 100 levels. */
const deeplyNestedArb: fc.Arbitrary<unknown> = fc
  .tuple(primitiveArb, fc.integer({ min: 1, max: 100 }))
  .map(([leaf, depth]) => nest(leaf, depth));

/* -------------------------------------------------------------------------- */
/* Field-level generators                                                     */
/* -------------------------------------------------------------------------- */

/** Well-formed identities, including the two extremes of the form. */
const identityArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.uuid() },
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      WELL_FORMED_IDENTITY,
      WELL_FORMED_IDENTITY.toUpperCase(),
      '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
    ),
  },
);

/** Present values no identity field accepts. */
const notAPresentIdentityArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom<unknown>(
      '',
      ' ',
      0,
      1,
      true,
      WELL_FORMED_IDENTITY.replace(/-/g, ''),
      `{${WELL_FORMED_IDENTITY}}`,
      ` ${WELL_FORMED_IDENTITY}`,
      `${WELL_FORMED_IDENTITY} `,
      WELL_FORMED_IDENTITY.slice(0, 35),
      `${WELL_FORMED_IDENTITY}b`,
      [WELL_FORMED_IDENTITY],
      { membershipId: WELL_FORMED_IDENTITY },
    ),
  },
  {
    weight: 3,
    arbitrary: anyBodyArb.filter(
      (value) =>
        value !== null && value !== undefined && !isSquadIdentifier(value),
    ),
  },
);

/**
 * Present values no Redeem_Outcome code names.
 *
 * `3` leads: `RedeemOutcome` declares no explicit values in the backend, so it is
 * **0-based** and `joined` is `0`. A 1-based reading would name `3` and shift every
 * outcome by one — the same defect the task names against `SkillTier`, which is
 * 0-based for the same reason. `-1` is the near miss on the other side.
 */
const unnamedOutcomeCodeArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom<unknown>(
      3,
      4,
      -1,
      0.5,
      1.5,
      2.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '0',
      '1',
      'joined',
      'already-member',
      true,
      false,
      [0],
      { outcome: 0 },
      0n,
    ),
  },
  {
    weight: 2,
    arbitrary: anyBodyArb.filter(
      (value) =>
        value !== null &&
        value !== undefined &&
        redeemOutcomeFromCode(value) === undefined,
    ),
  },
);

/* -------------------------------------------------------------------------- */
/* Well-formed bodies, and what a populated value must look like              */
/* -------------------------------------------------------------------------- */

/** The named Redeem_Outcome codes, read from the Enum_Code_Map itself. */
const NAMED_OUTCOME_CODES: readonly number[] = Object.keys(
  REDEEM_OUTCOME_CODES,
).map(Number);

/** The outcome names the Enum_Code_Map carries. */
const OUTCOME_NAMES: readonly string[] = Object.values(REDEEM_OUTCOME_CODES);

/**
 * A well-formed `RedeemInvite` body in its object form, generated across present,
 * explicit `null`, and absent for all three of its optional fields.
 */
const wellFormedArb: fc.Arbitrary<Record<string, unknown>> = fc
  .record({
    membershipId: fc.oneof(
      { weight: 3, arbitrary: identityArb as fc.Arbitrary<unknown> },
      { weight: 1, arbitrary: fc.constant<unknown>(null) },
    ),
    outcome: fc.oneof(
      {
        weight: 3,
        arbitrary: fc.constantFrom(...NAMED_OUTCOME_CODES) as fc.Arbitrary<unknown>,
      },
      { weight: 1, arbitrary: fc.constant<unknown>(null) },
    ),
    squadId: fc.oneof(
      { weight: 1, arbitrary: identityArb as fc.Arbitrary<unknown> },
      { weight: 3, arbitrary: fc.constant<unknown>(null) },
    ),
    dropMembership: fc.boolean(),
    dropOutcome: fc.boolean(),
    dropSquad: fc.boolean(),
  })
  .map(
    ({
      membershipId,
      outcome,
      squadId,
      dropMembership,
      dropOutcome,
      dropSquad,
    }) => {
      const body: Record<string, unknown> = {};

      if (!dropMembership) {
        body.membershipId = membershipId;
      }

      if (!dropOutcome) {
        body.outcome = outcome;
      }

      if (!dropSquad) {
        body.squadId = squadId;
      }

      return body;
    },
  );

/** Every field this shape declares. */
const FIELDS = ['membershipId', 'outcome', 'squadId'] as const;

/**
 * Whether a parsed Redemption is fully populated: exactly the three declared fields,
 * each either a valid value or the absence `null`, with no field left `undefined`.
 *
 * "Fully populated" here means every declared field is *present on the value* —
 * three explicit `null`s for the no-op form rather than a value missing its fields.
 */
function isFullyPopulated(redemption: Redemption): boolean {
  return (
    keySignature(redemption) === 'membershipId,outcome,squadId' &&
    (redemption.membershipId === null ||
      isSquadIdentifier(redemption.membershipId)) &&
    (redemption.outcome === null || OUTCOME_NAMES.includes(redemption.outcome)) &&
    (redemption.squadId === null || isSquadIdentifier(redemption.squadId))
  );
}

/** `body` with `key` defined as an accessor that throws when it is read. */
function throwingAt(
  body: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, unknown> {
  return Object.defineProperty({ ...body }, key, {
    enumerable: true,
    configurable: true,
    get(): never {
      throw new Error('a throwing accessor');
    },
  });
}

/* -------------------------------------------------------------------------- */

// Feature: web-squads-screens, Property 35: Every response parser is total and never yields a partial value
// Validates: Requirements 4.6, 5.8, 16.4, 16.6, 20.10
describe('parseRedemption — total, and never partial', () => {
  it('settles every input into exactly one of a populated value and a failure', () => {
    fc.assert(
      fc.property(anyBodyArb, (body) => {
        settle(() => parseRedemption(body), isFullyPopulated);
      }),
      { numRuns: 1000 },
    );
  });

  it('settles a value nested to 100 levels', () => {
    fc.assert(
      fc.property(deeplyNestedArb, (body) => {
        settle(() => parseRedemption(body), isFullyPopulated);
      }),
      { numRuns: 300 },
    );
  });

  it('settles a well-formed body whose every field is 100 levels deep', () => {
    fc.assert(
      fc.property(
        wellFormedArb,
        fc.constantFrom(...FIELDS),
        deeplyNestedArb,
        (body, key, deep) => {
          const outcome = settle(
            () => parseRedemption({ ...body, [key]: deep }),
            isFullyPopulated,
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('parses the empty body of the already-a-member no-op', () => {
    fc.assert(
      fc.property(fc.constantFrom<unknown>(undefined, null), (absentBody) => {
        const outcome = settle(() => parseRedemption(absentBody), isFullyPopulated);

        // Failing this would tell a person their invite did not work when in fact
        // nothing needed doing.
        expect(outcome.ok).toBe(true);
        expect(outcome.ok && outcome.value).toEqual({
          membershipId: null,
          outcome: null,
          squadId: null,
        });
      }),
      { numRuns: 100 },
    );
  });

  it('parses an empty object to the same value as an empty body', () => {
    fc.assert(
      fc.property(fc.constantFrom<unknown>(undefined, null), (absentBody) => {
        const fromAbsence = parseRedemption(absentBody);
        const fromEmptyObject = parseRedemption({});

        // The two wire forms of the no-op converge on one value, so no screen has
        // to know which the transport happened to hand it.
        expect(fromAbsence).toEqual(fromEmptyObject);
      }),
      { numRuns: 100 },
    );
  });

  it('parses every well-formed body into a fully populated value', () => {
    fc.assert(
      fc.property(wellFormedArb, (body) => {
        const outcome = settle(() => parseRedemption(body), isFullyPopulated);

        expect(outcome.ok).toBe(true);

        if (outcome.ok) {
          expect(outcome.value.membershipId).toBe(
            body.membershipId === null || body.membershipId === undefined
              ? null
              : body.membershipId,
          );
          expect(outcome.value.outcome).toBe(
            body.outcome === null || body.outcome === undefined
              ? null
              : redeemOutcomeFromCode(body.outcome),
          );
          expect(outcome.value.squadId).toBe(
            body.squadId === null || body.squadId === undefined
              ? null
              : body.squadId,
          );
        }
      }),
      { numRuns: 500 },
    );
  });

  it('parses the identity-bearing form the backend sends today', () => {
    fc.assert(
      fc.property(
        identityArb,
        fc.constantFrom(...NAMED_OUTCOME_CODES),
        (membershipId, outcomeCode) => {
          const outcome = settle(
            () => parseRedemption({ membershipId, outcome: outcomeCode }),
            isFullyPopulated,
          );

          expect(outcome.ok).toBe(true);
          expect(outcome.ok && outcome.value.membershipId).toBe(membershipId);
          expect(outcome.ok && outcome.value.outcome).toBe(
            redeemOutcomeFromCode(outcomeCode),
          );
          // Not sent by the backend today, so the fallback path — navigate to the
          // Squads_Home and re-list — is the normal one (4.6, 5.8).
          expect(outcome.ok && outcome.value.squadId).toBeNull();
        },
      ),
      { numRuns: 300 },
    );
  });

  it('names each of the three outcomes, so the 0-based table is not read as 1-based', () => {
    const outcome = settle(
      () => parseRedemption({ outcome: 0 }),
      isFullyPopulated,
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.value.outcome).toBe('joined');

    for (const [code, expected] of [
      [0, 'joined'],
      [1, 'reactivated'],
      [2, 'already-member'],
    ] as const) {
      const named = settle(
        () => parseRedemption({ outcome: code }),
        isFullyPopulated,
      );

      expect(named.ok && named.value.outcome).toBe(expected);
    }

    // A 1-based reading would name `3`, and the correct table must not.
    expect(parseRedemption({ outcome: 3 }).ok).toBe(false);
  });

  it('fails when a present outcome code names nothing, 3 included', () => {
    fc.assert(
      fc.property(wellFormedArb, unnamedOutcomeCodeArb, (body, outcomeCode) => {
        const result = settle(
          () => parseRedemption({ ...body, outcome: outcomeCode }),
          isFullyPopulated,
        );

        expect(result.ok).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('fails when a present identity field is not an identity', () => {
    fc.assert(
      fc.property(
        wellFormedArb,
        fc.constantFrom('membershipId', 'squadId'),
        notAPresentIdentityArb,
        (body, key, value) => {
          const result = settle(
            () => parseRedemption({ ...body, [key]: value }),
            isFullyPopulated,
          );

          // Optional means absent-or-valid, never unvalidated.
          expect(result.ok).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('fails every non-object body that is neither absent nor null', () => {
    fc.assert(
      fc.property(
        anyBodyArb.filter(
          (value) =>
            value !== null &&
            value !== undefined &&
            (typeof value !== 'object' || Array.isArray(value)),
        ),
        (body) => {
          const result = settle(() => parseRedemption(body), isFullyPopulated);

          // A string, a number, a boolean, and an array are none of them a
          // redemption body — only the two absences are the no-op form.
          expect(result.ok).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('parses rather than raising when a named field throws on read', () => {
    fc.assert(
      fc.property(wellFormedArb, fc.constantFrom(...FIELDS), (body, key) => {
        const result = settle(
          () => parseRedemption(throwingAt(body, key)),
          isFullyPopulated,
        );

        // Every field here is optional, so a throwing accessor reads as the absence
        // it cannot be distinguished from, and the body still parses.
        expect(result.ok).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('is deterministic, so no reading depends on a clock or a counter', () => {
    fc.assert(
      fc.property(fc.oneof(anyBodyArb, wellFormedArb), (body) => {
        expect(parseRedemption(body)).toEqual(parseRedemption(body));
      }),
      { numRuns: 400 },
    );
  });

  it('composes its reason from field labels and never from the value', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('SUPER-SECRET-TOKEN', 'Former player'),
        (secret) => {
          const result = settle(
            () => parseRedemption({ membershipId: secret }),
            isFullyPopulated,
          );

          expect(result.ok).toBe(false);

          if (!result.ok) {
            // 4.10 and 17.2: a redemption is reached from an invite link, so a
            // reason echoing the body could put the secret in a log.
            expect(result.reason).not.toContain(secret);
            expect(result.reason).toContain('membershipId');
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
