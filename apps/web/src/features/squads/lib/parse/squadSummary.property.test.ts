import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  MEMBERSHIP_STATE_CODES,
  MEMBER_ROLE_CODES,
  memberRoleFromCode,
  membershipStateFromCode,
  type MemberRole,
  type MembershipStateValue,
} from '../enumCodes';
import { isSquadIdentifier } from '../identifiers';
import type { ParseResult } from './primitives';
import {
  parseSquadSummary,
  parseSquadSummaryList,
  readMemberRoleValue,
  readMembershipStateValue,
  type SquadSummary,
} from './squadSummary';

/**
 * Property test for the `ListMySquads` body shape, placed beside the module it
 * covers as the design's Testing Strategy asks and running well above the
 * 100-iteration floor (20.1).
 *
 * This file carries **Property 35** for `squadSummary.ts`: for any value supplied
 * as a response body — absent, `null`, a primitive of every type, an array, an
 * object with each required field missing, an object with each field mistyped, an
 * enum field carrying a code the Enum_Code_Map does not name, and a value nested
 * a hundred levels deep — the parser yields exactly one of a fully populated
 * Squad_Summary and a parse failure, and raises nothing (16.4, 16.6).
 *
 * Two decisions of this shape are what the assertions are aimed at.
 *
 * **`role` and `state` are nullable at the source.** The backend projects
 * `membership?.Role` and `membership?.State`, so `null` and an absent property are
 * valid parsed absences rather than failures (16.8). Getting that wrong in either
 * direction is visible on the Squads_Home: failing the body would empty the screen
 * for a caller whose membership could not be resolved, and defaulting the absence
 * would put a role on a card the backend never claimed. Both directions are
 * asserted — the absences parse, and a *present* unnamed code fails.
 *
 * **A bad element fails the whole listing.** A silently shortened list would
 * render as complete while omitting a squad the caller belongs to, so the list
 * assertions below pin length preservation and the all-or-nothing rule together.
 *
 * "Fully populated" is asserted structurally, through {@link settle}: the result's
 * own key set must be exactly `ok,value` or exactly `ok,reason`, and a successful
 * value's own key set must be exactly the four declared fields with each of a
 * declared type — never `undefined`, never partial.
 *
 * Requirements: 16.4, 16.6, 20.10
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
      -1,
      3,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '',
      ' ',
      '0',
      '1',
      '3',
      'null',
      '{}',
      'owner',
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
      Object.create(null),
      new Date(0),
      new Map<unknown, unknown>([['squadId', WELL_FORMED_IDENTITY]]),
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

/** Squad names at the edges the requirements name, and arbitrary ones. */
const nameArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      '',
      ' ',
      'a',
      'Former player',
      'x'.repeat(100),
      'x'.repeat(101),
    ),
  },
  { weight: 2, arbitrary: fc.string({ maxLength: 40 }) },
  { weight: 1, arbitrary: fc.string({ unit: 'grapheme', maxLength: 12 }) },
);

/** Values no identity field accepts. */
const notAnIdentityArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
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
      `${WELL_FORMED_IDENTITY.slice(0, 35)}g`,
      [WELL_FORMED_IDENTITY],
      { squadId: WELL_FORMED_IDENTITY },
    ),
  },
  { weight: 3, arbitrary: anyBodyArb.filter((value) => !isSquadIdentifier(value)) },
);

/** Values no required string field accepts. */
const notAStringArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      0,
      1,
      true,
      false,
      Number.NaN,
      [],
      ['a'],
      {},
      { name: 'a' },
      Object('a'),
      0n,
      Symbol('a'),
    ),
  },
  { weight: 3, arbitrary: anyBodyArb.filter((value) => typeof value !== 'string') },
);

/**
 * Present values no Member_Role code names, the two absences excluded — an
 * absence is a *valid* reading here (16.8), so it belongs in the well-formed
 * generator rather than this one.
 *
 * `3` is in range for this table, so the near miss on the high side is `4`. The
 * code `3` the task names appears in the Membership_State generator below, where
 * it is out of range.
 */
const unnamedRoleCodeArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom<unknown>(
      0,
      -0,
      4,
      5,
      -1,
      1.5,
      2.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '1',
      '3',
      'owner',
      true,
      false,
      [1],
      { role: 1 },
      1n,
    ),
  },
  {
    weight: 2,
    arbitrary: anyBodyArb.filter(
      (value) =>
        value !== null && value !== undefined && memberRoleFromCode(value) === undefined,
    ),
  },
);

