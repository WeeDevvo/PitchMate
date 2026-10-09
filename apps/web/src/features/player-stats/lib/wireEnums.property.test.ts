import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  MEMBERSHIP_STATE_NAMES,
  RATING_STATE_NAMES,
  WIRE_ENUM_COVERAGE,
  isMembershipState,
  isRatingState,
} from './wireEnums';

/**
 * Property tests for the Player_Stats_Feature's two wire enum unions, placed
 * beside the module they cover and running above the 100-iteration floor
 * (Requirement 14.5).
 *
 * The design assigns no numbered property to this module — the numbered
 * properties over parsing are the Response_Parser's (Properties 5 to 7) — and
 * the vocabulary itself is already pinned by the two `satisfies` directions in
 * `wireEnums.ts`. What is left for a runtime test is the part a type cannot
 * state, and it is not nothing:
 *
 * 1. **The tuples agree with the contract as text.** The `satisfies` checks are
 *    the real guarantee, but they live *in the same module* as the tuples they
 *    check, so weakening one weakens the other. The names are therefore
 *    additionally asserted against {@link CONTRACT_NAMES}, transcribed from the
 *    Committed_Types' generated unions — `MembershipState: "Active" |
 *    "Inactive" | null` and `RatingState: "Provisional" | "Established" | null`.
 *    That makes this an **oracle, not a round trip**: a test deriving its
 *    expectations from the module's own tuples would agree with any tuple at
 *    all, including one missing a member. The transcription is deliberate rather
 *    than read off disk, so this module under `lib/` keeps the import discipline
 *    the `pureLogic` scan protects (Requirement 14.3) — the drift direction that
 *    matters, a member added to or renamed in the backend enum, fails `tsc -b`
 *    at the `satisfies` and at the Web_Drift_Gate before it reaches here.
 * 2. **The predicates are total.** `isMembershipState(x)` is handed an `unknown`
 *    lifted straight out of a response body. Every input must settle to a
 *    boolean and nothing may throw — including a value whose `toString` or
 *    `valueOf` is hostile, which a coercing membership test would run.
 * 3. **Each predicate is bound to its own tuple.** Two near-identical one-line
 *    bindings is exactly the shape where a copy-paste leaves one predicate
 *    reading the other's names, and the two are read side by side here so that
 *    the mis-binding shows.
 * 4. **The retired numeric vocabulary is rejected.** A previous contract sent
 *    these two fields as integer codes; this one sends names (Requirement 13.4).
 *    {@link RETIRED_NUMERIC_CODES} and their digit-string spellings are
 *    generated as outsiders on purpose: a predicate that accepted either would
 *    let a stale body through unnoticed, and the feature maps no code to a name.
 *
 * `WIRE_ENUM_COVERAGE` is read for its keys, which are the module's own list of
 * the unions it declares — that turns "this suite covers the module" into an
 * assertion rather than an assumption.
 */

// --- The oracle: the vocabulary the Committed_Types declare ------------------

/**
 * The string members of each Generated_Enum_Union, in declaration order, as
 * transcribed from `packages/api-client/src/schema.d.ts`.
 *
 * The folded `null` of each generated union — a reference-site nullability the
 * document exporter puts into the shared schema — is deliberately absent: the
 * module's aliases exclude it, because "no state recorded" is an absence the
 * Response_Parser decides and not a member of the backend enum.
 */
const CONTRACT_NAMES = {
  MembershipState: ['Active', 'Inactive'],
  RatingState: ['Provisional', 'Established'],
} as const;

// --- The unions under test ---------------------------------------------------

/** One wire enum union: its generated schema name, its names, its predicate. */
interface WireEnumUnderTest {
  /** The key of `components['schemas']` the union aliases. */
  readonly schemaName: keyof typeof CONTRACT_NAMES;
  /** The module's own tuple of names. */
  readonly names: readonly string[];
  readonly is: (candidate: unknown) => boolean;
}

