import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { isSquadIdentifier } from '../identifiers';
import {
  MAX_INSTANT_MS,
  fail,
  ok,
  printInstant,
  readArray,
  readBoolean,
  readInstantMs,
  readNumber,
  readObject,
  readOptional,
  readProperty,
  readString,
  readUuid,
  type ParseResult,
  type ValueReader,
  type WireObject,
} from './primitives';

/**
 * Property test for the reading primitives every Response_Parser is built from,
 * placed beside the module it covers as the design's Testing Strategy asks and
 * running well above the 100-iteration floor (20.1).
 *
 * This file carries **Property 35** for `primitives.ts`. Every parser in
 * `lib/parse/` reads its fields through these readers, so the property is
 * established here once and then re-established per shape in the sibling files:
 * for any input of any type — absent, `null`, a primitive of every type, an
 * array, an object, a value nested a hundred levels deep — each reader yields
 * exactly one of a fully populated reading and a failure carrying a diagnostic
 * reason, and raises nothing (16.4).
 *
 * Three things about how this is written matter more than the run counts.
 *
 * First, **"exactly one of the two shapes" is asserted structurally**, through
 * {@link settle}: the returned object's own key set must be exactly `ok,value` or
 * exactly `ok,reason`, a successful reading must satisfy its reader's declared
 * type, and a failure must carry a non-empty string. A reader that returned
 * `{ ok: true }` with no value, `{ ok: true, value: undefined }`, or an object
 * carrying both a value and a reason is rejected here; a tag comparison would
 * notice none of it.
 *
 * Second, the **all-or-nothing half of 16.4 is asserted as input preservation**.
 * For every reader but the instant reader, a successful reading must be the
 * *same value* that went in — `Object.is`, so a trimmed string, a stringified
 * number, a coerced boolean, or a case-folded identity all fail. That is what
 * makes "never repairs, defaults, truncates, or coerces" a checked claim rather
 * than a comment.
 *
 * Third, **nothing here re-declares the logic under test**. Where a generator
 * needs to know what a reader accepts it asks the production predicate
 * (`isSquadIdentifier`) or the reader itself, and the assertions are about the
 * shape and the preservation of the reading rather than about a second copy of
 * the acceptance rule. The one exception is deliberate: the enum near-misses and
 * the malformed instants below are stated as literals, because a generator
 * filtered by the module under test cannot demonstrate that a specific wrong
 * value is rejected.
 *
 * The Skill_Tier code `3` the task names is generated against every enum field in
 * the sibling files. It appears in no response body this feature parses — the
 * tier is a *command* input — so there is no reader here to point it at; what it
 * stands for, a 0-based table misread as 1-based, is covered by Property 37 in
 * `enumCodes.property.test.ts` and by the out-of-range code generators of the
 * shape files.
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
 * Settles one reading and asserts Property 35's frame around it: no exception,
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
    // 16.4: a reader raises nothing, for any input at all.
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
/* Generators over the whole input space                                      */
/* -------------------------------------------------------------------------- */

/** A well-formed identity, for the generators that need one to spoil. */
const WELL_FORMED_IDENTITY = '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b';

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
      3,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_VALUE,
      MAX_INSTANT_MS,
      MAX_INSTANT_MS + 1,
      '',
      ' ',
      '0',
      '1',
      'true',
      'null',
      'undefined',
      '{}',
      '[]',
      '{"squadId":"x"}',
      WELL_FORMED_IDENTITY,
      WELL_FORMED_IDENTITY.toUpperCase(),
      `  ${WELL_FORMED_IDENTITY}  `,
      '2026-01-01T00:00:00Z',
      '2026-01-01T00:00:00',
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
      { 0: 'a', length: 1 },
      Object.create(null),
      new Date(0),
      new Map<unknown, unknown>([['a', 1]]),
      new Set<unknown>([1]),
      () => ({}),
      Object('a'),
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
const anyValueArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 5, arbitrary: primitiveArb },
  { weight: 5, arbitrary: structuralArb },
);