/**
 * Present values no Membership_State code names, the two absences excluded.
 *
 * `3` is generated explicitly: it is the Skill_Tier near miss the task names, and
 * it is also the first code past this two-entry table. A reader shifted by one, or
 * one bound to the wrong table, names it.
 */
const unnamedStateCodeArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom<unknown>(
      0,
      -0,
      3,
      4,
      -1,
      1.5,
      Number.NaN,
      Number.NEGATIVE_INFINITY,
      '1',
      '2',
      'active',
      true,
      false,
      [1],
      { state: 1 },
      2n,
    ),
  },
  {
    weight: 2,
    arbitrary: anyBodyArb.filter(
      (value) =>
        value !== null &&
        value !== undefined &&
        membershipStateFromCode(value) === undefined,
    ),
  },
);

/* -------------------------------------------------------------------------- */
/* Well-formed bodies, and what a populated value must look like              */
/* -------------------------------------------------------------------------- */

/**
 * A well-formed `ListMySquads` element, generated across every combination of
 * present code, explicit `null`, and absent property for both enum fields — the
 * three forms Requirement 16.8 makes valid.
 */
const wellFormedSummaryArb: fc.Arbitrary<Record<string, unknown>> = fc
  .record({
    squadId: identityArb,
    name: nameArb,
    role: fc.constantFrom<unknown>(1, 2, 3, null),
    state: fc.constantFrom<unknown>(1, 2, null),
    dropRole: fc.boolean(),
    dropState: fc.boolean(),
  })
  .map(({ squadId, name, role, state, dropRole, dropState }) => {
    const body: Record<string, unknown> = { squadId, name };

    if (!dropRole) {
      body.role = role;
    }

    if (!dropState) {
      body.state = state;
    }

    return body;
  });

/** The role names the Enum_Code_Map carries, read from the map itself. */
const MEMBER_ROLE_NAMES: readonly string[] = Object.values(MEMBER_ROLE_CODES);

/** The membership-state names the Enum_Code_Map carries. */
const MEMBERSHIP_STATE_NAMES: readonly string[] = Object.values(
  MEMBERSHIP_STATE_CODES,
);

/**
 * Whether a parsed Squad_Summary is fully populated: exactly the four declared
 * fields, each of its declared type, with no field left `undefined`.
 */
function isFullyPopulatedSummary(summary: SquadSummary): boolean {
  return (
    keySignature(summary) === 'name,role,squadId,state' &&
    isSquadIdentifier(summary.squadId) &&
    typeof summary.name === 'string' &&
    (summary.role === null || MEMBER_ROLE_NAMES.includes(summary.role)) &&
    (summary.state === null || MEMBERSHIP_STATE_NAMES.includes(summary.state))
  );
}

/** Whether a parsed listing is fully populated in every element. */
function isFullyPopulatedList(summaries: readonly SquadSummary[]): boolean {
  return Array.isArray(summaries) && summaries.every(isFullyPopulatedSummary);
}