const UNIONS: readonly WireEnumUnderTest[] = [
  {
    schemaName: 'MembershipState',
    names: MEMBERSHIP_STATE_NAMES,
    is: isMembershipState,
  },
  { schemaName: 'RatingState', names: RATING_STATE_NAMES, is: isRatingState },
];

/**
 * The contract's names for one union, widened to `readonly string[]` so the
 * oracle can be asked about an arbitrary string rather than only about a value
 * the tuple's own literal type admits.
 */
const contractNamesOf = (
  schemaName: keyof typeof CONTRACT_NAMES,
): readonly string[] => CONTRACT_NAMES[schemaName];

/** Every name of both unions — which is also the set of plausible near-misses. */
const ALL_NAMES: readonly string[] = UNIONS.flatMap((union) => union.names);

/**
 * The integer codes a previous contract sent for these same two fields, before
 * the backend serialised every wire enum by name.
 *
 * Kept as a bare list of numbers rather than as a map to names, because this
 * feature holds no such mapping and the structural scan forbids one
 * (Requirement 13.4). They are generated as rejected inputs: a predicate that
 * accepted `0` would read a stale body as a settled state.
 */
const RETIRED_NUMERIC_CODES: readonly number[] = [0, 1, 2, 3, -1];

// --- Generators --------------------------------------------------------------

/**
 * Strings that are no union's name: casing and whitespace variants of real
 * names, the digit strings the retired numeric vocabulary would have arrived as
 * if it were ever stringified, prototype member names, and arbitrary text.
 *
 * Filtered against {@link ALL_NAMES} rather than against one union, so the same
 * generator serves the "rejects an outsider" property of both unions and can
 * never accidentally produce a name one of them legitimately carries.
 */
const outsiderStringArb: fc.Arbitrary<string> = fc
  .oneof(
    {
      weight: 6,
      arbitrary: fc.constantFrom(
        '',
        ' ',
        '\n',
        '\t',
        'ACTIVE',
        'active',
        'aCTIVE',
        'Active ',
        ' Active',
        'Activ',
        'Actives',
        'In-active',
        'In Active',
        'INACTIVE',
        'inactive',
        'PROVISIONAL',
        'provisional',
        'Provisiona',
        'Provisional!',
        'Established ',
        'established',
        'Establish',
        'Unestablished',
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
    {
      weight: 3,
      arbitrary: fc
        .constantFrom(...RETIRED_NUMERIC_CODES)
        .map((code) => String(code)),
    },
    { weight: 3, arbitrary: fc.string({ maxLength: 24 }) },
    { weight: 2, arbitrary: fc.string({ unit: 'grapheme', maxLength: 12 }) },
    {
      weight: 4,
      arbitrary: fc.constantFrom(...ALL_NAMES).chain((name) =>
        fc.constantFrom(
          name.toLowerCase(),
          name.toUpperCase(),
          `${name} `,
          ` ${name}`,
          `${name}\n`,
          `${name}${name}`,
          name.slice(1),
          name.slice(0, -1),
          `"${name}"`,
        ),
      ),
    },
  )
  .filter((candidate) => !ALL_NAMES.includes(candidate));

/**
 * Values of every type other than `string`, including the shapes a coercing
 * membership test would wrongly accept: a boxed string, a one-element array
 * holding a name, and an object carrying one under a field name.
 *
 * The retired integer codes are generated here as numbers as well as above as
 * digit strings, because the field they stood for is exactly the field these
 * predicates read.
 */
const nonStringArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      true,
      false,
      -0,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      [],
      ['Active'],
      [['Provisional']],
      {},
      {
        // Named with a neutral key: this is a wrapper a coercing check would
        // unwrap, not a wire body, and the wire field names carry no number here.
        value: 'Active',
      },
      { label: 'Provisional' },
      1n,
      Symbol('Active'),
      () => 'Established',
      new Map([['Active', true]]),
      new Set(['Inactive']),
      new Date(0),
      Object('Active'),
      Object('Provisional'),
      Object.create(null),
      /Active/,
    ),
  },
  { weight: 4, arbitrary: fc.constantFrom(...RETIRED_NUMERIC_CODES) },
  { weight: 2, arbitrary: fc.integer() },
  { weight: 1, arbitrary: fc.double() },
  { weight: 1, arbitrary: fc.boolean() },
  {
    weight: 1,
    arbitrary: fc.array(fc.constantFrom(...ALL_NAMES), { maxLength: 3 }),
  },
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

