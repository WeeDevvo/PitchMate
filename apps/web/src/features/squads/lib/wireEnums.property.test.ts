import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { webRoot } from '../structural/sourceScan';
import {
  INVITE_STATE_NAMES,
  MEMBERSHIP_STATE_NAMES,
  RATING_STATE_NAMES,
  REDEEM_OUTCOME_NAMES,
  SKILL_TIER_NAMES,
  SQUAD_FEATURE_NAMES,
  SQUAD_ROLE_NAMES,
  WIRE_ENUM_COVERAGE,
  isInviteState,
  isMembershipState,
  isRatingState,
  isRedeemOutcome,
  isSkillTier,
  isSquadFeature,
  isSquadRole,
} from './wireEnums';

/**
 * Property tests for the wire enum unions, placed beside the module they cover
 * and running above the 100-iteration floor.
 *
 * **Validates: Requirements 12.2, 12.3**
 *
 * The design assigns no numbered property to this module — the numbered web
 * properties (22 to 25) belong to the Response_Parsers, and the vocabulary itself
 * is pinned by the `satisfies` checks in `wireEnums.ts` plus the two drift gates.
 * What is left for a runtime test is the part a type cannot state, and it is not
 * nothing:
 *
 * 1. **The tuples agree with the Committed_Types as text.** The `satisfies`
 *    checks are the real guarantee, but they are *in the same module* as the
 *    tuples they check — weaken one and the other goes with it. So the names are
 *    additionally asserted against `packages/api-client/src/schema.d.ts` read off
 *    disk, which is the artefact the Web_Drift_Gate pins to the backend. That
 *    makes this an **oracle, not a round trip**: the same reasoning
 *    `enumCodes.property.test.ts` used when it transcribed the backend codes
 *    rather than deriving them from the module under test.
 * 2. **The predicates are total.** `isSquadRole(x)` is handed an `unknown` from a
 *    response body. Every input must settle to a boolean and nothing may throw —
 *    including values whose `toString` or `valueOf` is hostile, which a coercing
 *    membership test would run.
 * 3. **Each predicate is bound to its own tuple.** Seven near-identical one-line
 *    bindings is exactly the shape where a copy-paste leaves one predicate
 *    reading another's names. `Active` is a member of two of these unions and
 *    `AlreadyMember` of one, so a mis-bound predicate answers plausibly on its
 *    own and only looks wrong next to the others — which is how they are read
 *    here.
 * 4. **The legacy numeric vocabulary is rejected.** The old Enum_Code_Map named
 *    `'owner'`, `'live-match-tracking'`, `'already-member'`; the contract names
 *    `'Owner'`, `'LiveMatchTracking'`, `'AlreadyMember'`. Those lower-case and
 *    kebab forms are generated explicitly, so a predicate that case-folded or
 *    accepted both vocabularies is a finding rather than a convenience.
 */

// --- The oracle: the committed types, read off disk ---------------------------

/** The Committed_Types the Web_Drift_Gate pins to the Committed_Spec. */
const generatedSchemaPath = resolve(
  webRoot,
  '..',
  '..',
  'packages',
  'api-client',
  'src',
  'schema.d.ts',
);

const generatedSchemaSource = readFileSync(generatedSchemaPath, 'utf8');

/**
 * One double-quoted member of a generated union.
 *
 * Written as a string and compiled with `RegExp` rather than as a regex literal
 * on purpose: the structural scans strip string literals with a small state
 * machine that does not know regex syntax, so a regex literal containing an odd
 * number of quote characters would put every scan of this file into string mode
 * for the rest of it — including the one that counts `fc.assert` calls. Inside a
 * single-quoted string the quotes are consumed as string content, which is what
 * the stripper expects.
 */
const QUOTED_UNION_MEMBER = '"([^"]*)"';

/**
 * The string members of one Generated_Enum_Union, read from the generated source.
 *
 * The generated form is one line per enum — `SquadRole: "Owner" | "Admin" |
 * "Member" | null;` — so the members are its quoted literals, with the folded
 * `null` (a reference-site nullability the exporter puts into the shared schema)
 * simply not being a quoted literal and so never appearing.
 */