/** `body` without `key`. */
function without(
  body: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, unknown> {
  const copy = { ...body };

  delete copy[key];

  return copy;
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
/* One summary                                                                */
/* -------------------------------------------------------------------------- */

// Feature: web-squads-screens, Property 35: Every response parser is total and never yields a partial value
// Validates: Requirements 16.4, 16.6, 20.10
describe('parseSquadSummary — total, and never partial', () => {
  it('settles every input into exactly one of a populated value and a failure', () => {
    fc.assert(
      fc.property(anyBodyArb, (body) => {
        settle(() => parseSquadSummary(body), isFullyPopulatedSummary);
      }),
      { numRuns: 1000 },
    );
  });

  it('settles a value nested to 100 levels', () => {
    fc.assert(
      fc.property(deeplyNestedArb, (body) => {
        // No parser walks an interior it did not ask for, so depth costs a type
        // test rather than a stack frame per level.
        const outcome = settle(
          () => parseSquadSummary(body),
          isFullyPopulatedSummary,
        );

        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('settles a well-formed body whose every field is 100 levels deep', () => {
    fc.assert(
      fc.property(
        wellFormedSummaryArb,
        fc.constantFrom('squadId', 'name', 'role', 'state'),
        deeplyNestedArb,
        (body, key, deep) => {
          const outcome = settle(
            () => parseSquadSummary({ ...body, [key]: deep }),
            isFullyPopulatedSummary,
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('parses every well-formed body into a fully populated value', () => {
    fc.assert(
      fc.property(wellFormedSummaryArb, (body) => {
        const outcome = settle(
          () => parseSquadSummary(body),
          isFullyPopulatedSummary,
        );

        expect(outcome.ok).toBe(true);

        if (outcome.ok) {
          expect(outcome.value.squadId).toBe(body.squadId);
          expect(outcome.value.name).toBe(body.name);
          // 16.8: `null` and an absent property are the same absence.
          expect(outcome.value.role).toBe(
            body.role === null || body.role === undefined
              ? null
              : memberRoleFromCode(body.role),
          );
          expect(outcome.value.state).toBe(
            body.state === null || body.state === undefined
              ? null
              : membershipStateFromCode(body.state),
          );
        }
      }),
      { numRuns: 500 },
    );
  });

  it('fails when a required field is absent', () => {
    fc.assert(
      fc.property(
        wellFormedSummaryArb,
        fc.constantFrom('squadId', 'name'),
        (body, key) => {
          const outcome = settle(
            () => parseSquadSummary(without(body, key)),
            isFullyPopulatedSummary,
          );

          // All or nothing: the missing field fails the body rather than yielding
          // a summary with it defaulted or dropped.
          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('fails when a required field is mistyped', () => {
    fc.assert(
      fc.property(
        wellFormedSummaryArb,
        fc.oneof(
          fc.tuple(fc.constant('squadId'), notAnIdentityArb),
          fc.tuple(fc.constant('name'), notAStringArb),
        ),
        (body, [key, value]) => {
          const outcome = settle(
            () => parseSquadSummary({ ...body, [key]: value }),
            isFullyPopulatedSummary,
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('parses an absent or null role and state as absences rather than failures', () => {
    fc.assert(
      fc.property(
        identityArb,
        nameArb,
        fc.constantFrom('present-null', 'present-undefined', 'absent'),
        fc.constantFrom('present-null', 'present-undefined', 'absent'),
        (squadId, name, roleForm, stateForm) => {
          const body: Record<string, unknown> = { squadId, name };

          if (roleForm === 'present-null') {
            body.role = null;
          } else if (roleForm === 'present-undefined') {
            body.role = undefined;
          }

          if (stateForm === 'present-null') {
            body.state = null;
          } else if (stateForm === 'present-undefined') {
            body.state = undefined;
          }

          const outcome = settle(
            () => parseSquadSummary(body),
            isFullyPopulatedSummary,
          );

          // 16.8: a caller whose membership the backend could not resolve still
          // gets a card, with both absences carried rather than invented.
          expect(outcome.ok).toBe(true);
          expect(outcome.ok && outcome.value.role).toBeNull();
          expect(outcome.ok && outcome.value.state).toBeNull();
        },
      ),
      { numRuns: 300 },
    );
  });

  it('fails when a present enum field carries a code the map does not name', () => {
    fc.assert(
      fc.property(
        wellFormedSummaryArb,
        fc.oneof(
          fc.tuple(fc.constant('role'), unnamedRoleCodeArb),
          fc.tuple(fc.constant('state'), unnamedStateCodeArb),
        ),
        (body, [key, code]) => {
          const outcome = settle(
            () => parseSquadSummary({ ...body, [key]: code }),
            isFullyPopulatedSummary,
          );

          // 16.6: an unnamed code is a contract mismatch, not an absence — the
          // one place where reading it as "no role" would be a silent misread.
          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('fails rather than raising when a named field throws on read', () => {
    fc.assert(
      fc.property(
        wellFormedSummaryArb,
        fc.constantFrom('squadId', 'name', 'role', 'state'),
        (body, key) => {
          const outcome = settle(
            () => parseSquadSummary(throwingAt(body, key)),
            isFullyPopulatedSummary,
          );

          // A throwing accessor reads as an absence, which the field's own reader
          // then turns into a failure — except for the two fields whose absence is
          // valid, which parse as absences.
          expect(outcome.ok).toBe(key === 'role' || key === 'state');
        },
      ),
      { numRuns: 300 },
    );
  });

  it('is deterministic, so no reading depends on a clock or a counter', () => {
    fc.assert(
      fc.property(fc.oneof(anyBodyArb, wellFormedSummaryArb), (body) => {
        const first = parseSquadSummary(body);
        const second = parseSquadSummary(body);

        expect(first).toEqual(second);
      }),
      { numRuns: 500 },
    );
  });

  it('composes its reason from field labels and never from the value', () => {
    fc.assert(
      fc.property(
        wellFormedSummaryArb,
        fc.constantFrom('a-secret-invite-token', 'Former player'),
        (body, secret) => {
          const outcome = settle(
            () => parseSquadSummary({ ...body, squadId: secret }),
            isFullyPopulatedSummary,
          );

          expect(outcome.ok).toBe(false);

          if (!outcome.ok) {
            // 4.10 and 17.2: a reason is a diagnostic of literal text, so nothing
            // read from a body can travel into a log through one.
            expect(outcome.reason).not.toContain(secret);
            expect(outcome.reason).toContain('squadId');
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The whole listing                                                          */
/* -------------------------------------------------------------------------- */

// Feature: web-squads-screens, Property 35: Every response parser is total and never yields a partial value
// Validates: Requirements 16.4, 16.6, 20.10
describe('parseSquadSummaryList — total, and complete or failed', () => {
  it('settles every input into exactly one of a populated value and a failure', () => {
    fc.assert(
      fc.property(anyBodyArb, (body) => {
        settle(() => parseSquadSummaryList(body), isFullyPopulatedList);
      }),
      { numRuns: 1000 },
    );
  });

  it('settles a value nested to 100 levels', () => {
    fc.assert(
      fc.property(deeplyNestedArb, (body) => {
        settle(() => parseSquadSummaryList(body), isFullyPopulatedList);
      }),
      { numRuns: 300 },
    );
  });

  it('parses a listing of any length into one populated value per element', () => {
    fc.assert(
      fc.property(
        fc.array(wellFormedSummaryArb, { maxLength: 40 }),
        (elements) => {
          const outcome = settle(
            () => parseSquadSummaryList(elements),
            isFullyPopulatedList,
          );

          expect(outcome.ok).toBe(true);
          // Nothing is dropped and nothing is added: a listing that lost a squad
          // would render as complete while omitting one the caller belongs to.
          expect(outcome.ok && outcome.value).toHaveLength(elements.length);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('fails the whole body when any one element is bad', () => {
    fc.assert(
      fc.property(
        fc.array(wellFormedSummaryArb, { minLength: 1, maxLength: 8 }),
        fc.nat(),
        fc.oneof(anyBodyArb, wellFormedSummaryArb.map((body) => without(body, 'name'))),
        (elements, offset, spoiled) => {
          const index = offset % elements.length;
          const body = [...elements];
          body[index] = spoiled as Record<string, unknown>;

          const outcome = settle(
            () => parseSquadSummaryList(body),
            isFullyPopulatedList,
          );

          // The element either parses in its own right or fails the body; there is
          // no third outcome in which the listing is shortened.
          expect(outcome.ok).toBe(parseSquadSummary(spoiled).ok);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('fails every non-array body, an object included', () => {
    fc.assert(
      fc.property(
        anyBodyArb.filter((value) => !Array.isArray(value)),
        (body) => {
          const outcome = settle(
            () => parseSquadSummaryList(body),
            isFullyPopulatedList,
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The two shared enum readers                                                */
/* -------------------------------------------------------------------------- */

// Feature: web-squads-screens, Property 35: Every response parser is total and never yields a partial value
// Validates: Requirements 16.4, 16.6, 20.10
describe('the shared membership enum readers are total', () => {
  it('reads a role exactly when the Enum_Code_Map names one', () => {
    fc.assert(
      fc.property(
        fc.oneof(anyBodyArb, fc.constantFrom<unknown>(1, 2, 3, 0, 4)),
        (value) => {
          const outcome = settle(
            () => readMemberRoleValue(value, 'field'),
            (role: MemberRole) => MEMBER_ROLE_NAMES.includes(role),
          );

          expect(outcome.ok).toBe(memberRoleFromCode(value) !== undefined);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('reads a membership state exactly when the Enum_Code_Map names one', () => {
    fc.assert(
      fc.property(
        fc.oneof(anyBodyArb, fc.constantFrom<unknown>(1, 2, 0, 3)),
        (value) => {
          const outcome = settle(
            () => readMembershipStateValue(value, 'field'),
            (state: MembershipStateValue) => MEMBERSHIP_STATE_NAMES.includes(state),
          );

          expect(outcome.ok).toBe(membershipStateFromCode(value) !== undefined);
        },
      ),
      { numRuns: 500 },
    );
  });
});
