import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  MEMBERSHIP_STATE_CODES,
  MEMBER_ROLE_CODES,
  SQUAD_FEATURE_CODES,
  memberRoleFromCode,
  membershipStateFromCode,
} from '../enumCodes';
import { isSquadIdentifier } from '../identifiers';
import type { FeatureFlag } from './featureFlags';
import type { ParseResult } from './primitives';
import {
  parseSquadDetail,
  parseSquadMember,
  type SquadDetail,
  type SquadMember,
} from './squadDetail';

/**
 * Property test for the `GetSquad` body shape, placed beside the module it covers
 * as the design's Testing Strategy asks and running well above the 100-iteration
 * floor (20.1).
 *
 * This file carries **Property 35** for `squadDetail.ts`: for any value supplied as
 * a response body — absent, `null`, a primitive of every type, an array, an object
 * with each required field missing, an object with each field mistyped, an enum
 * field carrying a code the Enum_Code_Map does not name, and a value nested a
 * hundred levels deep — both parsers yield exactly one of a fully populated value
 * and a parse failure, and raise nothing (16.4, 16.6).
 *
 * `GetSquad` is the authority on membership: the Player_List's row set is `members`
 * alone (7.2), so the difference between failing a body and dropping a member is
 * the difference between a retryable failure and a player who silently vanishes
 * from the squad. Three field decisions follow from the backend's own
 * `SquadMemberView`, and each is asserted in both directions:
 *
 *  - **`role` is nullable** — a guest membership carries none, so `null` and an
 *    absent property are valid absences (16.8) while a present unnamed code fails.
 *  - **`state` is not nullable.** An invented `active` would reorder the
 *    Player_Order and could unlock an administration surface the backend never
 *    authorised, so `null`, absent, and every unnamed code must fail the member.
 *    The code `3` the task names is generated here, where this two-entry table
 *    makes it out of range.
 *  - **`isGuest` is a strict boolean**, because it decides whether a row offers the
 *    guest edit control; the truthy and falsy non-booleans are generated so a
 *    lenient reading would fail here.
 *
 * `features` is read through `featureFlags.ts` and is required to be an array, so
 * an absent `features` fails the body rather than yielding a squad with no optional
 * features — an empty array is how "no features" arrives.
 *
 * Requirements: 7.2, 16.4, 16.6, 20.10
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
      'active',
      'owner',
      'Former player',
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
      { members: [] },
      { squadId: WELL_FORMED_IDENTITY },
      Object.create(null),
      new Date(0),
      new Map<unknown, unknown>([['members', []]]),
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

/**
 * Display names at the edges the requirements name: empty, whitespace-only, the
 * anonymisation placeholder and values near it, and the 100/101-character bounds.
 */
const displayNameArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      '',
      ' ',
      'a',
      'Dave',
      'BigDave',
      'Former player',
      'former player',
      'Former player ',
      'x'.repeat(100),
      'x'.repeat(101),
    ),
  },
  { weight: 2, arbitrary: fc.string({ maxLength: 40 }) },
  { weight: 1, arbitrary: fc.string({ unit: 'grapheme', maxLength: 12 }) },
);

/** Values no identity field accepts, including the near misses of the form. */
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
      { membershipId: WELL_FORMED_IDENTITY },
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
      { displayName: 'a' },
      Object('a'),
      0n,
      Symbol('a'),
    ),
  },
  { weight: 3, arbitrary: anyBodyArb.filter((value) => typeof value !== 'string') },
);

/**
 * Present values no Member_Role code names, the absences excluded — a guest's
 * absent role is a valid reading (16.8), so it belongs in the well-formed
 * generator.
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
      Number.NaN,
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
 * Values no Membership_State code names, the absences **included** — unlike a
 * squad summary, a member's state is required, so `null` and an absent property are
 * contract mismatches rather than absences.
 *
 * `3` is generated explicitly: it is the Skill_Tier near miss the task names and
 * the first code past this two-entry table.
 */
const unnamedStateCodeArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
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
    arbitrary: anyBodyArb.filter((value) => membershipStateFromCode(value) === undefined),
  },
);