/** Labels, including the empty one, so a reason is never assumed to be padded. */
const labelArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom('', 'field', 'squad summary squadId') },
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

/* -------------------------------------------------------------------------- */
/* The readers, each with the declared type of its reading                    */
/* -------------------------------------------------------------------------- */

/**
 * Every reader of the module paired with the declared type of a successful
 * reading and with whether that reading must be the input value itself.
 *
 * `preservesInput` is the all-or-nothing half of 16.4 made checkable: a reader
 * that trimmed, coerced, or defaulted would return a value that is not the one it
 * was given. Only the instant reader is exempt, because normalising an ISO string
 * to epoch milliseconds is its whole purpose.
 */
const READERS: readonly {
  readonly label: string;
  readonly read: (value: unknown, label: string) => ParseResult<unknown>;
  readonly holdsDeclaredType: (value: unknown) => boolean;
  readonly preservesInput: boolean;
}[] = [
  {
    label: 'readObject',
    read: readObject,
    holdsDeclaredType: (value) =>
      typeof value === 'object' && value !== null && !Array.isArray(value),
    preservesInput: true,
  },
  {
    label: 'readArray',
    read: readArray,
    holdsDeclaredType: (value) => Array.isArray(value),
    preservesInput: true,
  },
  {
    label: 'readString',
    read: (value, label) => readString(value, label),
    holdsDeclaredType: (value) => typeof value === 'string',
    preservesInput: true,
  },
  {
    label: 'readString with bounds',
    read: (value, label) => readString(value, label, { minLength: 1, maxLength: 8 }),
    holdsDeclaredType: (value) =>
      typeof value === 'string' && value.length >= 1 && value.length <= 8,
    preservesInput: true,
  },
  {
    label: 'readNumber',
    read: readNumber,
    holdsDeclaredType: (value) => typeof value === 'number' && Number.isFinite(value),
    preservesInput: true,
  },
  {
    label: 'readBoolean',
    read: readBoolean,
    holdsDeclaredType: (value) => typeof value === 'boolean',
    preservesInput: true,
  },
  {
    label: 'readUuid',
    read: readUuid,
    holdsDeclaredType: (value) => isSquadIdentifier(value),
    preservesInput: true,
  },
  {
    label: 'readInstantMs',
    read: readInstantMs,
    holdsDeclaredType: (value) =>
      typeof value === 'number' &&
      Number.isInteger(value) &&
      Math.abs(value) <= MAX_INSTANT_MS,
    preservesInput: false,
  },
  {
    label: 'readOptional of readString',
    read: (value, label) => readOptional(value, label, readString),
    holdsDeclaredType: (value) => value === null || typeof value === 'string',
    preservesInput: false,
  },
  {
    label: 'readOptional of readInstantMs',
    read: (value, label) => readOptional(value, label, readInstantMs),
    holdsDeclaredType: (value) =>
      value === null ||
      (typeof value === 'number' &&
        Number.isInteger(value) &&
        Math.abs(value) <= MAX_INSTANT_MS),
    preservesInput: false,
  },
];

/* -------------------------------------------------------------------------- */
/* Every reader, over every input                                             */
/* -------------------------------------------------------------------------- */

