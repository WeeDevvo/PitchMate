import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { SQUAD_FEATURE_CODES, squadFeatureFromCode } from '../enumCodes';
import type { ParseResult } from './primitives';
import {
  parseFeatureFlag,
  parseFeatureFlags,
  type FeatureFlag,
} from './featureFlags';

/**
 * Property test for the Feature_Flag body shape, placed beside the module it
 * covers as the design's Testing Strategy asks and running well above the
 * 100-iteration floor (20.1).
 *
 * This file carries **Property 35** for `featureFlags.ts`: for any value supplied
 * as a response body — absent, `null`, a primitive of every type, an array, an
 * object with each required field missing, an object with each field mistyped, an
 * enum field carrying a code the Enum_Code_Map does not name, and a value nested a
 * hundred levels deep — both parsers yield exactly one of a fully populated value
 * and a parse failure, and raise nothing (16.4, 16.6).
 *
 * The module serves two operations — `GetFeatureFlags` and the `features` property
 * of `GetSquad` — so what holds here holds for the Squad_Screen's initial toggle
 * state and for the state it holds after a refresh.
 *
 * Two facts of this shape shape the assertions.
 *
 * **The table has one entry.** `SquadFeature` names only `1`, which makes the
 * out-of-range space unusually wide and unusually easy to get wrong: `0` and `2`
 * are both near misses, and `0` is exactly what a 0-based misreading would name.
 * The generator below feeds both, along with `3` — the code the task names for
 * `SkillTier`, which is out of range for this table too.
 *
 * **A duplicated feature is not a failure.** Unlike a leaderboard, where two
 * entries for one membership make a rating ambiguous, a repeated flag decides
 * nothing about anybody, so the collection carries it. That is asserted explicitly
 * so the difference between the two collections stays a decision rather than an
 * accident.
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
      'true',
      'live-match-tracking',
      '{}',
      0n,
      1n,
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
      [{ feature: 1 }],
      {},
      { feature: 1 },
      Object.create(null),
      new Date(0),
      new Map<unknown, unknown>([['feature', 1]]),
      new Set<unknown>([1]),
      () => ({}),
      Object(1),
      Object(true),
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

/**
 * Values no Feature_Flag code names.
 *
 * `0` is the near miss a 0-based misreading would name and `2` the one an
 * additional feature would occupy; `3` is the code the task names for `SkillTier`,
 * out of range here as well. `null` and an absence belong here rather than in the
 * well-formed generator: unlike a squad summary's role, a feature is required, so
 * an absent one is a contract mismatch (16.6).
 */
const unnamedFeatureCodeArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      0,
      -0,
      2,
      3,
      4,
      -1,
      0.5,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '1',
      'live-match-tracking',
      true,
      false,
      [1],
      { feature: 1 },
      1n,
    ),
  },
  {
    weight: 2,
    arbitrary: anyBodyArb.filter((value) => squadFeatureFromCode(value) === undefined),
  },
);

/**
 * Values no boolean field accepts. A defaulted `isEnabled: false` would misstate a
 * squad's configuration on a toggle nobody sent, so the truthy and falsy near
 * misses come first.
 */
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
      { isEnabled: true },
      Object(true),
      0n,
    ),
  },
  { weight: 3, arbitrary: anyBodyArb.filter((value) => typeof value !== 'boolean') },
);

/* -------------------------------------------------------------------------- */
/* Well-formed bodies, and what a populated value must look like              */
/* -------------------------------------------------------------------------- */

/** The one named code the Enum_Code_Map carries for this table. */
const NAMED_FEATURE_CODES: readonly number[] = Object.keys(SQUAD_FEATURE_CODES).map(
  Number,
);

/** The feature names the Enum_Code_Map carries, read from the map itself. */
const FEATURE_NAMES: readonly string[] = Object.values(SQUAD_FEATURE_CODES);

/** A well-formed Feature_Flag element. */
const wellFormedFlagArb: fc.Arbitrary<Record<string, unknown>> = fc.record({
  feature: fc.constantFrom(...NAMED_FEATURE_CODES),
  isEnabled: fc.boolean(),
});

/** Every field this shape declares. */
const FIELDS = ['feature', 'isEnabled'] as const;

/**
 * Whether a parsed Feature_Flag is fully populated: exactly the two declared
 * fields, each of its declared type, with neither left `undefined`.
 */
function isFullyPopulatedFlag(flag: FeatureFlag): boolean {
  return (
    keySignature(flag) === 'feature,isEnabled' &&
    FEATURE_NAMES.includes(flag.feature) &&
    typeof flag.isEnabled === 'boolean'
  );
}