function generatedUnionMembers(schemaName: string): readonly string[] {
  const declaration = new RegExp(`^\\s*${schemaName}:\\s*([^;]+);`, 'm').exec(
    generatedSchemaSource,
  );

  expect(
    declaration,
    `${schemaName} is not declared in packages/api-client/src/schema.d.ts`,
  ).not.toBeNull();

  const members: string[] = [];
  const literal = new RegExp(QUOTED_UNION_MEMBER, 'g');
  let match: RegExpExecArray | null;
  while ((match = literal.exec(declaration?.[1] ?? '')) !== null) {
    members.push(match[1]);
  }

  return members;
}

// --- The unions under test ---------------------------------------------------

/** One wire enum union: its generated schema name, its names, its predicate. */
interface WireEnumUnderTest {
  /** The key of `components['schemas']` the union aliases. */
  readonly schemaName: string;
  readonly names: readonly string[];
  readonly is: (candidate: unknown) => boolean;
}

const UNIONS: readonly WireEnumUnderTest[] = [
  { schemaName: 'InviteState', names: INVITE_STATE_NAMES, is: isInviteState },
  {
    schemaName: 'MembershipState',
    names: MEMBERSHIP_STATE_NAMES,
    is: isMembershipState,
  },
  { schemaName: 'RatingState', names: RATING_STATE_NAMES, is: isRatingState },
  {
    schemaName: 'RedeemOutcome',
    names: REDEEM_OUTCOME_NAMES,
    is: isRedeemOutcome,
  },
  { schemaName: 'SkillTier', names: SKILL_TIER_NAMES, is: isSkillTier },
  {
    schemaName: 'SquadFeature',
    names: SQUAD_FEATURE_NAMES,
    is: isSquadFeature,
  },
  { schemaName: 'SquadRole', names: SQUAD_ROLE_NAMES, is: isSquadRole },
];

/** Every name of every union, which is also the set of plausible near-misses. */
const ALL_NAMES: readonly string[] = UNIONS.flatMap((union) => union.names);

/**
 * The Enum_Code_Map's named values — the vocabulary this change retires.
 *
 * Generated as outsiders on purpose: a predicate that accepted them would let a
 * stale body, or a parser still printing the old names, through unnoticed.
 */
const RETIRED_NAMES: readonly string[] = [
  'owner',
  'admin',
  'member',
  'active',
  'inactive',
  'revoked',
  'expired',
  'live-match-tracking',
  'beginner',
  'average',
  'strong',
  'joined',
  'reactivated',
  'already-member',
];

// --- Generators --------------------------------------------------------------

/**
 * Strings that are not names of any union: the retired vocabulary, casing and
 * whitespace variants of real names, the digit strings a numeric enum would have
 * arrived as, prototype member names, and arbitrary text.
 *
 * Filtered against {@link ALL_NAMES} rather than against one union, so the same
 * generator serves the "rejects an outsider" property of every union and can
 * never accidentally produce a name that union legitimately carries.
 */
const outsiderStringArb: fc.Arbitrary<string> = fc
  .oneof(
    { weight: 5, arbitrary: fc.constantFrom(...RETIRED_NAMES) },
    {
      weight: 5,
      arbitrary: fc.constantFrom(
        '',
        ' ',
        '\n',
        '0',
        '1',
        '2',
        '3',
        '-1',
        'OWNER',
        'Owner ',
        ' Owner',
        'owner',
        'oWNER',
        'Admin\n',
        'Already-Member',
        'Already Member',
        'AlreadyMembers',
        'LiveMatchtracking',
        'Live-Match-Tracking',
        'Establish',
        'Established ',
        'Provisional!',
        'null',
        'undefined',
        'NaN',
        '__proto__',
        'constructor',
        'prototype',
        'toString',
        'valueOf',
        'hasOwnProperty',
      ),
    },
    { weight: 3, arbitrary: fc.string({ maxLength: 24 }) },
    { weight: 2, arbitrary: fc.string({ unit: 'grapheme', maxLength: 12 }) },
    {
      weight: 2,
      arbitrary: fc
        .constantFrom(...ALL_NAMES)
        .chain((name) =>
          fc.constantFrom(
            name.toLowerCase(),
            name.toUpperCase(),
            `${name} `,
            ` ${name}`,
            `${name}${name}`,
            name.slice(1),
            name.slice(0, -1),
          ),
        ),
    },
  )
  .filter((candidate) => !ALL_NAMES.includes(candidate));