// Feature: web-squads-screens, Property 35: Every response parser is total and never yields a partial value
// Validates: Requirements 16.4, 16.6, 20.10
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

  it('returns the value it was given, never a repaired one', () => {
    fc.assert(
      fc.property(anyValueArb, labelArb, (value, label) => {
        for (const { read, holdsDeclaredType, preservesInput } of READERS) {
          if (!preservesInput) {
            continue;
          }

          const outcome = settle(() => read(value, label), holdsDeclaredType);

          if (outcome.ok) {
            // 16.4: nothing is trimmed, stringified, or coerced. `Object.is` so
            // that a `-0` read as `0` would still be caught.
            expect(Object.is(outcome.value, value)).toBe(true);
          }
        }
      }),
      { numRuns: 1000 },
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

  it('never converts a value, so a hostile toString or valueOf never runs', () => {
    fc.assert(
      fc.property(labelArb, (label) => {
        let conversions = 0;
        const hostile = {
          valueOf() {
            conversions += 1;
            return 1;
          },
          toString() {
            conversions += 1;
            return WELL_FORMED_IDENTITY;
          },
        };

        for (const { read, holdsDeclaredType } of READERS) {
          settle(() => read(hostile, label), holdsDeclaredType);
        }

        expect(conversions).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('settles on a self-referencing value and on a throwing accessor', () => {
    const selfReferencing: Record<string, unknown> = { value: 1 };
    selfReferencing.self = selfReferencing;

    const cyclicArray: unknown[] = [1];
    cyclicArray.push(cyclicArray);

    const throwingAccessor = {
      get value(): never {
        throw new Error('must never be read');
      },
    };

    for (const { read, holdsDeclaredType } of READERS) {
      for (const candidate of [selfReferencing, cyclicArray, throwingAccessor]) {
        settle(() => read(candidate, 'field'), holdsDeclaredType);
      }
    }
  });

  it('composes its reason from the label and never from the value', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<unknown>(
          'a-secret-invite-token',
          'Former player',
          9_999_999,
          { detail: 'a backend message' },
          [WELL_FORMED_IDENTITY],
        ),
        (value) => {
          // 4.10 and 17.2: a reason is a diagnostic composed of literal text, so
          // an invite secret or a display name can never travel in one.
          for (const { read, holdsDeclaredType } of READERS) {
            const outcome = settle(
              () => read(value, 'the field label'),
              holdsDeclaredType,
            );

            if (!outcome.ok) {
              expect(outcome.reason).toContain('the field label');
              expect(outcome.reason).not.toContain('a-secret-invite-token');
              expect(outcome.reason).not.toContain('Former player');
              expect(outcome.reason).not.toContain('9999999');
              expect(outcome.reason).not.toContain('a backend message');
              expect(outcome.reason).not.toContain(WELL_FORMED_IDENTITY);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The two result constructors                                                */
/* -------------------------------------------------------------------------- */

// Feature: web-squads-screens, Property 35: Every response parser is total and never yields a partial value
// Validates: Requirements 16.4, 20.10
describe('reading primitives — the result shape has exactly two forms', () => {
  it('builds a populated reading from any value, absent included', () => {
    fc.assert(
      fc.property(anyValueArb, (value) => {
        const outcome = ok(value);

        expect(outcome.ok).toBe(true);
        expect(keySignature(outcome)).toBe('ok,value');
        expect(Object.is(outcome.value, value)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('builds a failure carrying exactly its reason', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (reason) => {
        const outcome = fail(reason);

        expect(outcome.ok).toBe(false);
        expect(keySignature(outcome)).toBe('ok,reason');
        expect(outcome.reason).toBe(reason);
      }),
      { numRuns: 300 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Individual readers: the values they must reject                            */
/* -------------------------------------------------------------------------- */

// Feature: web-squads-screens, Property 35: Every response parser is total and never yields a partial value
// Validates: Requirements 16.4, 16.6, 20.10
describe('reading primitives — each reader accepts exactly its own type', () => {
  it('reads an object exactly when the value is a plain non-array object', () => {
    fc.assert(
      fc.property(anyValueArb, (value) => {
        const outcome = readObject(value, 'body');
        const isPlainObject =
          typeof value === 'object' && value !== null && !Array.isArray(value);

        // An array is a list and a string of JSON is not parsed here, so neither
        // reads as a body.
        expect(outcome.ok).toBe(isPlainObject);
      }),
      { numRuns: 500 },
    );
  });

  it('reads an array exactly when the value is an array', () => {
    fc.assert(
      fc.property(anyValueArb, (value) => {
        expect(readArray(value, 'list').ok).toBe(Array.isArray(value));
      }),
      { numRuns: 500 },
    );
  });

  it('reads a string exactly when the value is a primitive string', () => {
    fc.assert(
      fc.property(anyValueArb, (value) => {
        // A boxed string is an object, not a string, and a number is not
        // stringified: `12` must not read as `'12'`.
        expect(readString(value, 'field').ok).toBe(typeof value === 'string');
      }),
      { numRuns: 500 },
    );
  });

  it('applies its length bounds inclusively and trims nothing', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom('', ' ', 'a', 'ab', '  ', '   a   '),
          fc.string({ maxLength: 12 }),
        ),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 0, max: 6 }),
        (value, minLength, span) => {
          const maxLength = minLength + span;
          const outcome = settle(
            () => readString(value, 'field', { minLength, maxLength }),
            (read) => typeof read === 'string',
          );

          expect(outcome.ok).toBe(
            value.length >= minLength && value.length <= maxLength,
          );

          if (outcome.ok) {
            // Inclusive at both ends, and untrimmed: `'   a   '` within bounds
            // reads as itself, spaces and all.
            expect(outcome.value).toBe(value);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it('reads a number exactly when the value is a finite number', () => {
    fc.assert(
      fc.property(anyValueArb, (value) => {
        const isFiniteNumber = typeof value === 'number' && Number.isFinite(value);

        // A string-encoded number is not this backend's wire form, and `NaN` and
        // the infinities are not values JSON can carry.
        expect(readNumber(value, 'field').ok).toBe(isFiniteNumber);
      }),
      { numRuns: 500 },
    );
  });

  it('preserves negative zero rather than normalising it', () => {
    const outcome = readNumber(-0, 'field');

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && Object.is(outcome.value, -0)).toBe(true);
  });

  it('reads a boolean exactly when the value is a boolean', () => {
    fc.assert(
      fc.property(anyValueArb, (value) => {
        // Notably `0`, `1`, `'true'`, and `null` are not booleans: a flag nobody
        // sent must fail rather than default to `false`.
        expect(readBoolean(value, 'field').ok).toBe(typeof value === 'boolean');
      }),
      { numRuns: 500 },
    );
  });

  it('reads an identity exactly when the feature-wide predicate accepts it', () => {
    fc.assert(
      fc.property(anyValueArb, (value) => {
        // Read from `lib/identifiers.ts` rather than restated, so a route check
        // and a parser cannot disagree about what an identity looks like.
        expect(readUuid(value, 'field').ok).toBe(isSquadIdentifier(value));
      }),
      { numRuns: 500 },
    );
  });

  it('rejects the identity variants the feature does not accept', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<unknown>(
          undefined,
          null,
          '',
          WELL_FORMED_IDENTITY.replace(/-/g, ''),
          `{${WELL_FORMED_IDENTITY}}`,
          `(${WELL_FORMED_IDENTITY})`,
          `urn:uuid:${WELL_FORMED_IDENTITY}`,
          ` ${WELL_FORMED_IDENTITY}`,
          `${WELL_FORMED_IDENTITY} `,
          WELL_FORMED_IDENTITY.slice(0, 35),
          `${WELL_FORMED_IDENTITY}b`,
          `${WELL_FORMED_IDENTITY.slice(0, 35)}g`,
          [WELL_FORMED_IDENTITY],
          { squadId: WELL_FORMED_IDENTITY },
        ),
        (value) => {
          const outcome = settle(
            () => readUuid(value, 'field'),
            (read) => isSquadIdentifier(read),
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('reads a well-formed identity in either letter case, unchanged', () => {
    fc.assert(
      fc.property(fc.constantFrom(false, true), (upper) => {
        const identity = upper
          ? WELL_FORMED_IDENTITY.toUpperCase()
          : WELL_FORMED_IDENTITY;
        const outcome = readUuid(identity, 'field');

        expect(outcome.ok).toBe(true);
        // Opaque to this feature, so neither case-folded nor rewritten.
        expect(outcome.ok && outcome.value).toBe(identity);
      }),
      { numRuns: 100 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Absence                                                                    */
/* -------------------------------------------------------------------------- */

// Feature: web-squads-screens, Property 35: Every response parser is total and never yields a partial value
// Validates: Requirements 16.4, 20.10
describe('reading primitives — an optional reading is absent-or-valid', () => {
  /** Every reader `readOptional` is asked to wrap in this feature. */
  const WRAPPED: readonly {
    readonly label: string;
    readonly reader: ValueReader<unknown>;
    readonly holdsDeclaredType: (value: unknown) => boolean;
  }[] = [
    {
      label: 'readString',
      reader: readString,
      holdsDeclaredType: (value) => value === null || typeof value === 'string',
    },
    {
      label: 'readUuid',
      reader: readUuid,
      holdsDeclaredType: (value) => value === null || isSquadIdentifier(value),
    },
    {
      label: 'readInstantMs',
      reader: readInstantMs,
      holdsDeclaredType: (value) => value === null || typeof value === 'number',
    },
  ];

  it('reads null and an absent value as the same absence', () => {
    fc.assert(
      fc.property(fc.constantFrom<unknown>(null, undefined), labelArb, (absence, label) => {
        // 16.8: the distinction a JSON body can draw between "sent as null" and
        // "not sent" carries no meaning here, so both yield the one absence.
        for (const { reader, holdsDeclaredType } of WRAPPED) {
          const outcome = settle(
            () => readOptional(absence, label, reader),
            holdsDeclaredType,
          );

          expect(outcome.ok).toBe(true);
          expect(outcome.ok && outcome.value).toBeNull();
        }
      }),
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

// Feature: web-squads-screens, Property 35: Every response parser is total and never yields a partial value
// Validates: Requirements 16.4, 20.10
describe('reading primitives — a property read never raises', () => {
  it('yields the property of a plain object and undefined for an absent one', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ maxLength: 6 }), primitiveArb, { maxKeys: 6 }),
        fc.oneof(
          fc.constantFrom('a', 'squadId', 'toString', '__proto__', 'constructor'),
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
      fc.property(fc.constantFrom('squadId', 'name', 'state'), (key) => {
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
      fc.property(fc.constantFrom('unrecognised', 'extra', 'statistic'), (key) => {
        let reads = 0;
        const body = Object.defineProperty({ squadId: WELL_FORMED_IDENTITY }, key, {
          enumerable: true,
          get(): never {
            reads += 1;
            throw new Error('must never be read');
          },
        }) as WireObject;

        // 16.9 holds by omission: an unnamed property is never touched, so it can
        // neither fail a body nor cost anything.
        expect(readProperty(body, 'squadId')).toBe(WELL_FORMED_IDENTITY);
        expect(reads).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Instants                                                                   */
/* -------------------------------------------------------------------------- */

/** Instant strings the reader must accept, with the instant each names. */
const ACCEPTED_INSTANTS: readonly (readonly [string, number])[] = [
  ['1970-01-01T00:00:00Z', 0],
  ['1970-01-01T00:00:00.000Z', 0],
  ['1970-01-01T00:00Z', 0],
  ['1970-01-01t00:00:00z', 0],
  ['1970-01-01T00:00:00,000Z', 0],
  ['1970-01-01T00:00:00.0009Z', 0],
  ['1970-01-01T01:00:00+01:00', 0],
  ['1970-01-01T01:00:00+0100', 0],
  ['1970-01-01T01:00:00+01', 0],
  ['1969-12-31T23:00:00-01:00', 0],
  ['2026-02-28T23:59:59.999Z', Date.UTC(2026, 1, 28, 23, 59, 59, 999)],
  ['2024-02-29T00:00:00Z', Date.UTC(2024, 1, 29)],
  ['2000-02-29T00:00:00Z', Date.UTC(2000, 1, 29)],
  ['+002026-01-01T00:00:00Z', Date.UTC(2026, 0, 1)],
];

/** Values the instant reader must reject. */
const REJECTED_INSTANTS: readonly unknown[] = [
  undefined,
  null,
  0,
  1_700_000_000_000,
  true,
  '',
  '2026-01-01',
  '2026-01-01T00:00:00',
  '2026-01-01T00:00:00+24:00',
  '2026-01-01T00:00:00+00:60',
  '2026-02-30T00:00:00Z',
  '2026-13-01T00:00:00Z',
  '2026-00-01T00:00:00Z',
  '2026-01-00T00:00:00Z',
  '2026-01-32T00:00:00Z',
  '2026-01-01T24:00:00Z',
  '2026-01-01T00:60:00Z',
  '2026-01-01T00:00:60Z',
  '2023-02-29T00:00:00Z',
  '1900-02-29T00:00:00Z',
  '-000000-01-01T00:00:00Z',
  '+275760-09-14T00:00:00Z',
  ' 2026-01-01T00:00:00Z',
  '2026-01-01T00:00:00Z ',
  '26-01-01T00:00:00Z',
  ['2026-01-01T00:00:00Z'],
  { expiresAt: '2026-01-01T00:00:00Z' },
];

// Feature: web-squads-screens, Property 35: Every response parser is total and never yields a partial value
// Validates: Requirements 16.4, 20.10
describe('reading primitives — an instant is read whole or not at all', () => {
  it('reads every accepted form as the instant it names', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ACCEPTED_INSTANTS), ([text, instantMs]) => {
        const outcome = settle(
          () => readInstantMs(text, 'field'),
          (value) =>
            typeof value === 'number' &&
            Number.isInteger(value) &&
            Math.abs(value) <= MAX_INSTANT_MS,
        );

        expect(outcome.ok).toBe(true);
        expect(outcome.ok && outcome.value).toBe(instantMs);
      }),
      { numRuns: 200 },
    );
  });

  it('rejects every value that names no instant', () => {
    fc.assert(
      fc.property(fc.constantFrom(...REJECTED_INSTANTS), (value) => {
        const outcome = settle(
          () => readInstantMs(value, 'field'),
          (read) => typeof read === 'number',
        );

        // A local-time string names no instant, epoch milliseconds are not this
        // feature's wire form, and a rolled-over calendar field is rejected
        // rather than absorbed.
        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('carries no matcher state between reads of the same value', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ACCEPTED_INSTANTS), ([text]) => {
        // An anchored, non-sticky pattern: three reads in a row must agree, which
        // a `lastIndex`-carrying pattern would not.
        const first = readInstantMs(text, 'field');
        const second = readInstantMs(text, 'field');
        const third = readInstantMs(text, 'field');

        expect(first).toEqual(second);
        expect(second).toEqual(third);
      }),
      { numRuns: 200 },
    );
  });

  it('reads an arbitrary string as an instant or as a failure, and never raises', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ maxLength: 40 }),
          fc.constantFrom(...ACCEPTED_INSTANTS).map(([text]) => text),
          fc
            .tuple(fc.integer({ min: -1, max: 300000 }), fc.integer({ min: 0, max: 99 }))
            .map(([year, month]) => `${String(year)}-${String(month)}-01T00:00:00Z`),
        ),
        (text) => {
          settle(
            () => readInstantMs(text, 'field'),
            (value) =>
              typeof value === 'number' &&
              Number.isInteger(value) &&
              Math.abs(value) <= MAX_INSTANT_MS,
          );
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('prints any value as a string, raising nothing and inventing no instant', () => {
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

          const reread = readInstantMs(printed, 'field');

          // 16.5: a value that cannot round-trip prints as something the reader
          // rejects, rather than as the instant it would truncate to.
          const isRepresentable =
            Number.isInteger(instantMs) && Math.abs(instantMs) <= MAX_INSTANT_MS;

          expect(reread.ok).toBe(isRepresentable);

          if (reread.ok) {
            expect(reread.value).toBe(instantMs === 0 ? 0 : instantMs);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
