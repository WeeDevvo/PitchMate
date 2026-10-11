import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { MAX_DURATION_MS } from '../duration';
import { isPlayerStatsIdentifier } from '../identifiers';
import {
  MEMBERSHIP_STATE_NAMES,
  RATING_STATE_NAMES,
  isMembershipState,
  isRatingState,
} from '../wireEnums';
import {
  MAX_INSTANT_MS,
  fail,
  ok,
  printInstant,
  readArray,
  readBoolean,
  readCount,
  readDurationMs,
  readInstantMs,
  readNumber,
  readObject,
  readOptional,
  readPercentage,
  readProperty,
  readString,
  readUuid,
  readWireEnumName,
  type ParseResult,
  type ValueReader,
  type WireObject,
} from './primitives';

/**
 * Property test for the reading primitives every Response_Parser of this feature
 * is built from, placed beside the module it covers as the design's Testing
 * Strategy asks and running well above the 100-case floor (14.5).
 *
 * This file carries **Property 5**: for any value at all — absent, `null`, a
 * primitive of every type, an array, a plain object, an object whose shape
 * violates what a reader expects, an object carrying a throwing accessor, an
 * object with a hostile `toString` and `valueOf`, a value nested a hundred
 * levels deep, or a boxed primitive — every reader of `lib/parse/primitives.ts`
 * yields exactly one of an accepted reading and a failure, and raises nothing.
 *
 * Four things about how this is written matter more than the run counts.
 *
 * First, **"exactly one of the two shapes" is asserted structurally**, through
 * {@link settle}: the returned object's own key set must be exactly `ok,value` or
 * exactly `ok,reason`, a successful reading must satisfy its reader's declared
 * type, and a failure must carry a non-empty string. A reader that returned
 * `{ ok: true }` with no value, `{ ok: true, value: undefined }`, or an object
 * carrying both a value and a reason is rejected here; a tag comparison would
 * notice none of it.
 *
 * Second, **non-coercion is asserted with a conversion counter** rather than
 * inferred from the accept/reject sets. The hostile value below counts every
 * invocation of `toString`, `valueOf`, and `Symbol.toPrimitive`, and the count
 * must stay at zero across every reader: that is what makes "a hostile accessor
 * never runs" a checked claim. The all-or-nothing half of the same idea is
 * asserted as input preservation — for every reader whose reading is the value
 * itself, a success must return that same value under `Object.is`, so a trimmed
 * string, a stringified number, a rounded count, or a clamped percentage would
 * fail here.
 *
 * Third, **reason composition is asserted without restating the clauses**. For
 * each reader the clause left after stripping the caller's label is collected
 * over a fixed sample of rejected values; the collected set must be identical
 * under two different labels and must stay far smaller than the sample, which is
 * only possible if the clause is fixed text rather than text derived from the
 * value. The sentinel values in that sample are then asserted absent from every
 * reason, so a display name or a backend message cannot travel in one.
 *
 * Fourth, **nothing here re-declares the logic under test**. Where a generator
 * needs to know what a reader accepts it asks the production predicate
 * (`isPlayerStatsIdentifier`, `isMembershipState`) or the reader itself. The
 * accepted and rejected *sets* of the narrowed numeric readers are Property 13's
 * subject and the duration form is Property 25's; this file asserts only that
 * every reader settles, preserves, and discloses nothing.
 *
 * Requirements: 13.1
 */

/* -------------------------------------------------------------------------- */
/* The totality harness                                                       */
/* -------------------------------------------------------------------------- */

/** A value's own keys, sorted, as a comparable string. */
function keySignature(value: object): string {
  return Object.keys(value).sort().join(',');
}

/**
 * Settles one reading and asserts Property 5's frame around it: no exception,
 * exactly one of the two result shapes with exactly its own fields, a value
 * satisfying `holdsDeclaredType` on success, and a non-empty diagnostic reason on
 * failure.
 *
 * Returns the settled result so a caller can additionally assert *which* of the
 * two outcomes was required for a particular input.
 */