/** Whether a parsed collection is fully populated in every element. */
function isFullyPopulatedFlags(flags: readonly FeatureFlag[]): boolean {
  return Array.isArray(flags) && flags.every(isFullyPopulatedFlag);
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
/* One flag                                                                   */
/* -------------------------------------------------------------------------- */

// Feature: web-squads-screens, Property 35: Every response parser is total and never yields a partial value
// Validates: Requirements 16.4, 16.6, 20.10
describe('parseFeatureFlag — total, and never partial', () => {
  it('settles every input into exactly one of a populated value and a failure', () => {
    fc.assert(
      fc.property(anyBodyArb, (body) => {
        settle(() => parseFeatureFlag(body), isFullyPopulatedFlag);
      }),
      { numRuns: 1000 },
    );
  });

  it('settles a value nested to 100 levels', () => {
    fc.assert(
      fc.property(deeplyNestedArb, (body) => {
        const outcome = settle(() => parseFeatureFlag(body), isFullyPopulatedFlag);

        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('settles a well-formed body whose field is 100 levels deep', () => {
    fc.assert(
      fc.property(
        wellFormedFlagArb,
        fc.constantFrom(...FIELDS),
        deeplyNestedArb,
        (body, key, deep) => {
          const outcome = settle(
            () => parseFeatureFlag({ ...body, [key]: deep }),
            isFullyPopulatedFlag,
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('parses every well-formed body into a fully populated value', () => {
    fc.assert(
      fc.property(wellFormedFlagArb, (body) => {
        const outcome = settle(() => parseFeatureFlag(body), isFullyPopulatedFlag);

        expect(outcome.ok).toBe(true);

        if (outcome.ok) {
          expect(outcome.value.feature).toBe(squadFeatureFromCode(body.feature));
          expect(outcome.value.isEnabled).toBe(body.isEnabled);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('fails when either required field is absent', () => {
    fc.assert(
      fc.property(wellFormedFlagArb, fc.constantFrom(...FIELDS), (body, key) => {
        const outcome = settle(
          () => parseFeatureFlag(without(body, key)),
          isFullyPopulatedFlag,
        );

        // All or nothing: no unnamed toggle, and no toggle rendered off because
        // nobody sent a state.
        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('fails when the feature code names nothing, 0 and 2 and 3 included', () => {
    fc.assert(
      fc.property(fc.boolean(), unnamedFeatureCodeArb, (isEnabled, feature) => {
        const outcome = settle(
          () => parseFeatureFlag({ feature, isEnabled }),
          isFullyPopulatedFlag,
        );

        // 16.6: an unnamed feature has no label, so rendering it would mean an
        // unnamed toggle and dropping it would shorten the admin surface.
        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('fails when the state is not a boolean', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NAMED_FEATURE_CODES),
        notABooleanArb,
        (feature, isEnabled) => {
          const outcome = settle(
            () => parseFeatureFlag({ feature, isEnabled }),
            isFullyPopulatedFlag,
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('fails rather than raising when a named field throws on read', () => {
    fc.assert(
      fc.property(wellFormedFlagArb, fc.constantFrom(...FIELDS), (body, key) => {
        const outcome = settle(
          () => parseFeatureFlag(throwingAt(body, key)),
          isFullyPopulatedFlag,
        );

        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('is deterministic, so no reading depends on a clock or a counter', () => {
    fc.assert(
      fc.property(fc.oneof(anyBodyArb, wellFormedFlagArb), (body) => {
        expect(parseFeatureFlag(body)).toEqual(parseFeatureFlag(body));
      }),
      { numRuns: 500 },
    );
  });

  it('composes its reason from field labels and never from the value', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('a-secret-invite-token', 'live-match-tracking'),
        (secret) => {
          const outcome = settle(
            () => parseFeatureFlag({ feature: secret, isEnabled: true }),
            isFullyPopulatedFlag,
          );

          expect(outcome.ok).toBe(false);

          if (!outcome.ok) {
            expect(outcome.reason).not.toContain(secret);
            expect(outcome.reason).toContain('feature');
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The whole collection                                                       */
/* -------------------------------------------------------------------------- */

// Feature: web-squads-screens, Property 35: Every response parser is total and never yields a partial value
// Validates: Requirements 16.4, 16.6, 20.10
describe('parseFeatureFlags — total, and complete or failed', () => {
  it('settles every input into exactly one of a populated value and a failure', () => {
    fc.assert(
      fc.property(anyBodyArb, (body) => {
        settle(() => parseFeatureFlags(body), isFullyPopulatedFlags);
      }),
      { numRuns: 1000 },
    );
  });

  it('settles a value nested to 100 levels', () => {
    fc.assert(
      fc.property(deeplyNestedArb, (body) => {
        settle(() => parseFeatureFlags(body), isFullyPopulatedFlags);
      }),
      { numRuns: 300 },
    );
  });

  it('parses a collection of any length into one populated value per element', () => {
    fc.assert(
      fc.property(fc.array(wellFormedFlagArb, { maxLength: 20 }), (elements) => {
        const outcome = settle(
          () => parseFeatureFlags(elements),
          isFullyPopulatedFlags,
        );

        // The empty collection is a valid one — a squad with no optional features
        // renders a statement, not an error (14.8).
        expect(outcome.ok).toBe(true);
        expect(outcome.ok && outcome.value).toHaveLength(elements.length);
      }),
      { numRuns: 300 },
    );
  });

  it('carries a repeated feature rather than failing on it', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NAMED_FEATURE_CODES),
        fc.array(fc.boolean(), { minLength: 2, maxLength: 6 }),
        (feature, states) => {
          const outcome = settle(
            () =>
              parseFeatureFlags(states.map((isEnabled) => ({ feature, isEnabled }))),
            isFullyPopulatedFlags,
          );

          // Deliberately unlike the leaderboard's duplicate rule (8.11): a repeated
          // flag decides nothing about anybody, so the collection renders what it
          // carries.
          expect(outcome.ok).toBe(true);
          expect(outcome.ok && outcome.value).toHaveLength(states.length);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('fails the whole collection when any one element is bad', () => {
    fc.assert(
      fc.property(
        fc.array(wellFormedFlagArb, { minLength: 1, maxLength: 8 }),
        fc.nat(),
        fc.oneof(
          anyBodyArb,
          wellFormedFlagArb.map((body) => without(body, 'isEnabled')),
        ),
        (elements, offset, spoiled) => {
          const index = offset % elements.length;
          const body: unknown[] = [...elements];
          body[index] = spoiled;

          const outcome = settle(
            () => parseFeatureFlags(body),
            isFullyPopulatedFlags,
          );

          expect(outcome.ok).toBe(parseFeatureFlag(spoiled).ok);
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
            () => parseFeatureFlags(body),
            isFullyPopulatedFlags,
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });
});