/**
 * Values of every type other than `string`, including the wrapper shapes a
 * coercing membership test would wrongly accept: a boxed string, a one-element
 * array holding a name, and an object carrying one under a field name.
 */
const nonStringArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      true,
      false,
      0,
      1,
      -0,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      [],
      ['Owner'],
      [['Owner']],
      {},
      { role: 'Owner' },
      { value: 'Active' },
      1n,
      Symbol('Owner'),
      () => 'Owner',
      new Map([['Owner', 1]]),
      new Set(['Owner']),
      new Date(0),
      Object('Owner'),
      Object.create(null),
      /Owner/,
    ),
  },
  { weight: 2, arbitrary: fc.integer() },
  { weight: 1, arbitrary: fc.double() },
  { weight: 1, arbitrary: fc.boolean() },
  { weight: 1, arbitrary: fc.array(fc.constantFrom(...ALL_NAMES), { maxLength: 3 }) },
  {
    weight: 3,
    arbitrary: fc
      .anything({ maxDepth: 2, withBigInt: true, withMap: true, withSet: true })
      .filter((value) => typeof value !== 'string'),
  },
);

/** Anything at all, weighted so acceptance and rejection both occur often. */
const anyCandidateArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(...ALL_NAMES) },
  { weight: 4, arbitrary: outsiderStringArb },
  { weight: 5, arbitrary: nonStringArb },
);

// --- Invariant 0: the suite covers the module, and sees the generated types ---

describe('the wire enum suite covers every union the module declares', () => {
  it('tests exactly the unions WIRE_ENUM_COVERAGE names', () => {
    // The table above is hand-written, so it could fall behind the module. The
    // coverage object's keys are the module's own list of unions, which makes
    // "every union is tested" an assertion rather than an assumption: a union
    // added to `wireEnums.ts` and not to this file fails here.
    expect(UNIONS.map((union) => union.schemaName).sort()).toEqual(
      Object.keys(WIRE_ENUM_COVERAGE).sort(),
    );
  });

  it('carries seven unions and seventeen names in total', () => {
    // A vacuous suite would pass every property below. Both floors are stated,
    // because an empty tuple would satisfy "every name is accepted" trivially.
    expect(UNIONS).toHaveLength(7);
    expect(ALL_NAMES).toHaveLength(17);

    for (const { schemaName, names } of UNIONS) {
      expect(names.length, schemaName).toBeGreaterThan(0);
    }
  });

  it('reads the committed types off disk, so the oracle is not this module', () => {
    expect(generatedSchemaSource.length).toBeGreaterThan(1000);
    expect(generatedSchemaPath.replace(/\\/g, '/')).toContain(
      'packages/api-client/src/schema.d.ts',
    );
    // The reader can see a union where one exists — without this, every oracle
    // comparison below could be comparing two empty lists.
    expect(generatedUnionMembers('SquadRole')).toEqual([
      'Owner',
      'Admin',
      'Member',
    ]);
  });
});

// --- The per-union suite -----------------------------------------------------

/**
 * The whole suite for one wire enum union.
 *
 * @param schemaName the `components['schemas']` key the union aliases
 * @param names the module's name tuple for that union
 * @param is the module's predicate for that union
 */