/** Values no boolean field accepts, the truthy and falsy near misses first. */
const notABooleanArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      0,
      1,
      -0,
      'true',
      'false',
      '1',
      '0',
      '',
      Number.NaN,
      [],
      [true],
      {},
      { isGuest: true },
      Object(true),
      0n,
    ),
  },
  { weight: 3, arbitrary: anyBodyArb.filter((value) => typeof value !== 'boolean') },
);

/* -------------------------------------------------------------------------- */
/* Well-formed bodies, and what a populated value must look like              */
/* -------------------------------------------------------------------------- */

/** The role names the Enum_Code_Map carries, read from the map itself. */
const MEMBER_ROLE_NAMES: readonly string[] = Object.values(MEMBER_ROLE_CODES);

/** The membership-state names the Enum_Code_Map carries. */
const MEMBERSHIP_STATE_NAMES: readonly string[] = Object.values(
  MEMBERSHIP_STATE_CODES,
);

/** The feature names the Enum_Code_Map carries. */
const FEATURE_NAMES: readonly string[] = Object.values(SQUAD_FEATURE_CODES);

/** The one named Feature_Flag code. */
const NAMED_FEATURE_CODES: readonly number[] = Object.keys(SQUAD_FEATURE_CODES).map(
  Number,
);

/**
 * A well-formed `members` element, generated across the three forms the role field
 * may take — a present code, an explicit `null`, and an absent property.
 */
const wellFormedMemberArb: fc.Arbitrary<Record<string, unknown>> = fc
  .record({
    membershipId: identityArb,
    displayName: displayNameArb,
    role: fc.constantFrom<unknown>(1, 2, 3, null),
    state: fc.constantFrom<unknown>(1, 2),
    isGuest: fc.boolean(),
    dropRole: fc.boolean(),
  })
  .map(({ membershipId, displayName, role, state, isGuest, dropRole }) => {
    const body: Record<string, unknown> = {
      membershipId,
      displayName,
      state,
      isGuest,
    };

    if (!dropRole) {
      body.role = role;
    }

    return body;
  });

/** A well-formed `features` element. */
const wellFormedFlagArb: fc.Arbitrary<Record<string, unknown>> = fc.record({
  feature: fc.constantFrom(...NAMED_FEATURE_CODES),
  isEnabled: fc.boolean(),
});

/**
 * A well-formed `GetSquad` body. Member collections of 0, 1, and many are all
 * generated, since an empty squad renders a statement rather than an error (7.12).
 */
const wellFormedDetailArb: fc.Arbitrary<Record<string, unknown>> = fc.record({
  squadId: identityArb,
  name: displayNameArb,
  members: fc.array(wellFormedMemberArb, { maxLength: 12 }),
  features: fc.array(wellFormedFlagArb, { maxLength: 4 }),
});

/** Every field a member declares. */
const MEMBER_FIELDS = [
  'membershipId',
  'displayName',
  'role',
  'state',
  'isGuest',
] as const;

/** Every field the squad body declares. */
const DETAIL_FIELDS = ['squadId', 'name', 'members', 'features'] as const;

/**
 * Whether a parsed Squad_Member is fully populated: exactly the five declared
 * fields, each of its declared type, with no field left `undefined`.
 */
function isFullyPopulatedMember(member: SquadMember): boolean {
  return (
    keySignature(member) === 'displayName,isGuest,membershipId,role,state' &&
    isSquadIdentifier(member.membershipId) &&
    typeof member.displayName === 'string' &&
    (member.role === null || MEMBER_ROLE_NAMES.includes(member.role)) &&
    MEMBERSHIP_STATE_NAMES.includes(member.state) &&
    typeof member.isGuest === 'boolean'
  );
}

/** Whether a parsed Feature_Flag is fully populated. */
function isFullyPopulatedFlag(flag: FeatureFlag): boolean {
  return (
    keySignature(flag) === 'feature,isEnabled' &&
    FEATURE_NAMES.includes(flag.feature) &&
    typeof flag.isEnabled === 'boolean'
  );
}