function settle<T>(
  read: () => ParseResult<T>,
  holdsDeclaredType: (value: T) => boolean,
): ParseResult<T> {
  let outcome: ParseResult<T>;

  try {
    outcome = read();
  } catch (raised) {
    // 13.1: a reader raises nothing, for any input at all.
    throw new Error(`the reader raised instead of failing: ${String(raised)}`, {
      cause: raised,
    });
  }

  expect(typeof outcome).toBe('object');
  expect(outcome).not.toBeNull();
  expect(typeof outcome.ok).toBe('boolean');

  if (outcome.ok) {
    // Exactly a populated reading: no reason alongside it, and no absent value.
    expect(keySignature(outcome)).toBe('ok,value');
    expect(holdsDeclaredType(outcome.value)).toBe(true);
  } else {
    // Exactly a failure: a diagnostic reason and nothing else.
    expect(keySignature(outcome)).toBe('ok,reason');
    expect(typeof outcome.reason).toBe('string');
    expect(outcome.reason.length).toBeGreaterThan(0);
  }

  return outcome;
}

/* -------------------------------------------------------------------------- */
/* The readers, each with the declared type of its reading                    */
/* -------------------------------------------------------------------------- */

/** Whether a value is a reading of {@link readInstantMs}. */
function isReadInstant(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    Math.abs(value) <= MAX_INSTANT_MS
  );
}

/** Whether a value is a reading of {@link readDurationMs}. */
function isReadDuration(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_DURATION_MS
  );
}

/**
 * Every reader the module exports, paired with the declared type of a successful
 * reading and with whether that reading must be the input value itself.
 *
 * `preservesInput` is the all-or-nothing half of 13.1 made checkable: a reader
 * that trimmed, coerced, defaulted, rounded, or clamped would return a value
 * that is not the one it was given. The instant and duration readers are exempt,
 * because normalising a wire string to milliseconds is their whole purpose, and
 * so is `readOptional`, which turns an absence into `null`.
 *
 * `admitsPlainObject` marks the one reader whose accepted type *is* an object, so
 * the boxed-primitive case below can state that every other reader rejects one.
 */