function describeWireEnum({ schemaName, names, is }: WireEnumUnderTest): void {
  const nameArb = fc.constantFrom(...names);

  // Validates: Requirements 12.2, 12.3
  describe(`wire enum — ${schemaName}`, () => {
    it('names exactly the members the committed types declare, in order', () => {
      // The `satisfies` checks in `wireEnums.ts` are the guarantee; this is the
      // independent one. It is asserted literally against the generated source,
      // because a generated round trip over the module's own tuple would agree
      // with any tuple at all, including one missing a member.
      expect(names).toEqual(generatedUnionMembers(schemaName));
    });

    it('names each member once, so membership is unambiguous', () => {
      expect(new Set(names).size).toBe(names.length);
    });

    it('accepts every one of its names', () => {
      fc.assert(
        fc.property(nameArb, (name) => {
          expect(is(name)).toBe(true);
        }),
        { numRuns: 200 },
      );
    });

    it('rejects every string outside its names, including the retired ones', () => {
      fc.assert(
        fc.property(outsiderStringArb, (candidate) => {
          // Stated over arbitrary strings rather than a chosen few, so a
          // predicate that accepted everything and one that case-folded both
          // fail here (12.8's acceptance rule rests on this).
          expect(is(candidate)).toBe(false);
        }),
        { numRuns: 1000 },
      );
    });

    it('rejects every value of every other type', () => {
      fc.assert(
        fc.property(nonStringArb, (candidate) => {
          expect(is(candidate)).toBe(false);
        }),
        { numRuns: 1000 },
      );
    });

    it('answers a boolean for any input at all, and raises nothing', () => {
      fc.assert(
        fc.property(anyCandidateArb, (candidate) => {
          // Totality: the predicate is handed an unverified response field, so
          // every input must settle rather than throw.
          expect(typeof is(candidate)).toBe('boolean');
        }),
        { numRuns: 1000 },
      );
    });

    it('is deterministic across repeated reads', () => {
      fc.assert(
        fc.property(anyCandidateArb, (candidate) => {
          expect(is(candidate)).toBe(is(candidate));
          expect(is(candidate)).toBe(is(candidate));
        }),
        { numRuns: 500 },
      );
    });

    it('agrees with its own name list, for any string at all', () => {
      fc.assert(
        fc.property(fc.oneof(nameArb, outsiderStringArb), (candidate) => {
          // The predicate restated as an equivalence against the tuple it is
          // built from: no input is accepted that the tuple does not carry, and
          // none refused that it does.
          expect(is(candidate)).toBe(names.includes(candidate));
        }),
        { numRuns: 500 },
      );
    });
  });
}

for (const union of UNIONS) {
  describeWireEnum(union);
}

// --- Every predicate at once -------------------------------------------------

// Validates: Requirements 12.2, 12.3
describe('every wire enum predicate is bound to its own union', () => {
  it('accepts a name exactly when its own union carries it', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_NAMES), (name) => {
        // Read side by side, because a predicate bound to the wrong tuple — a
        // real possibility with seven near-identical one-line bindings — answers
        // plausibly on its own. `Active` belongs to two of these unions, so the
        // answers, not merely the presence of an answer, are what separate them.
        const answers = UNIONS.map(({ schemaName, is }) => [schemaName, is(name)]);
        const expected = UNIONS.map(({ schemaName, names }) => [
          schemaName,
          names.includes(name),
        ]);

        expect(answers).toEqual(expected);
      }),
      { numRuns: 500 },
    );
  });

  it('never converts a candidate, so a hostile toString or valueOf never runs', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_NAMES), (name) => {
        let conversions = 0;
        const hostile = {
          valueOf() {
            conversions += 1;
            return name;
          },
          toString() {
            conversions += 1;
            return name;
          },
        };

        for (const { schemaName, is } of UNIONS) {
          expect(is(hostile), schemaName).toBe(false);
        }

        expect(conversions).toBe(0);
      }),
      { numRuns: 200 },
    );
  });

  it('survives a self-referencing structure and a throwing accessor', () => {
    const selfReferencing: Record<string, unknown> = { name: 'Owner' };
    selfReferencing.self = selfReferencing;

    const cyclicArray: unknown[] = ['Owner'];
    cyclicArray.push(cyclicArray);

    const throwingGetter = {
      get name(): string {
        throw new Error('must never be read');
      },
    };

    for (const { schemaName, is } of UNIONS) {
      for (const candidate of [selfReferencing, cyclicArray, throwingGetter]) {
        expect(is(candidate), schemaName).toBe(false);
      }
    }
  });

  it('shares no name between two unions that a parser reads from one body', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_NAMES), (name) => {
        // Not a prohibition — `Active` is deliberately both an `InviteState` and
        // a `MembershipState`. What matters is that no name is carried by so many
        // unions that a mis-bound predicate would be invisible above: every name
        // is carried by at most two.
        const carriers = UNIONS.filter(({ names }) => names.includes(name));

        expect(carriers.length).toBeGreaterThan(0);
        expect(carriers.length).toBeLessThanOrEqual(2);
      }),
      { numRuns: 200 },
    );
  });
});