// --- The suite covers the module, and agrees with the contract ---------------

// Feature: web-player-stats-screen, supports Properties 5 to 7: the vocabulary
// the Response_Parser reads each Wire_Enum_Name against is exactly the
// contract's, and this suite covers every union the module declares
// Validates: Requirements 13.4, 14.5
describe('the wire enum suite covers every union the module declares', () => {
  it('tests exactly the unions WIRE_ENUM_COVERAGE names', () => {
    // The table above is hand-written, so it could fall behind the module. The
    // coverage object's keys are the module's own list of unions, which makes
    // "every union is tested" an assertion: a union added to `wireEnums.ts` and
    // not to this file fails here.
    expect(UNIONS.map((union) => union.schemaName).sort()).toEqual(
      Object.keys(WIRE_ENUM_COVERAGE).sort(),
    );
  });

  it('names the two unions the feature reads, and no third', () => {
    // Stated literally, because a suite derived entirely from the module would
    // accept a module that had quietly grown or lost a union.
    expect(Object.keys(WIRE_ENUM_COVERAGE).sort()).toEqual([
      'MembershipState',
      'RatingState',
    ]);
    expect(Object.keys(CONTRACT_NAMES).sort()).toEqual(
      Object.keys(WIRE_ENUM_COVERAGE).sort(),
    );
  });

  it('carries two unions and four names in total, so nothing is vacuous', () => {
    // An empty tuple would satisfy "every name is accepted" trivially, so both
    // floors are stated.
    expect(UNIONS).toHaveLength(2);
    expect(ALL_NAMES).toHaveLength(4);

    for (const { schemaName, names } of UNIONS) {
      expect(names.length, schemaName).toBeGreaterThan(0);
    }
  });

  it('shares no name between the two unions, so a mis-binding cannot hide', () => {
    // Not a rule of the contract, an observation this suite depends on: because
    // the four names are distinct, a predicate bound to the other union's tuple
    // is visible in the side-by-side property below rather than merely
    // plausible.
    expect(new Set(ALL_NAMES).size).toBe(ALL_NAMES.length);
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
  const contractNames: readonly string[] = contractNamesOf(schemaName);
  const nameArb = fc.constantFrom(...names);

  /** The other union's names: the nearest plausible wrong vocabulary. */
  const otherNames: readonly string[] = ALL_NAMES.filter(
    (name) => !names.includes(name),
  );

  // Feature: web-player-stats-screen, supports Properties 5 to 7: a predicate
  // accepts exactly its declared names, rejects every other value, and raises
  // nothing
  // Validates: Requirements 13.4, 14.5
  describe(`wire enum — ${schemaName}`, () => {
    it('names exactly the members the contract declares, in order', () => {
      // Against the transcribed oracle rather than against the module's own
      // tuple, so the two can disagree and a defect shows.
      expect(names).toEqual(contractNames);
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

    it('rejects every string outside its names, in any casing', () => {
      fc.assert(
        fc.property(outsiderStringArb, (candidate) => {
          // Stated over arbitrary strings rather than a chosen few, so a
          // predicate that accepted everything and one that case-folded both
          // fail here.
          expect(is(candidate)).toBe(false);
        }),
        { numRuns: 1000 },
      );
    });

    it('rejects a name of the other union', () => {
      fc.assert(
        fc.property(fc.constantFrom(...otherNames), (name) => {
          expect(is(name)).toBe(false);
        }),
        { numRuns: 200 },
      );
    });

    it('rejects every value of every other type, codes and boxed strings included', () => {
      fc.assert(
        fc.property(nonStringArb, (candidate) => {
          expect(is(candidate)).toBe(false);
        }),
        { numRuns: 1000 },
      );
    });

    it('rejects the integer codes the previous contract sent for this field', () => {
      fc.assert(
        fc.property(fc.constantFrom(...RETIRED_NUMERIC_CODES), (code) => {
          // Both spellings, because the stale value could arrive as a number or
          // as a digit string, and the feature maps neither to a name (13.4).
          expect(is(code)).toBe(false);
          expect(is(String(code))).toBe(false);
        }),
        { numRuns: 200 },
      );
    });

    it('rejects absence in both its spellings, and the empty string', () => {
      // Absence is the Response_Parser's concern, not the vocabulary's: a null
      // or absent state is a valid absence there and simply not a name here.
      expect(is(undefined)).toBe(false);
      expect(is(null)).toBe(false);
      expect(is('')).toBe(false);
    });

    it('answers a boolean for any input at all, and raises nothing', () => {
      fc.assert(
        fc.property(anyCandidateArb, (candidate) => {
          // Totality: the predicate is handed an unverified response field, so
          // every input must settle rather than throw (13.1).
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
          // built from: no input accepted that the tuple does not carry, and
          // none refused that it does.
          expect(is(candidate)).toBe(names.includes(candidate));
        }),
        { numRuns: 500 },
      );
    });

    it('agrees with the transcribed contract, for any string at all', () => {
      fc.assert(
        fc.property(fc.oneof(nameArb, outsiderStringArb), (candidate) => {
          // The same equivalence against the oracle, so acceptance is pinned to
          // the contract's vocabulary and not merely to the module's own list.
          expect(is(candidate)).toBe(contractNames.includes(candidate));
        }),
        { numRuns: 500 },
      );
    });
  });
}

for (const union of UNIONS) {
  describeWireEnum(union);
}

// --- Both predicates at once -------------------------------------------------

// Feature: web-player-stats-screen, supports Properties 5 to 7: each predicate
// is bound to its own union and converts nothing
// Validates: Requirements 13.4, 14.5
describe('every wire enum predicate is bound to its own union', () => {
  it('accepts a name exactly when its own union carries it', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_NAMES), (name) => {
        // Read side by side, because a predicate bound to the wrong tuple — a
        // real possibility with two near-identical one-line bindings — answers
        // plausibly on its own.
        const answers = UNIONS.map(({ schemaName, is }) => [
          schemaName,
          is(name),
        ]);
        const expected = UNIONS.map(({ schemaName }) => [
          schemaName,
          contractNamesOf(schemaName).includes(name),
        ]);

        expect(answers).toEqual(expected);
      }),
      { numRuns: 500 },
    );
  });

  it('accepts a name under exactly one of the two predicates', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_NAMES), (name) => {
        const accepting = UNIONS.filter(({ is }) => is(name));

        expect(accepting).toHaveLength(1);
      }),
      { numRuns: 200 },
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

  it('rejects a value nested arbitrarily deep without walking into it', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_NAMES),
        fc.integer({ min: 1, max: 100 }),
        (name, depth) => {
          let candidate: unknown = name;
          for (let level = 0; level < depth; level += 1) {
            candidate = level % 2 === 0 ? [candidate] : { value: candidate };
          }

          for (const { schemaName, is } of UNIONS) {
            expect(is(candidate), schemaName).toBe(false);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('survives a self-referencing structure and a throwing accessor', () => {
    const selfReferencing: Record<string, unknown> = { value: 'Active' };
    selfReferencing.self = selfReferencing;

    const cyclicArray: unknown[] = ['Provisional'];
    cyclicArray.push(cyclicArray);

    const throwingGetter = {
      get value(): string {
        throw new Error('must never be read');
      },
    };

    for (const { schemaName, is } of UNIONS) {
      for (const candidate of [selfReferencing, cyclicArray, throwingGetter]) {
        expect(is(candidate), schemaName).toBe(false);
      }
    }
  });
});