const READERS: readonly {
  readonly label: string;
  readonly read: (value: unknown, label: string) => ParseResult<unknown>;
  readonly holdsDeclaredType: (value: unknown) => boolean;
  readonly preservesInput: boolean;
  readonly admitsPlainObject: boolean;
}[] = [
  {
    label: 'readObject',
    read: readObject,
    holdsDeclaredType: (value) =>
      typeof value === 'object' && value !== null && !Array.isArray(value),
    preservesInput: true,
    admitsPlainObject: true,
  },
  {
    label: 'readArray',
    read: readArray,
    holdsDeclaredType: (value) => Array.isArray(value),
    preservesInput: true,
    admitsPlainObject: false,
  },
  {
    label: 'readString',
    read: (value, label) => readString(value, label),
    holdsDeclaredType: (value) => typeof value === 'string',
    preservesInput: true,
    admitsPlainObject: false,
  },
  {
    label: 'readString with bounds',
    read: (value, label) => readString(value, label, { minLength: 1, maxLength: 8 }),
    holdsDeclaredType: (value) =>
      typeof value === 'string' && value.length >= 1 && value.length <= 8,
    preservesInput: true,
    admitsPlainObject: false,
  },
  {
    label: 'readNumber',
    read: readNumber,
    holdsDeclaredType: (value) => typeof value === 'number' && Number.isFinite(value),
    preservesInput: true,
    admitsPlainObject: false,
  },
  {
    label: 'readBoolean',
    read: readBoolean,
    holdsDeclaredType: (value) => typeof value === 'boolean',
    preservesInput: true,
    admitsPlainObject: false,
  },
  {
    label: 'readUuid',
    read: readUuid,
    holdsDeclaredType: (value) => isPlayerStatsIdentifier(value),
    preservesInput: true,
    admitsPlainObject: false,
  },
  {
    label: 'readCount',
    read: readCount,
    holdsDeclaredType: (value) =>
      typeof value === 'number' && Number.isInteger(value) && value >= 0,
    preservesInput: true,
    admitsPlainObject: false,
  },
  {
    label: 'readPercentage',
    read: readPercentage,
    holdsDeclaredType: (value) =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100,
    preservesInput: true,
    admitsPlainObject: false,
  },
  {
    label: 'readDurationMs',
    read: readDurationMs,
    holdsDeclaredType: isReadDuration,
    preservesInput: false,
    admitsPlainObject: false,
  },
  {
    label: 'readInstantMs',
    read: readInstantMs,
    holdsDeclaredType: isReadInstant,
    preservesInput: false,
    admitsPlainObject: false,
  },
  {
    label: 'readWireEnumName of isMembershipState',
    read: (value, label) => readWireEnumName(value, label, isMembershipState),
    holdsDeclaredType: (value) => isMembershipState(value),
    preservesInput: true,
    admitsPlainObject: false,
  },
  {
    label: 'readWireEnumName of isRatingState',
    read: (value, label) => readWireEnumName(value, label, isRatingState),
    holdsDeclaredType: (value) => isRatingState(value),
    preservesInput: true,
    admitsPlainObject: false,
  },
  {
    label: 'readOptional of readPercentage',
    read: (value, label) => readOptional(value, label, readPercentage),
    holdsDeclaredType: (value) =>
      value === null ||
      (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100),
    preservesInput: false,
    admitsPlainObject: false,
  },
  {
    label: 'readOptional of readCount',
    read: (value, label) => readOptional(value, label, readCount),
    holdsDeclaredType: (value) =>
      value === null ||
      (typeof value === 'number' && Number.isInteger(value) && value >= 0),
    preservesInput: false,
    admitsPlainObject: false,
  },
  {
    label: 'readOptional of readDurationMs',
    read: (value, label) => readOptional(value, label, readDurationMs),
    holdsDeclaredType: (value) => value === null || isReadDuration(value),
    preservesInput: false,
    admitsPlainObject: false,
  },
  {
    label: 'readOptional of readInstantMs',
    read: (value, label) => readOptional(value, label, readInstantMs),
    holdsDeclaredType: (value) => value === null || isReadInstant(value),
    preservesInput: false,
    admitsPlainObject: false,
  },
  {
    label: 'readOptional of readWireEnumName',
    read: (value, label) =>
      readOptional(value, label, (field, fieldLabel) =>
        readWireEnumName(field, fieldLabel, isRatingState),
      ),
    holdsDeclaredType: (value) => value === null || isRatingState(value),
    preservesInput: false,
    admitsPlainObject: false,
  },
  {
    label: 'readOptional of readString',
    read: (value, label) => readOptional(value, label, readString),
    holdsDeclaredType: (value) => value === null || typeof value === 'string',
    preservesInput: false,
    admitsPlainObject: false,
  },
];

/* -------------------------------------------------------------------------- */
/* Generators over the whole input space                                      */
/* -------------------------------------------------------------------------- */

/** A well-formed identity, for the generators that need one to spoil. */
const WELL_FORMED_IDENTITY = '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b';

/**
 * One value each reader of the table accepts, so the shape-violation generator
 * below has something real to spoil rather than only arbitrary noise.
 */
const ACCEPTED_VALUES: readonly unknown[] = [
  {},
  { appearances: 1 },
  [],
  [1, 2],
  '',
  'Dave',
  0,
  -0,
  1,
  12,
  33.333,
  100,
  true,
  false,
  null,
  WELL_FORMED_IDENTITY,
  '2026-01-01T00:00:00Z',
  '00:45:00',
  '1.01:00:00',
  ...MEMBERSHIP_STATE_NAMES,
  ...RATING_STATE_NAMES,
];