/** Whether a parsed Squad_Detail is fully populated in every field and element. */
function isFullyPopulatedDetail(detail: SquadDetail): boolean {
  return (
    keySignature(detail) === 'features,members,name,squadId' &&
    isSquadIdentifier(detail.squadId) &&
    typeof detail.name === 'string' &&
    Array.isArray(detail.members) &&
    detail.members.every(isFullyPopulatedMember) &&
    Array.isArray(detail.features) &&
    detail.features.every(isFullyPopulatedFlag)
  );
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
/* One member                                                                 */
/* -------------------------------------------------------------------------- */

// Feature: web-squads-screens, Property 35: Every response parser is total and never yields a partial value
// Validates: Requirements 16.4, 16.6, 20.10
describe('parseSquadMember — total, and never partial', () => {
  it('settles every input into exactly one of a populated value and a failure', () => {
    fc.assert(
      fc.property(anyBodyArb, (body) => {
        settle(() => parseSquadMember(body), isFullyPopulatedMember);
      }),
      { numRuns: 1000 },
    );
  });

  it('settles a value nested to 100 levels', () => {
    fc.assert(
      fc.property(deeplyNestedArb, (body) => {
        const outcome = settle(() => parseSquadMember(body), isFullyPopulatedMember);

        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('settles a well-formed member whose every field is 100 levels deep', () => {
    fc.assert(
      fc.property(
        wellFormedMemberArb,
        fc.constantFrom(...MEMBER_FIELDS),
        deeplyNestedArb,
        (body, key, deep) => {
          const outcome = settle(
            () => parseSquadMember({ ...body, [key]: deep }),
            isFullyPopulatedMember,
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('parses every well-formed member into a fully populated value', () => {
    fc.assert(
      fc.property(wellFormedMemberArb, (body) => {
        const outcome = settle(() => parseSquadMember(body), isFullyPopulatedMember);

        expect(outcome.ok).toBe(true);

        if (outcome.ok) {
          expect(outcome.value.membershipId).toBe(body.membershipId);
          expect(outcome.value.displayName).toBe(body.displayName);
          // 16.8: a guest carries no role, which arrives as `null` or absent.
          expect(outcome.value.role).toBe(
            body.role === null || body.role === undefined
              ? null
              : memberRoleFromCode(body.role),
          );
          expect(outcome.value.state).toBe(membershipStateFromCode(body.state));
          expect(outcome.value.isGuest).toBe(body.isGuest);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('fails when a required field is absent', () => {
    fc.assert(
      fc.property(
        wellFormedMemberArb,
        fc.constantFrom('membershipId', 'displayName', 'state', 'isGuest'),
        (body, key) => {
          const outcome = settle(
            () => parseSquadMember(without(body, key)),
            isFullyPopulatedMember,
          );

          // A dropped member is a player who vanishes from the squad with nothing
          // on screen saying so, so a missing field fails the member instead.
          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('parses an absent or null role as an absence rather than a failure', () => {
    fc.assert(
      fc.property(
        identityArb,
        displayNameArb,
        fc.constantFrom(1, 2),
        fc.boolean(),
        fc.constantFrom('present-null', 'present-undefined', 'absent'),
        (membershipId, displayName, state, isGuest, roleForm) => {
          const body: Record<string, unknown> = {
            membershipId,
            displayName,
            state,
            isGuest,
          };

          if (roleForm === 'present-null') {
            body.role = null;
          } else if (roleForm === 'present-undefined') {
            body.role = undefined;
          }

          const outcome = settle(
            () => parseSquadMember(body),
            isFullyPopulatedMember,
          );

          expect(outcome.ok).toBe(true);
          expect(outcome.ok && outcome.value.role).toBeNull();
        },
      ),
      { numRuns: 300 },
    );
  });

  it('fails when a present role code names nothing', () => {
    fc.assert(
      fc.property(wellFormedMemberArb, unnamedRoleCodeArb, (body, role) => {
        const outcome = settle(
          () => parseSquadMember({ ...body, role }),
          isFullyPopulatedMember,
        );

        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('fails when the state is absent, null, or an unnamed code', () => {
    fc.assert(
      fc.property(wellFormedMemberArb, unnamedStateCodeArb, (body, state) => {
        const outcome = settle(
          () => parseSquadMember({ ...body, state }),
          isFullyPopulatedMember,
        );

        // An invented `active` would reorder the Player_List and could unlock the
        // administration surface, so nothing is defaulted here.
        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('fails when the guest flag is not a boolean', () => {
    fc.assert(
      fc.property(wellFormedMemberArb, notABooleanArb, (body, isGuest) => {
        const outcome = settle(
          () => parseSquadMember({ ...body, isGuest }),
          isFullyPopulatedMember,
        );

        // A defaulted `false` would hide the guest edit control from a real guest.
        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('fails when an identity or a name is mistyped', () => {
    fc.assert(
      fc.property(
        wellFormedMemberArb,
        fc.oneof(
          fc.tuple(fc.constant('membershipId'), notAnIdentityArb),
          fc.tuple(fc.constant('displayName'), notAStringArb),
        ),
        (body, [key, value]) => {
          const outcome = settle(
            () => parseSquadMember({ ...body, [key]: value }),
            isFullyPopulatedMember,
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('fails rather than raising when a named field throws on read', () => {
    fc.assert(
      fc.property(
        wellFormedMemberArb,
        fc.constantFrom(...MEMBER_FIELDS),
        (body, key) => {
          const outcome = settle(
            () => parseSquadMember(throwingAt(body, key)),
            isFullyPopulatedMember,
          );

          // Only the role tolerates an absence, so only a throwing role parses.
          expect(outcome.ok).toBe(key === 'role');
        },
      ),
      { numRuns: 300 },
    );
  });

  it('composes its reason from field labels and never from the display name', () => {
    fc.assert(
      fc.property(
        wellFormedMemberArb,
        fc.constantFrom('Dave', 'Former player', 'a-secret-invite-token'),
        (body, personalData) => {
          const outcome = settle(
            () => parseSquadMember({ ...body, displayName: [personalData] }),
            isFullyPopulatedMember,
          );

          expect(outcome.ok).toBe(false);

          if (!outcome.ok) {
            // A display name is personal data, and a reason travels into a log.
            expect(outcome.reason).not.toContain(personalData);
            expect(outcome.reason).toContain('displayName');
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The whole squad                                                            */
/* -------------------------------------------------------------------------- */

// Feature: web-squads-screens, Property 35: Every response parser is total and never yields a partial value
// Validates: Requirements 7.2, 16.4, 16.6, 20.10
describe('parseSquadDetail — total, and complete or failed', () => {
  it('settles every input into exactly one of a populated value and a failure', () => {
    fc.assert(
      fc.property(anyBodyArb, (body) => {
        settle(() => parseSquadDetail(body), isFullyPopulatedDetail);
      }),
      { numRuns: 1000 },
    );
  });

  it('settles a value nested to 100 levels', () => {
    fc.assert(
      fc.property(deeplyNestedArb, (body) => {
        const outcome = settle(() => parseSquadDetail(body), isFullyPopulatedDetail);

        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('settles a well-formed body whose every field is 100 levels deep', () => {
    fc.assert(
      fc.property(
        wellFormedDetailArb,
        fc.constantFrom(...DETAIL_FIELDS),
        deeplyNestedArb,
        (body, key, deep) => {
          const outcome = settle(
            () => parseSquadDetail({ ...body, [key]: deep }),
            isFullyPopulatedDetail,
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('parses every well-formed body into a fully populated value', () => {
    fc.assert(
      fc.property(wellFormedDetailArb, (body) => {
        const outcome = settle(() => parseSquadDetail(body), isFullyPopulatedDetail);

        expect(outcome.ok).toBe(true);

        if (outcome.ok) {
          expect(outcome.value.squadId).toBe(body.squadId);
          expect(outcome.value.name).toBe(body.name);
          // Every membership survives: the row set is `members` alone (7.2).
          expect(outcome.value.members).toHaveLength(body.members.length);
          expect(outcome.value.features).toHaveLength(body.features.length);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('parses a squad with no members and no features', () => {
    fc.assert(
      fc.property(identityArb, displayNameArb, (squadId, name) => {
        const outcome = settle(
          () => parseSquadDetail({ squadId, name, members: [], features: [] }),
          isFullyPopulatedDetail,
        );

        // Both absences render statements rather than errors (7.12, 14.8).
        expect(outcome.ok).toBe(true);
        expect(outcome.ok && outcome.value.members).toHaveLength(0);
        expect(outcome.ok && outcome.value.features).toHaveLength(0);
      }),
      { numRuns: 200 },
    );
  });

  it('fails when a required field is absent', () => {
    fc.assert(
      fc.property(
        wellFormedDetailArb,
        fc.constantFrom(...DETAIL_FIELDS),
        (body, key) => {
          const outcome = settle(
            () => parseSquadDetail(without(body, key)),
            isFullyPopulatedDetail,
          );

          // `features` is required to be an array: "no optional features" arrives
          // as an empty collection, not as an absence.
          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('fails when a required field is mistyped', () => {
    fc.assert(
      fc.property(
        wellFormedDetailArb,
        fc.oneof(
          fc.tuple(fc.constant('squadId'), notAnIdentityArb),
          fc.tuple(fc.constant('name'), notAStringArb),
          fc.tuple(
            fc.constant('members'),
            anyBodyArb.filter((value) => !Array.isArray(value)),
          ),
          fc.tuple(
            fc.constant('features'),
            anyBodyArb.filter((value) => !Array.isArray(value)),
          ),
        ),
        (body, [key, value]) => {
          const outcome = settle(
            () => parseSquadDetail({ ...body, [key]: value }),
            isFullyPopulatedDetail,
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('fails the whole body when any one member is bad', () => {
    fc.assert(
      fc.property(
        wellFormedDetailArb,
        fc.array(wellFormedMemberArb, { minLength: 1, maxLength: 8 }),
        fc.nat(),
        fc.oneof(
          anyBodyArb,
          wellFormedMemberArb.map((member) => without(member, 'state')),
        ),
        (body, members, offset, spoiled) => {
          const index = offset % members.length;
          const spoiledMembers: unknown[] = [...members];
          spoiledMembers[index] = spoiled;

          const outcome = settle(
            () => parseSquadDetail({ ...body, members: spoiledMembers }),
            isFullyPopulatedDetail,
          );

          // A complete-looking list that quietly omits somebody is worse than one
          // Generic_Squads_Failure a person can retry.
          expect(outcome.ok).toBe(parseSquadMember(spoiled).ok);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('fails the whole body when any one feature is bad', () => {
    fc.assert(
      fc.property(
        wellFormedDetailArb,
        fc.array(wellFormedFlagArb, { minLength: 1, maxLength: 5 }),
        fc.nat(),
        fc.constantFrom<unknown>(
          {},
          { feature: 0, isEnabled: true },
          { feature: 2, isEnabled: true },
          { feature: 3, isEnabled: true },
          { feature: 1 },
          { feature: 1, isEnabled: 1 },
          null,
          [1],
        ),
        (body, features, offset, spoiled) => {
          const index = offset % features.length;
          const spoiledFeatures: unknown[] = [...features];
          spoiledFeatures[index] = spoiled;

          const outcome = settle(
            () => parseSquadDetail({ ...body, features: spoiledFeatures }),
            isFullyPopulatedDetail,
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('fails rather than raising when a named field throws on read', () => {
    fc.assert(
      fc.property(
        wellFormedDetailArb,
        fc.constantFrom(...DETAIL_FIELDS),
        (body, key) => {
          const outcome = settle(
            () => parseSquadDetail(throwingAt(body, key)),
            isFullyPopulatedDetail,
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('is deterministic, so no reading depends on a clock or a counter', () => {
    fc.assert(
      fc.property(fc.oneof(anyBodyArb, wellFormedDetailArb), (body) => {
        expect(parseSquadDetail(body)).toEqual(parseSquadDetail(body));
      }),
      { numRuns: 400 },
    );
  });

  it('settles a members collection of 200 entries with repeated names', () => {
    fc.assert(
      fc.property(
        identityArb,
        displayNameArb,
        fc.constantFrom('Dave', 'Former player'),
        (squadId, name, repeatedName) => {
          const members = Array.from({ length: 200 }, (_unused, index) => ({
            membershipId: `018f3a2b-4c5d-7e6f-8a9b-${String(index).padStart(12, '0')}`,
            displayName: repeatedName,
            role: index % 3 === 0 ? null : 3,
            state: (index % 2) + 1,
            isGuest: index % 3 === 0,
          }));

          const outcome = settle(
            () => parseSquadDetail({ squadId, name, members, features: [] }),
            isFullyPopulatedDetail,
          );

          // Names repeat freely: uniqueness is the backend's rule, and a parser
          // that enforced it would drop players the backend sent.
          expect(outcome.ok).toBe(true);
          expect(outcome.ok && outcome.value.members).toHaveLength(200);
        },
      ),
      { numRuns: 100 },
    );
  });
});