/**
 * Values of every primitive type together with the two absences, weighted so the
 * hand-named edges occur densely and arbitrary values still occur.
 */
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
      2.5,
      -0.5,
      -0.1,
      100,
      100.1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_VALUE,
      MAX_INSTANT_MS,
      MAX_INSTANT_MS + 1,
      MAX_DURATION_MS,
      '',
      ' ',
      '0',
      '12',
      '50',
      'true',
      'null',
      'undefined',
      '{}',
      '[]',
      '{"appearances":1}',
      'Active',
      'active',
      'Provisional',
      'provisional',
      'Established',
      WELL_FORMED_IDENTITY,
      WELL_FORMED_IDENTITY.toUpperCase(),
      `  ${WELL_FORMED_IDENTITY}  `,
      '2026-01-01T00:00:00Z',
      '2026-01-01T00:00:00',
      '00:45:00',
      '1.01:00:00',
      '-00:45:00',
      '45m',
      0n,
      1n,
      Symbol('wire'),
    ),
  },
  { weight: 2, arbitrary: fc.string({ maxLength: 40 }) },
  { weight: 1, arbitrary: fc.string({ unit: 'grapheme', maxLength: 12 }) },
  { weight: 2, arbitrary: fc.double() },
  { weight: 1, arbitrary: fc.integer() },
  { weight: 1, arbitrary: fc.boolean() },
  { weight: 1, arbitrary: fc.bigInt() },
);

/** The boxed primitives — objects a reader must never read as the primitive. */
const BOXED_PRIMITIVES: readonly object[] = [
  Object('Dave'),
  Object(WELL_FORMED_IDENTITY),
  Object('Active'),
  Object('00:45:00'),
  Object('2026-01-01T00:00:00Z'),
  Object(0),
  Object(12),
  Object(100),
  Object(true),
  Object(false),
  Object(1n),
];

/** Arrays, plain objects, and the exotic object shapes a body could carry. */
const structuralArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.constantFrom<unknown>(
      [],
      [{}],
      [[]],
      [WELL_FORMED_IDENTITY],
      {},
      { value: 1 },
      { 0: 'a', length: 1 },
      Object.create(null),
      new Date(0),
      new Map<unknown, unknown>([['value', 1]]),
      new Set<unknown>([1]),
      () => ({}),
      ...BOXED_PRIMITIVES,
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

/**
 * A value each reader accepts, wrapped so that the shape it expects is violated:
 * put in an array, put in an object, boxed, or re-spelled in the other primitive
 * type. These are the near-misses a reader has to reject rather than unwrap.
 */
const shapeViolationArb: fc.Arbitrary<unknown> = fc
  .tuple(
    fc.constantFrom(...ACCEPTED_VALUES),
    fc.integer({ min: 0, max: 5 }),
  )
  .map(([accepted, kind]) => {
    switch (kind) {
      case 0:
        return [accepted];
      case 1:
        return { value: accepted };
      case 2:
        return { ok: true, value: accepted };
      case 3:
        return new Map<unknown, unknown>([['value', accepted]]);
      case 4:
        return accepted === null || accepted === undefined
          ? Object.create(null)
          : Object(accepted);
      default:
        // A number re-spelled as its decimal string, and a string re-spelled as
        // the number it parses to: the mistyped field of Requirement 13.5.
        return typeof accepted === 'number'
          ? String(accepted)
          : typeof accepted === 'string'
            ? Number(accepted)
            : { [String(kind)]: accepted };
    }
  });

/** The whole input space Property 5 quantifies over. */
const anyValueArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 5, arbitrary: primitiveArb },
  { weight: 5, arbitrary: structuralArb },
  { weight: 3, arbitrary: shapeViolationArb },
);

/** Labels, including the empty one, so a reason is never assumed to be padded. */
const labelArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom('', 'field', 'player record appearances') },
  { weight: 1, arbitrary: fc.string({ maxLength: 20 }) },
);

/**
 * Wraps `leaf` in `depth` levels of alternating arrays and objects. Used to build
 * the 100-level values the property names: a reader must settle on one in the
 * same way it settles on a shallow value, because none of them walks an interior.
 */
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

/** The property names a parser of this feature reads, for the hostile objects. */
const RECOGNISED_KEYS = [
  'membershipId',
  'displayName',
  'appearances',
  'winPercentage',
  'state',
  'displayRating',
  'keeperTime',
  'completedAt',
  'value',
] as const;

/** An object whose named property is an accessor that throws when read. */
function withThrowingAccessor(key: string): WireObject {
  return Object.defineProperty({}, key, {
    enumerable: true,
    configurable: true,
    get(): never {
      throw new Error('a throwing accessor');
    },
  }) as WireObject;
}

/* -------------------------------------------------------------------------- */
/* Every reader, over every input                                             */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 5: Every reading primitive is total and exception-free
// Validates: Requirements 13.1
describe('reading primitives — every reader is total over every input', () => {
  it('yields exactly one of a populated reading and a failure, and raises nothing', () => {
    fc.assert(
      fc.property(anyValueArb, labelArb, (value, label) => {
        for (const { read, holdsDeclaredType } of READERS) {
          settle(() => read(value, label), holdsDeclaredType);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('settles on a value whose shape violates what the reader expects', () => {
    fc.assert(
      fc.property(shapeViolationArb, labelArb, (value, label) => {
        // An accepted value put in an array, put in an object, boxed, or
        // re-spelled in the other primitive type: a near-miss is rejected rather
        // than unwrapped, and never raises.
        for (const { read, holdsDeclaredType } of READERS) {
          settle(() => read(value, label), holdsDeclaredType);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('settles the same way on a value nested to 100 levels', () => {
    fc.assert(
      fc.property(deeplyNestedArb, labelArb, (value, label) => {
        // No reader walks an interior, so depth costs one type test rather than a
        // stack frame per level: a hundred levels must settle, not overflow.
        for (const { read, holdsDeclaredType } of READERS) {
          settle(() => read(value, label), holdsDeclaredType);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('settles on an object carrying a throwing accessor, and never reads it', () => {
    fc.assert(
      fc.property(fc.constantFrom(...RECOGNISED_KEYS), labelArb, (key, label) => {
        const hostile = withThrowingAccessor(key);

        for (const { read, holdsDeclaredType } of READERS) {
          settle(() => read(hostile, label), holdsDeclaredType);
        }

        const hostileArray = Object.defineProperty([], '0', {
          enumerable: true,
          configurable: true,
          get(): never {
            throw new Error('a throwing element');
          },
        });

        for (const { read, holdsDeclaredType } of READERS) {
          settle(() => read(hostileArray, label), holdsDeclaredType);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('settles on a self-referencing value and on a get-trapping proxy', () => {
    const selfReferencing: Record<string, unknown> = { value: 1 };
    selfReferencing.self = selfReferencing;

    const cyclicArray: unknown[] = [1];
    cyclicArray.push(cyclicArray);

    const trapping = new Proxy(
      {},
      {
        get(): never {
          throw new Error('must never be read');
        },
      },
    );

    for (const { read, holdsDeclaredType } of READERS) {
      for (const candidate of [selfReferencing, cyclicArray, trapping]) {
        settle(() => read(candidate, 'field'), holdsDeclaredType);
      }
    }
  });

  it('rejects a boxed primitive everywhere a primitive is read', () => {
    fc.assert(
      fc.property(fc.constantFrom(...BOXED_PRIMITIVES), labelArb, (boxed, label) => {
        for (const { read, holdsDeclaredType, admitsPlainObject } of READERS) {
          const outcome = settle(() => read(boxed, label), holdsDeclaredType);

          // A boxed string is an object, not a string: only the reader whose
          // accepted type *is* an object may take one.
          expect(outcome.ok).toBe(admitsPlainObject);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('is deterministic, so no reading depends on a clock or a counter', () => {
    fc.assert(
      fc.property(anyValueArb, labelArb, (value, label) => {
        for (const { read } of READERS) {
          const first = read(value, label);
          const second = read(value, label);

          expect(first.ok).toBe(second.ok);

          if (first.ok && second.ok) {
            expect(Object.is(first.value, second.value)).toBe(true);
          } else if (!first.ok && !second.ok) {
            expect(first.reason).toBe(second.reason);
          }
        }
      }),
      { numRuns: 500 },
    );
  });

  it('returns the value it was given, never a repaired one', () => {
    fc.assert(
      fc.property(anyValueArb, labelArb, (value, label) => {
        for (const { read, holdsDeclaredType, preservesInput } of READERS) {
          if (!preservesInput) {
            continue;
          }

          const outcome = settle(() => read(value, label), holdsDeclaredType);

          if (outcome.ok) {
            // 13.1 and 13.2: nothing is trimmed, stringified, coerced, rounded,
            // or clamped. `Object.is`, so a `-0` read as `0` would be caught too.
            expect(Object.is(outcome.value, value)).toBe(true);
          }
        }
      }),
      { numRuns: 1000 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Non-coercion                                                               */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 5: Every reading primitive is total and exception-free
// Validates: Requirements 13.1
describe('reading primitives — no reader converts the value it is given', () => {
  it('never invokes toString, valueOf, or Symbol.toPrimitive', () => {
    fc.assert(
      fc.property(labelArb, (label) => {
        let conversions = 0;

        // Every route a coercion could take, each counted. A reader that
        // stringified or numified its input would move the counter; the readers
        // compare types and strings instead, so it must stay at zero.
        const hostile = {
          valueOf() {
            conversions += 1;
            return 1;
          },
          toString() {
            conversions += 1;
            return WELL_FORMED_IDENTITY;
          },
          [Symbol.toPrimitive](hint: string): unknown {
            conversions += 1;
            return hint === 'number' ? 1 : WELL_FORMED_IDENTITY;
          },
        };

        const hostileArray = Object.assign([1], {
          toString() {
            conversions += 1;
            return '00:45:00';
          },
          valueOf() {
            conversions += 1;
            return 45;
          },
        });

        for (const { read, holdsDeclaredType } of READERS) {
          settle(() => read(hostile, label), holdsDeclaredType);
          settle(() => read(hostileArray, label), holdsDeclaredType);
        }

        expect(conversions).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('never invokes a conversion while rejecting a hostile boxed primitive', () => {
    fc.assert(
      fc.property(fc.constantFrom('Dave', '00:45:00', WELL_FORMED_IDENTITY), (text) => {
        let conversions = 0;
        const boxed = Object.assign(Object(text), {
          toString() {
            conversions += 1;
            return text;
          },
          valueOf() {
            conversions += 1;
            return text;
          },
        });

        for (const { read, holdsDeclaredType } of READERS) {
          settle(() => read(boxed, 'field'), holdsDeclaredType);
        }

        // A boxed string is rejected on its type, not unwrapped by conversion.
        expect(conversions).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Failure reasons                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Values every reader rejects, each carrying a sentinel distinctive enough that
 * an accidental echo in a reason would be detectable.
 */
const REJECTED_SAMPLE: readonly unknown[] = [
  'a-secret-display-name',
  'Former player',
  'BigDave',
  9_999_999,
  1_234.567_8,
  -4_242,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  { detail: 'a backend message' },
  { mu: 25.123, sigma: 8.333 },
  [WELL_FORMED_IDENTITY],
  Object('a-secret-display-name'),
  Symbol('a-secret-display-name'),
  0n,
  false,
  '-00:45:00',
  '2026-02-30T00:00:00Z',
  'provisional',
  `  ${WELL_FORMED_IDENTITY}  `,
  undefined,
];

/** The sentinel substrings no reason may contain. */
const SENTINELS: readonly string[] = [
  'a-secret-display-name',
  'Former player',
  'BigDave',
  '9999999',
  '1234.5678',
  '-4242',
  'a backend message',
  '25.123',
  '8.333',
  WELL_FORMED_IDENTITY,
  '2026-02-30',
  '-00:45:00',
  'provisional',
];

/**
 * The distinct clauses a reader leaves once the caller's label is stripped, over
 * {@link REJECTED_SAMPLE}. Asserts the label prefix as it goes.
 */
function clausesOf(
  read: (value: unknown, label: string) => ParseResult<unknown>,
  label: string,
): readonly string[] {
  const clauses = new Set<string>();

  for (const value of REJECTED_SAMPLE) {
    const outcome = read(value, label);

    if (outcome.ok) {
      continue;
    }

    // Composed as the caller's label followed by fixed text, so the label is a
    // prefix of the whole reason.
    expect(outcome.reason.startsWith(label)).toBe(true);
    clauses.add(outcome.reason.slice(label.length));
  }

  return [...clauses].sort();
}

/**
 * The most distinct clauses any one reader declares. Far below the size of
 * {@link REJECTED_SAMPLE}, which is the point: a reason derived from the value
 * would yield a clause per value.
 */
const MAX_CLAUSES_PER_READER = 8;

// Feature: web-player-stats-screen, Property 5: Every reading primitive is total and exception-free
// Validates: Requirements 13.1
describe('reading primitives — a reason is the label plus a fixed clause', () => {
  it('leaves the same clause vocabulary whatever the label is', () => {
    fc.assert(
      fc.property(labelArb, labelArb, (first, second) => {
        for (const { read } of READERS) {
          const underFirst = clausesOf(read, first);
          const underSecond = clausesOf(read, second);

          // 13.8: the only variable part of a reason is the caller's own label,
          // so two labels over the same inputs leave an identical vocabulary.
          expect(underFirst).toEqual(underSecond);

          // A fixed vocabulary, not text built from the value: twenty rejected
          // values of every type collapse onto a handful of clauses.
          expect(underFirst.length).toBeGreaterThan(0);
          expect(underFirst.length).toBeLessThanOrEqual(MAX_CLAUSES_PER_READER);

          for (const clause of underFirst) {
            expect(clause.length).toBeGreaterThan(0);

            for (const sentinel of SENTINELS) {
              expect(clause).not.toContain(sentinel);
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('echoes no value it read, and names the label it was given', () => {
    fc.assert(
      fc.property(fc.constantFrom(...REJECTED_SAMPLE), (value) => {
        // 13.8 and 3.7: a display name, a rating internal, or a backend message
        // embedded in a reason could travel into a log or a rendered outcome, so
        // a reason carries none of them.
        for (const { read, holdsDeclaredType } of READERS) {
          const outcome = settle(
            () => read(value, 'the field label'),
            holdsDeclaredType,
          );

          if (!outcome.ok) {
            expect(outcome.reason).toContain('the field label');

            for (const sentinel of SENTINELS) {
              expect(outcome.reason).not.toContain(sentinel);
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The two result constructors                                                */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 5: Every reading primitive is total and exception-free
// Validates: Requirements 13.1
describe('reading primitives — the result shape has exactly two forms', () => {
  it('builds a populated reading from any value, absent included', () => {
    fc.assert(
      fc.property(anyValueArb, (value) => {
        const outcome = ok(value);

        expect(outcome.ok).toBe(true);

        // The assertion above is what requires the populated form; this narrows
        // the union so `value` can be read, and cannot be skipped silently.
        if (outcome.ok) {
          expect(keySignature(outcome)).toBe('ok,value');
          expect(Object.is(outcome.value, value)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('builds a failure carrying exactly its reason', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (reason) => {
        const outcome = fail(reason);

        expect(outcome.ok).toBe(false);

        // The assertion above is what requires the failure form; this narrows
        // the union so `reason` can be read, and cannot be skipped silently.
        if (!outcome.ok) {
          expect(keySignature(outcome)).toBe('ok,reason');
          expect(outcome.reason).toBe(reason);
        }
      }),
      { numRuns: 300 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Absence                                                                    */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 5: Every reading primitive is total and exception-free
// Validates: Requirements 13.1
describe('reading primitives — an optional reading is absent-or-valid', () => {
  /** Every reader `readOptional` is asked to wrap in this feature. */
  const WRAPPED: readonly {
    readonly label: string;
    readonly reader: ValueReader<unknown>;
    readonly holdsDeclaredType: (value: unknown) => boolean;
  }[] = [
    {
      label: 'readPercentage',
      reader: readPercentage,
      holdsDeclaredType: (value) => value === null || typeof value === 'number',
    },
    {
      label: 'readCount',
      reader: readCount,
      holdsDeclaredType: (value) => value === null || typeof value === 'number',
    },
    {
      label: 'readDurationMs',
      reader: readDurationMs,
      holdsDeclaredType: (value) => value === null || isReadDuration(value),
    },
    {
      label: 'readInstantMs',
      reader: readInstantMs,
      holdsDeclaredType: (value) => value === null || isReadInstant(value),
    },
    {
      label: 'readWireEnumName',
      reader: (value, label) => readWireEnumName(value, label, isRatingState),
      holdsDeclaredType: (value) => value === null || isRatingState(value),
    },
  ];

  it('reads null and an absent value as the same absence', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<unknown>(null, undefined),
        labelArb,
        (absence, label) => {
          // 13.6: the distinction a JSON body can draw between "sent as null" and
          // "not sent" carries no meaning here, so both yield the one absence.
          for (const { reader, holdsDeclaredType } of WRAPPED) {
            const outcome = settle(
              () => readOptional(absence, label, reader),
              holdsDeclaredType,
            );

            expect(outcome.ok).toBe(true);
            expect(outcome.ok && outcome.value).toBeNull();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('hands every other value to its reader, so a malformed optional still fails', () => {
    fc.assert(
      fc.property(
        anyValueArb.filter((value) => value !== null && value !== undefined),
        labelArb,
        (value, label) => {
          for (const { reader, holdsDeclaredType } of WRAPPED) {
            const optional = settle(
              () => readOptional(value, label, reader),
              holdsDeclaredType,
            );
            const direct = reader(value, label);

            // Optional means absent-or-valid, never unvalidated: a present value
            // settles exactly as it would without the wrapper.
            expect(optional.ok).toBe(direct.ok);

            if (optional.ok && direct.ok) {
              expect(Object.is(optional.value, direct.value)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Property reads                                                             */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 5: Every reading primitive is total and exception-free
// Validates: Requirements 13.1
describe('reading primitives — a property read never raises', () => {
  it('yields the property of a plain object and undefined for an absent one', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ maxLength: 6 }), primitiveArb, { maxKeys: 6 }),
        fc.oneof(
          fc.constantFrom<string>(
            ...RECOGNISED_KEYS,
            'toString',
            '__proto__',
            'constructor',
          ),
          fc.string({ maxLength: 6 }),
        ),
        (source, key) => {
          expect(Object.is(readProperty(source, key), source[key])).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('reads a throwing accessor as an absence rather than raising', () => {
    fc.assert(
      fc.property(fc.constantFrom(...RECOGNISED_KEYS), (key) => {
        let reads = 0;
        const hostile = Object.defineProperty({}, key, {
          enumerable: true,
          get(): never {
            reads += 1;
            throw new Error('a throwing accessor');
          },
        }) as WireObject;

        // The one operation an arbitrary body could make raise, guarded here so
        // that "never throws" is absolute rather than conditional on the body
        // being ordinary JSON.
        expect(readProperty(hostile, key)).toBeUndefined();
        expect(reads).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  it('reads nothing a parser does not name, however hostile', () => {
    fc.assert(
      fc.property(fc.constantFrom('unrecognised', 'mu', 'sigma', 'k', 'c'), (key) => {
        let reads = 0;
        const body = Object.defineProperty({ appearances: 7 }, key, {
          enumerable: true,
          get(): never {
            reads += 1;
            throw new Error('must never be read');
          },
        }) as WireObject;

        // 13.9 holds by omission: an unnamed property is never touched, so it can
        // neither fail a body nor cost anything.
        expect(readProperty(body, 'appearances')).toBe(7);
        expect(reads).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The instant printer                                                        */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 5: Every reading primitive is total and exception-free
// Validates: Requirements 13.1
describe('reading primitives — printing an instant is total', () => {
  it('yields a string for every number and raises nothing', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -MAX_INSTANT_MS, max: MAX_INSTANT_MS }),
          fc.double(),
          fc.constantFrom(
            0,
            -0,
            0.5,
            Number.NaN,
            Number.POSITIVE_INFINITY,
            Number.NEGATIVE_INFINITY,
            MAX_INSTANT_MS,
            MAX_INSTANT_MS + 1,
            -MAX_INSTANT_MS - 1,
          ),
        ),
        (instantMs) => {
          let printed: string;

          try {
            printed = printInstant(instantMs);
          } catch (raised) {
            throw new Error(`printInstant raised: ${String(raised)}`, {
              cause: raised,
            });
          }

          expect(typeof printed).toBe('string');
          expect(printed.length).toBeGreaterThan(0);

          // The reading side stays total over whatever was printed, which is what
          // keeps a value that cannot round-trip a failure rather than a throw.
          settle(() => readInstantMs(printed, 'field'), isReadInstant);
        },
      ),
      { numRuns: 500 },
    );
  });
});
