/**
 * Property tests for the App_Shell's pure notification list parser and printer,
 * placed beside the module they cover as Requirement 14.2 asks and run well above
 * the 100-iteration floor.
 *
 * This file holds **Property 6: The notification list parser is total and yields
 * one outcome shape** — the universal claim that any value at all, of any type
 * and any nesting depth, yields exactly one of the two stated outcome shapes,
 * raises nothing, and is a parse-failure exactly when the top-level value is not
 * an array. The concrete named boundaries live in `notificationParsing.test.ts`;
 * candidate acceptance and the print/parse round trip are separate properties
 * appended below this one.
 *
 * Two notes on the input space, stated plainly because they bound what "for any
 * value" means here:
 *
 *  - A notification list body reaches the parser from a deserialised JSON
 *    response, so the generators cover everything such a body can be — absent,
 *    null, of any primitive type, an object, an array of anything, and nesting to
 *    the 100 levels Requirement 10.12 names — plus a few runtime values that
 *    JSON cannot produce (dates, maps, sets, typed arrays, null-prototype
 *    objects, boxed strings) because they cost nothing to defend.
 *  - Candidates carrying an accessor property that throws on read, or a field
 *    value whose `toString`/`valueOf` throws, are generated deliberately. JSON
 *    cannot produce them either, but the module claims totality against them, so
 *    the claim is exercised: a hostile candidate must cost that one candidate and
 *    leave the rest of the response parsed.
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.10, 10.11, 10.12, 14.12, 14.13
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  CATALOGUED_NOTIFICATION_TYPES,
  NOTIFICATION_LIST_PARSE_CAP,
  parseNotificationList,
  printNotificationRecord,
  type ListParse,
  type NotificationRecord,
  type NotificationType,
  type ReadState,
} from './notificationParsing';

/** The seven properties a Notification_Record carries, in no particular order. */
const RECORD_KEYS = [
  'body',
  'createdAtMs',
  'notificationId',
  'readState',
  'squadId',
  'title',
  'type',
] as const;

/** The seven wire properties a candidate record may supply (10.2). */
const WIRE_KEYS = [
  'notificationId',
  'type',
  'squadId',
  'title',
  'body',
  'createdAt',
  'readState',
] as const;

const VALID_NOTIFICATION_ID = '0195f1a2-3b4c-7d8e-9f01-23456789abcd';
const VALID_SQUAD_ID = 'ABCDEF01-2345-6789-ABCD-EF0123456789';

/**
 * Assert the outcome is exactly one of the two shapes Requirement 10.1 states,
 * and nothing else: a parsed outcome carrying an array of zero or more
 * well-shaped records, or a parse-failure carrying no record at all.
 */
function expectExactlyOneOutcome(outcome: ListParse): void {
  if (outcome.kind === 'parsed') {
    expect(Object.keys(outcome).sort()).toEqual(['kind', 'records']);
    expect(Array.isArray(outcome.records)).toBe(true);
    expect(outcome.records.length).toBeGreaterThanOrEqual(0);
    outcome.records.forEach(expectWellShapedRecord);
    return;
  }

  expect(outcome.kind).toBe('parse-failure');
  expect(Object.keys(outcome)).toEqual(['kind']);
}

/**
 * A parsed record is a Notification_Record and not a partially-built value: the
 * seven properties, each of its declared type. Which candidates are *accepted*
 * is Property 7's claim, not this one.
 */
function expectWellShapedRecord(record: NotificationRecord): void {
  expect(Object.keys(record).sort()).toEqual([...RECORD_KEYS]);
  expect(typeof record.notificationId).toBe('string');
  expect(typeof record.squadId).toBe('string');
  expect(typeof record.title).toBe('string');
  expect(typeof record.body).toBe('string');
  expect(Number.isFinite(record.createdAtMs)).toBe(true);
  expect(['unread', 'read']).toContain(record.readState);

  if (record.type.kind === 'catalogued') {
    expect(CATALOGUED_NOTIFICATION_TYPES).toContain(record.type.value);
  } else {
    expect(record.type.kind).toBe('unrecognised');
    expect(Number.isInteger(record.type.code)).toBe(true);
  }
}

/**
 * An independent reading of Requirement 10.10, written from the criterion: the
 * parse-failure outcome is owed exactly to a top-level value that is not an
 * array.
 */
function expectsParseFailure(body: unknown): boolean {
  return !Array.isArray(body);
}

/** A wire candidate carrying every property in its accepted form (10.2). */
function validWireRecord(): Record<string, unknown> {
  return {
    notificationId: VALID_NOTIFICATION_ID,
    type: 4,
    squadId: VALID_SQUAD_ID,
    title: 'Match drafted',
    body: 'Tell the squad which days you can make.',
    createdAt: '2026-03-01T18:30:00Z',
    readState: 0,
  };
}

/** A value nested to the 100 levels Requirement 10.12 names, built two ways. */
function nestedToDepth(hundred: 'objects' | 'arrays', leaf: unknown): unknown {
  let value: unknown = leaf;

  for (let depth = 0; depth < 100; depth += 1) {
    value = hundred === 'objects' ? { nested: value } : [value];
  }

  return value;
}

/** A value whose string and numeric coercions both throw. */
function poisonedValue(): unknown {
  return {
    toString(): string {
      throw new Error('poisoned toString');
    },
    valueOf(): number {
      throw new Error('poisoned valueOf');
    },
  };
}

/** A candidate whose named property throws when read. */
function withThrowingAccessor(
  property: string,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const candidate: Record<string, unknown> = { ...base };

  Object.defineProperty(candidate, property, {
    get(): never {
      throw new Error(`hostile accessor on ${property}`);
    },
    enumerable: true,
    configurable: true,
  });

  return candidate;
}

/** Any runtime value at all, including shapes JSON cannot produce. */
const anyValueArb: fc.Arbitrary<unknown> = fc.anything({
  maxDepth: 3,
  withBigInt: true,
  withBoxedValues: true,
  withDate: true,
  withMap: true,
  withNullPrototype: true,
  withObjectString: true,
  withSet: true,
  withSparseArray: true,
  withTypedArray: true,
  withUnicodeString: true,
});

/** Field values a candidate's seven properties might carry, valid or not. */
const fieldValueArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 3, arbitrary: fc.constant(undefined) },
  {
    weight: 6,
    arbitrary: fc.constantFrom<unknown>(
      VALID_NOTIFICATION_ID,
      VALID_SQUAD_ID,
      VALID_NOTIFICATION_ID.toUpperCase(),
      'not-an-identity',
      '',
      0,
      1,
      2,
      7,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '0',
      true,
      null,
      '2026-03-01T18:30:00Z',
      '2026-03-01T18:30:00',
      '2026-03-01T18:30:00+01:00',
      'Match drafted',
    ),
  },
  { weight: 3, arbitrary: anyValueArb },
  { weight: 1, arbitrary: fc.constant(null).map(() => poisonedValue()) },
);

/** A candidate record built from arbitrary values for its seven properties. */
const candidateArb: fc.Arbitrary<unknown> = fc
  .tuple(
    fc.uniqueArray(fc.constantFrom(...WIRE_KEYS), { minLength: 0, maxLength: 7 }),
    fc.array(fieldValueArb, { minLength: 7, maxLength: 7 }),
    fc.boolean(),
  )
  .map(([overridden, values, startFromValid]) => {
    const candidate: Record<string, unknown> = startFromValid ? validWireRecord() : {};

    overridden.forEach((key, index) => {
      candidate[key] = values[index];
    });

    return candidate;
  });

/** A candidate one of whose properties throws when read. */
const hostileCandidateArb: fc.Arbitrary<unknown> = fc
  .constantFrom(...WIRE_KEYS)
  .map((property) => withThrowingAccessor(property, validWireRecord()));

/** Every top-level body shape the parser could be handed, of any type. */
const anyBodyArb: fc.Arbitrary<unknown> = fc.oneof(
  // Non-array top levels, which acceptance criterion 10.10 makes parse-failures.
  { weight: 4, arbitrary: anyValueArb },
  {
    weight: 3,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      0,
      -0,
      Number.NaN,
      '',
      '[]',
      '[{}]',
      false,
      true,
      {},
      { records: [] },
      { length: 3 },
      Object.create(null) as unknown,
    ),
  },
  { weight: 1, arbitrary: fc.constant(null).map(() => poisonedValue()) },
  // Array top levels, which acceptance criterion 10.11 always makes parsed.
  { weight: 6, arbitrary: fc.array(candidateArb, { minLength: 0, maxLength: 24 }) },
  { weight: 2, arbitrary: fc.array(anyValueArb, { minLength: 0, maxLength: 24 }) },
  { weight: 2, arbitrary: fc.array(hostileCandidateArb, { minLength: 1, maxLength: 6 }) },
  {
    weight: 2,
    arbitrary: fc.array(fc.oneof(candidateArb, hostileCandidateArb, anyValueArb), {
      minLength: 0,
      maxLength: NOTIFICATION_LIST_PARSE_CAP + 8,
    }),
  },
  // Nesting to the depth Requirement 10.12 names, reached four ways.
  {
    weight: 2,
    arbitrary: fc
      .tuple(fc.constantFrom('objects' as const, 'arrays' as const), fieldValueArb)
      .map(([shape, leaf]) => nestedToDepth(shape, leaf)),
  },
  {
    weight: 1,
    arbitrary: fc
      .tuple(fc.constantFrom('objects' as const, 'arrays' as const), candidateArb)
      .map(([shape, leaf]) => [nestedToDepth(shape, leaf)]),
  },
);

// Feature: app-shell, Property 6: the parser is total and yields one outcome shape
// Validates: Requirements 10.1, 10.10, 10.12, 14.12
describe('parseNotificationList — totality and outcome shape (Property 6)', () => {
  it('yields exactly one stated outcome and raises nothing for any value of any type', () => {
    fc.assert(
      fc.property(anyBodyArb, (body) => {
        expectExactlyOneOutcome(parseNotificationList(body));
      }),
      { numRuns: 1000 },
    );
  });

  it('yields the parse-failure outcome exactly when the top-level value is not an array', () => {
    fc.assert(
      fc.property(anyBodyArb, (body) => {
        const outcome = parseNotificationList(body);

        expect(outcome.kind === 'parse-failure').toBe(expectsParseFailure(body));
      }),
      { numRuns: 1000 },
    );
  });

  it('raises nothing for a value nested to a hundred levels, at the top level or inside an array', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('objects' as const, 'arrays' as const),
        fieldValueArb,
        fc.boolean(),
        (shape, leaf, wrapInArray) => {
          const nested = nestedToDepth(shape, leaf);
          const body = wrapInArray ? [nested] : nested;

          expectExactlyOneOutcome(parseNotificationList(body));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('is deterministic: the same value always yields the same outcome', () => {
    fc.assert(
      fc.property(anyBodyArb, (body) => {
        expect(parseNotificationList(body)).toEqual(parseNotificationList(body));
      }),
      { numRuns: 300 },
    );
  });

  it('costs a hostile candidate only itself, leaving the surrounding records parsed', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...WIRE_KEYS), { minLength: 1, maxLength: 4 }),
        fc.integer({ min: 0, max: 4 }),
        (hostileProperties, validCount) => {
          const valid = Array.from({ length: validCount }, validWireRecord);
          const hostile = hostileProperties.map((property) =>
            withThrowingAccessor(property, validWireRecord()),
          );
          const outcome = parseNotificationList([...hostile, ...valid]);

          expectExactlyOneOutcome(outcome);
          expect(outcome.kind).toBe('parsed');

          if (outcome.kind === 'parsed') {
            expect(outcome.records).toHaveLength(validCount);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Parsing accepts exactly the valid candidates, in order, within
// the cap.
//
// Property 6 above claims the parser always answers with one of two shapes.
// This property claims *which* candidates it accepts, and is written as an
// exact characterisation: a candidate is accepted **if and only if** it supplies
// all seven properties of acceptance criterion 10.2 in their accepted forms.
//
// The expectation is built constructively rather than by re-deriving validity
// from the candidate: every generator emits a wire value **paired with the
// record it is owed** (or with `null` when the criteria owe it nothing), so no
// second copy of the parser is written here (design rule: a property test never
// declares its own copy of the logic under test). The catalogued type order and
// the length bounds are restated from Requirement 10 in the test's own words —
// those are the specification, not the implementation.
//
// The boundaries acceptance criteria 10.2 to 10.6 turn on are all reachable from
// these generators, and one of the properties below walks them one field at a
// time: titles of 0, 1, 200, and 201 characters; bodies of 0, 2000, and 2001
// characters; identities in lower, upper, and mixed case, and malformed ones;
// `createdAt` with no UTC designator; and negative, fractional, and
// string-encoded `type` and `readState` codes. Arrays of 0, 200, and 201
// elements pin the Notification_List_Cap.
// ---------------------------------------------------------------------------

/**
 * The eight catalogued kinds in the order acceptance criterion 10.5 names them —
 * member joined, promoted to admin, removed from squad, ownership transferred,
 * match drafted, match confirmed, teams rolled, result posted — restated here so
 * the expectation comes from the requirement rather than from the module.
 */
const CATALOGUED_ORDER = [
  'member-joined',
  'promoted-to-admin',
  'removed-from-squad',
  'ownership-transferred',
  'match-drafted',
  'match-confirmed',
  'teams-rolled',
  'result-posted',
] as const;

/** The inclusive length bounds acceptance criterion 10.2 places on the two texts. */
const TITLE_MIN = 1;
const TITLE_MAX = 200;
const BODY_MIN = 0;
const BODY_MAX = 2000;

/** Marks a property the candidate omits entirely, as against supplying `null`. */
const OMITTED = Symbol('omitted property');

/**
 * One wire value for one property, carried together with the value the criteria
 * owe the parsed record — or `null` when the criteria owe the whole candidate
 * nothing, because this property is outside its accepted form.
 */
interface FieldCase<T> {
  readonly wire: unknown;
  readonly accepted: T | null;
}

const accepts = <T,>(wire: unknown, accepted: T): FieldCase<T> => ({ wire, accepted });
const rejects = (wire: unknown): FieldCase<never> => ({ wire, accepted: null });

/** The seven field cases a candidate is assembled from. */
interface CandidateFieldCases {
  readonly notificationId: FieldCase<string>;
  readonly type: FieldCase<NotificationType>;
  readonly squadId: FieldCase<string>;
  readonly title: FieldCase<string>;
  readonly body: FieldCase<string>;
  readonly createdAt: FieldCase<number>;
  readonly readState: FieldCase<ReadState>;
}

/** A candidate carried together with the record it is owed, or `null`. */
interface CandidateCase {
  readonly wire: unknown;
  readonly accepted: NotificationRecord | null;
}

function assignField(
  wire: Record<string, unknown>,
  key: string,
  field: FieldCase<unknown>,
): void {
  if (field.wire !== OMITTED) {
    wire[key] = field.wire;
  }
}

/**
 * Assemble a candidate from its seven field cases. The candidate is owed a
 * record exactly when all seven properties are within their accepted forms
 * (10.2); a single property outside its form owes nothing (10.3).
 */
function assembleCandidate(
  cases: CandidateFieldCases,
  extras: Record<string, unknown> = {},
): CandidateCase {
  const wire: Record<string, unknown> = { ...extras };

  assignField(wire, 'notificationId', cases.notificationId);
  assignField(wire, 'type', cases.type);
  assignField(wire, 'squadId', cases.squadId);
  assignField(wire, 'title', cases.title);
  assignField(wire, 'body', cases.body);
  assignField(wire, 'createdAt', cases.createdAt);
  assignField(wire, 'readState', cases.readState);

  const notificationId = cases.notificationId.accepted;
  const type = cases.type.accepted;
  const squadId = cases.squadId.accepted;
  const title = cases.title.accepted;
  const body = cases.body.accepted;
  const createdAtMs = cases.createdAt.accepted;
  const readState = cases.readState.accepted;

  if (
    notificationId === null ||
    type === null ||
    squadId === null ||
    title === null ||
    body === null ||
    createdAtMs === null ||
    readState === null
  ) {
    return { wire, accepted: null };
  }

  return {
    wire,
    accepted: { notificationId, type, squadId, title, body, createdAtMs, readState },
  };
}

// --- identities (10.2): 8-4-4-4-12 hexadecimal digits, either letter case -----

const hexDigitArb = fc.constantFrom(...'0123456789abcdef'.split(''));
const hexRun = (length: number): fc.Arbitrary<string> =>
  fc.string({ unit: hexDigitArb, minLength: length, maxLength: length });

function mixCase(text: string): string {
  return text
    .split('')
    .map((character, index) => (index % 2 === 0 ? character.toUpperCase() : character))
    .join('');
}

const wellFormedIdentityArb: fc.Arbitrary<string> = fc
  .tuple(
    hexRun(8),
    hexRun(4),
    hexRun(4),
    hexRun(4),
    hexRun(12),
    fc.constantFrom('lower' as const, 'upper' as const, 'mixed' as const),
  )
  .map(([a, b, c, d, e, letterCase]) => {
    const identity = `${a}-${b}-${c}-${d}-${e}`;

    if (letterCase === 'upper') {
      return identity.toUpperCase();
    }

    return letterCase === 'mixed' ? mixCase(identity) : identity;
  });

const acceptedIdentityCaseArb: fc.Arbitrary<FieldCase<string>> = wellFormedIdentityArb.map(
  (identity) => accepts(identity, identity),
);

/** The accepted 36-character hyphenated form, in each of the three letter cases. */
const ACCEPTED_IDENTITY_CASES: readonly FieldCase<string>[] = [
  accepts(VALID_NOTIFICATION_ID, VALID_NOTIFICATION_ID), // lower case
  accepts(VALID_SQUAD_ID, VALID_SQUAD_ID), // upper case
  accepts(mixCase(VALID_NOTIFICATION_ID), mixCase(VALID_NOTIFICATION_ID)), // mixed case
];

const REJECTED_IDENTITY_CASES: readonly FieldCase<string>[] = [
  rejects(OMITTED),
  rejects(undefined),
  rejects(null),
  rejects(''),
  rejects('0195f1a2-3b4c-7d8e-9f01-23456789abc'), // 35 characters
  rejects('0195f1a2-3b4c-7d8e-9f01-23456789abcde'), // 37 characters
  rejects('0195f1a23b4c7d8e9f0123456789abcd'), // unhyphenated
  rejects('{0195f1a2-3b4c-7d8e-9f01-23456789abcd}'), // braced form
  rejects('0195f1a2-3b4c-7d8e-9f01-23456789abcg'), // non-hexadecimal digit
  rejects('0195f1a2_3b4c_7d8e_9f01_23456789abcd'), // wrong separators
  rejects('0195f1a2-3b4c-7d8e-9f01-23456789abc '), // 36 characters, trailing space
  rejects(' 0195f1a2-3b4c-7d8e-9f01-23456789abcd'),
  rejects('0195f1a2-3b4c-7d8e-9f0123456789abcd-'), // misplaced hyphen
  rejects(0),
  rejects(123),
  rejects(true),
  rejects({ value: VALID_NOTIFICATION_ID }),
  rejects([VALID_NOTIFICATION_ID]),
];

const identityCaseArb: fc.Arbitrary<FieldCase<string>> = fc.oneof(
  { weight: 6, arbitrary: acceptedIdentityCaseArb },
  { weight: 4, arbitrary: fc.constantFrom(...REJECTED_IDENTITY_CASES) },
);

// --- type (10.5, 10.6): catalogued 0..7, any other integer unrecognised ------

const CATALOGUED_TYPE_CASES: readonly FieldCase<NotificationType>[] = [
  ...CATALOGUED_ORDER.map((value, code) =>
    accepts<NotificationType>(code, { kind: 'catalogued', value }),
  ),
  // `-0` is the integer zero, so it is the first catalogued kind.
  accepts<NotificationType>(-0, { kind: 'catalogued', value: 'member-joined' }),
];

const UNRECOGNISED_TYPE_CASES: readonly FieldCase<NotificationType>[] = [
  8, 9, 42, 2_147_483_647, -1, -8, -2_147_483_648, Number.MAX_SAFE_INTEGER,
].map((code) => accepts<NotificationType>(code, { kind: 'unrecognised', code }));

const REJECTED_TYPE_CASES: readonly FieldCase<NotificationType>[] = [
  rejects(OMITTED),
  rejects(undefined),
  rejects(null),
  rejects(1.5), // fractional
  rejects(-0.5),
  rejects(0.1),
  rejects('3'), // string-encoded
  rejects('0'),
  rejects(''),
  rejects(Number.NaN),
  rejects(Number.POSITIVE_INFINITY),
  rejects(Number.NEGATIVE_INFINITY),
  rejects(true),
  rejects(BigInt(3)),
  rejects({ code: 3 }),
  rejects([3]),
];

const typeCaseArb: fc.Arbitrary<FieldCase<NotificationType>> = fc.oneof(
  { weight: 5, arbitrary: fc.constantFrom(...CATALOGUED_TYPE_CASES) },
  { weight: 3, arbitrary: fc.constantFrom(...UNRECOGNISED_TYPE_CASES) },
  {
    weight: 2,
    arbitrary: fc
      .integer({ min: -100_000, max: 100_000 })
      .map((code) =>
        code >= 0 && code < CATALOGUED_ORDER.length
          ? accepts<NotificationType>(code, {
              kind: 'catalogued',
              value: CATALOGUED_ORDER[code],
            })
          : accepts<NotificationType>(code, { kind: 'unrecognised', code }),
      ),
  },
  { weight: 3, arbitrary: fc.constantFrom(...REJECTED_TYPE_CASES) },
);

// --- readState (10.4): 0 is unread, 1 is read, nothing else ------------------

const READ_STATE_CASES: readonly FieldCase<ReadState>[] = [
  accepts<ReadState>(0, 'unread'),
  accepts<ReadState>(-0, 'unread'),
  accepts<ReadState>(1, 'read'),
  rejects(OMITTED),
  rejects(undefined),
  rejects(null),
  rejects(2),
  rejects(-1), // negative
  rejects(0.5), // fractional
  rejects(1.5),
  rejects('0'), // string-encoded
  rejects('1'),
  rejects('unread'),
  rejects(true),
  rejects(false),
  rejects(Number.NaN),
  rejects(Number.POSITIVE_INFINITY),
  rejects(BigInt(0)),
  rejects([0]),
  rejects({}),
];

const readStateCaseArb: fc.Arbitrary<FieldCase<ReadState>> = fc.constantFrom(
  ...READ_STATE_CASES,
);

// --- title and body (10.2): bounded strings, retained untruncated ------------

const boundedTextCase = (
  text: string,
  minLength: number,
  maxLength: number,
): FieldCase<string> =>
  text.length >= minLength && text.length <= maxLength ? accepts(text, text) : rejects(text);

const REJECTED_TEXT_SHAPES: readonly FieldCase<string>[] = [
  rejects(OMITTED),
  rejects(undefined),
  rejects(null),
  rejects(42),
  rejects(true),
  rejects(['a']),
  rejects({ text: 'a' }),
];

const TITLE_BOUNDARY_CASES: readonly FieldCase<string>[] = [
  rejects(''), // 0 characters
  accepts('a', 'a'), // 1 character
  boundedTextCase('t'.repeat(TITLE_MAX - 1), TITLE_MIN, TITLE_MAX), // 199
  boundedTextCase('t'.repeat(TITLE_MAX), TITLE_MIN, TITLE_MAX), // 200
  rejects('t'.repeat(TITLE_MAX + 1)), // 201
  rejects('t'.repeat(TITLE_MAX + 200)),
  accepts(' ', ' '), // blank but present: a display concern, not a parse one
  accepts('\u{1f3c6}', '\u{1f3c6}'),
];

const BODY_BOUNDARY_CASES: readonly FieldCase<string>[] = [
  accepts('', ''), // 0 characters
  accepts('b', 'b'),
  boundedTextCase('b'.repeat(BODY_MAX - 1), BODY_MIN, BODY_MAX), // 1999
  boundedTextCase('b'.repeat(BODY_MAX), BODY_MIN, BODY_MAX), // 2000
  rejects('b'.repeat(BODY_MAX + 1)), // 2001
  rejects('b'.repeat(BODY_MAX + 500)),
];

const titleCaseArb: fc.Arbitrary<FieldCase<string>> = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(...TITLE_BOUNDARY_CASES) },
  {
    weight: 4,
    arbitrary: fc
      .string({ minLength: 0, maxLength: TITLE_MAX + 5 })
      .map((text) => boundedTextCase(text, TITLE_MIN, TITLE_MAX)),
  },
  {
    weight: 2,
    arbitrary: fc
      .string({ unit: 'grapheme', minLength: 0, maxLength: TITLE_MAX + 5 })
      .map((text) => boundedTextCase(text, TITLE_MIN, TITLE_MAX)),
  },
  { weight: 2, arbitrary: fc.constantFrom(...REJECTED_TEXT_SHAPES) },
);

const bodyCaseArb: fc.Arbitrary<FieldCase<string>> = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(...BODY_BOUNDARY_CASES) },
  {
    weight: 4,
    arbitrary: fc
      .string({ minLength: 0, maxLength: 240 })
      .map((text) => boundedTextCase(text, BODY_MIN, BODY_MAX)),
  },
  {
    weight: 2,
    arbitrary: fc
      .string({ unit: 'grapheme', minLength: BODY_MAX - 4, maxLength: BODY_MAX + 4 })
      .map((text) => boundedTextCase(text, BODY_MIN, BODY_MAX)),
  },
  { weight: 2, arbitrary: fc.constantFrom(...REJECTED_TEXT_SHAPES) },
);

// --- createdAt (10.2): ISO 8601 with an explicit designator or offset --------

/** Designator text paired with its offset in whole minutes east of UTC. */
const UTC_DESIGNATORS: readonly (readonly [string, number])[] = [
  ['Z', 0],
  ['z', 0],
  ['+00:00', 0],
  ['-00:00', 0],
  ['+01:00', 60],
  ['-05:30', -330],
  ['+0530', 330],
  ['-0930', -570],
  ['+14', 840],
  ['-12', -720],
  ['+23:59', 1439],
];

/** A range wide enough to be interesting and narrow enough to keep 4-digit years. */
const MIN_WIRE_INSTANT_MS = Date.UTC(1000, 0, 2);
const MAX_WIRE_INSTANT_MS = Date.UTC(9998, 11, 30, 23, 59, 59, 999);

/**
 * Render an instant as the wire form for a given designator, by shifting to the
 * designator's local time and appending it. Built from the runtime's own ISO
 * printer, so the expected instant is known without consulting the parser.
 */
function isoWithDesignator(
  instantMs: number,
  designator: string,
  offsetMinutes: number,
): string {
  const local = new Date(instantMs + offsetMinutes * 60_000).toISOString();

  return `${local.slice(0, -1)}${designator}`;
}

const ACCEPTED_CREATED_AT_CASES: readonly FieldCase<number>[] = [
  accepts('2026-03-01T18:30:00Z', Date.UTC(2026, 2, 1, 18, 30, 0)),
  accepts('2026-03-01t18:30:00z', Date.UTC(2026, 2, 1, 18, 30, 0)),
  accepts('2026-03-01T18:30Z', Date.UTC(2026, 2, 1, 18, 30, 0)), // seconds optional
  accepts('2026-03-01T18:30:00+01:00', Date.UTC(2026, 2, 1, 17, 30, 0)),
  accepts('2026-03-01T18:30:00-05:30', Date.UTC(2026, 2, 2, 0, 0, 0)),
  accepts('2026-03-01T18:30:00.125Z', Date.UTC(2026, 2, 1, 18, 30, 0, 125)),
  accepts('2026-03-01T18:30:00,125Z', Date.UTC(2026, 2, 1, 18, 30, 0, 125)),
  accepts('2024-02-29T00:00:00Z', Date.UTC(2024, 1, 29)), // a leap day
  accepts('1970-01-01T00:00:00Z', 0),
];

const REJECTED_CREATED_AT_CASES: readonly FieldCase<number>[] = [
  rejects(OMITTED),
  rejects(undefined),
  rejects(null),
  rejects('2026-03-01T18:30:00'), // no UTC designator and no offset
  rejects('2026-03-01T18:30:00.123'), // no designator, fractional seconds
  rejects('2026-03-01T18:30'), // no designator
  rejects('2026-03-01'), // date only
  rejects('2026-03-01T18:30:00ZZ'),
  rejects('2026-13-01T00:00:00Z'), // month out of range
  rejects('2026-02-30T00:00:00Z'), // day out of range
  rejects('2026-02-29T00:00:00Z'), // 2026 is not a leap year
  rejects('2026-03-01T24:00:00Z'), // hour out of range
  rejects('2026-03-01T18:60:00Z'), // minute out of range
  rejects('2026-03-01T18:30:00+24:00'), // offset hour out of range
  rejects(' 2026-03-01T18:30:00Z'),
  rejects('not-a-date'),
  rejects(''),
  rejects(1_772_390_000_000), // an instant, but not a wire string
  rejects(new Date('2026-03-01T18:30:00Z')),
  rejects(true),
  rejects(['2026-03-01T18:30:00Z']),
];

const acceptedCreatedAtCaseArb: fc.Arbitrary<FieldCase<number>> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc
      .tuple(
        fc.integer({ min: MIN_WIRE_INSTANT_MS, max: MAX_WIRE_INSTANT_MS }),
        fc.constantFrom(...UTC_DESIGNATORS),
      )
      .map(([instantMs, [designator, offsetMinutes]]) =>
        accepts(isoWithDesignator(instantMs, designator, offsetMinutes), instantMs),
      ),
  },
  { weight: 3, arbitrary: fc.constantFrom(...ACCEPTED_CREATED_AT_CASES) },
);

const createdAtCaseArb: fc.Arbitrary<FieldCase<number>> = fc.oneof(
  { weight: 6, arbitrary: acceptedCreatedAtCaseArb },
  { weight: 4, arbitrary: fc.constantFrom(...REJECTED_CREATED_AT_CASES) },
);

// --- candidates and lists ----------------------------------------------------

/** Properties beyond the seven, which the parser ignores rather than rejects. */
const extrasArb: fc.Arbitrary<Record<string, unknown>> = fc.constantFrom<
  Record<string, unknown>
>(
  {},
  {},
  { readAt: '2026-03-01T19:00:00Z' },
  { extra: 1, nested: { deep: true } },
  { titleText: 'x', typeCode: 4 },
);

const acceptedFieldCasesArb: fc.Arbitrary<CandidateFieldCases> = fc.record({
  notificationId: acceptedIdentityCaseArb,
  type: fc.oneof(
    fc.constantFrom(...CATALOGUED_TYPE_CASES),
    fc.constantFrom(...UNRECOGNISED_TYPE_CASES),
  ),
  squadId: acceptedIdentityCaseArb,
  title: fc.oneof(
    fc.constantFrom(...TITLE_BOUNDARY_CASES.filter((entry) => entry.accepted !== null)),
    fc.string({ minLength: TITLE_MIN, maxLength: 60 }).map((text) => accepts(text, text)),
  ),
  body: fc.oneof(
    fc.constantFrom(...BODY_BOUNDARY_CASES.filter((entry) => entry.accepted !== null)),
    fc.string({ minLength: BODY_MIN, maxLength: 60 }).map((text) => accepts(text, text)),
  ),
  createdAt: acceptedCreatedAtCaseArb,
  readState: fc.constantFrom(
    ...READ_STATE_CASES.filter((entry) => entry.accepted !== null),
  ),
});

const mixedFieldCasesArb: fc.Arbitrary<CandidateFieldCases> = fc.record({
  notificationId: identityCaseArb,
  type: typeCaseArb,
  squadId: identityCaseArb,
  title: titleCaseArb,
  body: bodyCaseArb,
  createdAt: createdAtCaseArb,
  readState: readStateCaseArb,
});

/** Candidate shapes that are not a record of properties at all (10.3). */
const REJECTED_CANDIDATE_SHAPES: readonly unknown[] = [
  null,
  undefined,
  0,
  -1,
  Number.NaN,
  '',
  'notification',
  true,
  false,
  BigInt(7),
  [],
  [validWireRecord()],
  {},
  Object.create(null) as unknown,
  new Date('2026-03-01T18:30:00Z'),
  new Map([['notificationId', VALID_NOTIFICATION_ID]]),
  new Set([VALID_NOTIFICATION_ID]),
  () => validWireRecord(),
  nestedToDepth('objects', validWireRecord()),
  nestedToDepth('arrays', validWireRecord()),
];

const candidateCaseArb: fc.Arbitrary<CandidateCase> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc
      .tuple(acceptedFieldCasesArb, extrasArb)
      .map(([cases, extras]) => assembleCandidate(cases, extras)),
  },
  {
    weight: 5,
    arbitrary: fc
      .tuple(mixedFieldCasesArb, extrasArb)
      .map(([cases, extras]) => assembleCandidate(cases, extras)),
  },
  {
    weight: 2,
    arbitrary: fc
      .constantFrom(...REJECTED_CANDIDATE_SHAPES)
      .map((wire) => ({ wire, accepted: null })),
  },
  {
    weight: 1,
    arbitrary: fc
      .constantFrom(...WIRE_KEYS)
      .map((property) => ({
        wire: withThrowingAccessor(property, validWireRecord()),
        accepted: null,
      })),
  },
);

/** One candidate per field, five of the seven left in their accepted form. */
const singleFieldCandidateArb: fc.Arbitrary<CandidateCase> = fc
  .tuple(acceptedFieldCasesArb, fc.nat({ max: 6 }))
  .chain(([defaults, fieldIndex]) => {
    const overrides: readonly fc.Arbitrary<CandidateFieldCases>[] = [
      identityCaseArb.map((notificationId) => ({ ...defaults, notificationId })),
      identityCaseArb.map((squadId) => ({ ...defaults, squadId })),
      typeCaseArb.map((type) => ({ ...defaults, type })),
      titleCaseArb.map((title) => ({ ...defaults, title })),
      bodyCaseArb.map((body) => ({ ...defaults, body })),
      createdAtCaseArb.map((createdAt) => ({ ...defaults, createdAt })),
      readStateCaseArb.map((readState) => ({ ...defaults, readState })),
    ];

    return overrides[fieldIndex].map((cases) => assembleCandidate(cases));
  });

/**
 * A cheap valid candidate whose identity and title carry its supplied position,
 * so relative order is visible in the parsed records. Built from the shared
 * `validWireRecord` helper: its `type` of 4 is the fifth catalogued kind and its
 * `readState` of 0 is `unread`.
 */
function indexedCandidate(index: number): CandidateCase {
  const base = validWireRecord();
  const notificationId = `0195f1a2-3b4c-7d8e-9f01-${index.toString(16).padStart(12, '0')}`;
  const title = `Notification ${index}`;

  return {
    wire: { ...base, notificationId, title },
    accepted: {
      notificationId,
      type: { kind: 'catalogued', value: 'match-drafted' },
      squadId: base.squadId as string,
      title,
      body: base.body as string,
      createdAtMs: Date.UTC(2026, 2, 1, 18, 30, 0),
      readState: 'unread',
    },
  };
}

/** An invalid candidate at a known position: a well-formed row with a blank title. */
function indexedInvalidCandidate(index: number): CandidateCase {
  const { wire } = indexedCandidate(index);

  return { wire: { ...(wire as Record<string, unknown>), title: '' }, accepted: null };
}

/** The records an array of candidate cases is owed: the accepted ones of the first 200. */
function expectedRecords(cases: readonly CandidateCase[]): NotificationRecord[] {
  return cases
    .slice(0, NOTIFICATION_LIST_PARSE_CAP)
    .map((entry) => entry.accepted)
    .filter((record): record is NotificationRecord => record !== null);
}

/**
 * One candidate per enumerated boundary of every property, five of the other six
 * properties left in an accepted form, gathered into a single response.
 *
 * Drawing boundaries at random leaves coverage to chance; this builds them all,
 * so every run compares every boundary acceptance criteria 10.2 to 10.6 turn on:
 * identities in three letter cases and thirteen malformed forms, titles at 0, 1,
 * 199, 200, and 201 characters, bodies at 0, 1999, 2000, and 2001, `createdAt`
 * with and without a UTC designator, and `type` and `readState` codes that are
 * negative, fractional, and string-encoded. The total stays under the
 * Notification_List_Cap so the cap plays no part here.
 */
function everyBoundaryCandidate(defaults: CandidateFieldCases): CandidateCase[] {
  const cases: CandidateCase[] = [];
  const push = (override: Partial<CandidateFieldCases>): void => {
    cases.push(assembleCandidate({ ...defaults, ...override }));
  };

  [...ACCEPTED_IDENTITY_CASES, ...REJECTED_IDENTITY_CASES].forEach((entry) => {
    push({ notificationId: entry });
    push({ squadId: entry });
  });
  [...CATALOGUED_TYPE_CASES, ...UNRECOGNISED_TYPE_CASES, ...REJECTED_TYPE_CASES].forEach(
    (entry) => push({ type: entry }),
  );
  TITLE_BOUNDARY_CASES.forEach((entry) => push({ title: entry }));
  BODY_BOUNDARY_CASES.forEach((entry) => push({ body: entry }));
  [...ACCEPTED_CREATED_AT_CASES, ...REJECTED_CREATED_AT_CASES].forEach((entry) =>
    push({ createdAt: entry }),
  );
  READ_STATE_CASES.forEach((entry) => push({ readState: entry }));

  return cases;
}

/** Assert the parser accepted exactly the owed records, in the supplied order. */
function expectAcceptsExactly(cases: readonly CandidateCase[]): void {
  const outcome = parseNotificationList(cases.map((entry) => entry.wire));

  // 10.3, 10.11: an array is never a parse-failure, however much it discards.
  expect(outcome.kind).toBe('parsed');

  if (outcome.kind === 'parsed') {
    expect(outcome.records).toEqual(expectedRecords(cases));
  }
}

// Feature: app-shell, Property 7: parsing accepts exactly the valid candidates, in order, within the cap
// Validates: Requirements 10.2, 10.3, 10.4, 10.5, 10.6, 10.11
describe('parseNotificationList — candidate acceptance (Property 7)', () => {
  it('accepts exactly the candidates supplying all seven properties in their accepted forms, and no others', () => {
    fc.assert(
      fc.property(
        fc.array(candidateCaseArb, { minLength: 0, maxLength: 24 }),
        expectAcceptsExactly,
      ),
      { numRuns: 400 },
    );
  });

  it('decides acceptance on each property in turn, at every boundary of its accepted form', () => {
    fc.assert(
      fc.property(
        fc.array(singleFieldCandidateArb, { minLength: 1, maxLength: 8 }),
        expectAcceptsExactly,
      ),
      { numRuns: 400 },
    );
  });

  it('decides every enumerated boundary of every property within one response', () => {
    fc.assert(
      fc.property(acceptedFieldCasesArb, (defaults) => {
        const cases = everyBoundaryCandidate(defaults);

        // The claim would be vacuous if the boundaries all fell the same way.
        expect(cases.some((entry) => entry.accepted !== null)).toBe(true);
        expect(cases.some((entry) => entry.accepted === null)).toBe(true);
        expect(cases.length).toBeLessThanOrEqual(NOTIFICATION_LIST_PARSE_CAP);

        expectAcceptsExactly(cases);
      }),
      { numRuns: 200 },
    );
  });

  it('retains the supplied relative order of the accepted candidates, whatever it discards between them', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 0, maxLength: 30 }), (validity) => {
        const cases = validity.map((valid, index) =>
          valid ? indexedCandidate(index) : indexedInvalidCandidate(index),
        );
        const outcome = parseNotificationList(cases.map((entry) => entry.wire));

        expect(outcome.kind).toBe('parsed');

        if (outcome.kind === 'parsed') {
          expect(outcome.records.map((record) => record.title)).toEqual(
            validity
              .map((valid, index) => (valid ? `Notification ${index}` : null))
              .filter((title): title is string => title !== null),
          );
        }
      }),
      { numRuns: 300 },
    );
  });

  it('considers only the first 200 elements, and still yields a parsed outcome for a longer array', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(0, 1, 199, NOTIFICATION_LIST_PARSE_CAP, 201, 260),
        fc.array(fc.boolean(), { minLength: 260, maxLength: 260 }),
        (length, validity) => {
          const cases = Array.from({ length }, (_unused, index) =>
            validity[index] ? indexedCandidate(index) : indexedInvalidCandidate(index),
          );
          const outcome = parseNotificationList(cases.map((entry) => entry.wire));

          expect(outcome.kind).toBe('parsed');

          if (outcome.kind === 'parsed') {
            expect(outcome.records.length).toBeLessThanOrEqual(
              NOTIFICATION_LIST_PARSE_CAP,
            );
            expect(outcome.records).toEqual(expectedRecords(cases));
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('retains title and body untruncated at their supplied lengths, up to 200 and 2000 characters', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: TITLE_MIN, max: TITLE_MAX }),
        fc.integer({ min: BODY_MIN, max: BODY_MAX }),
        (titleLength, bodyLength) => {
          const title = 't'.repeat(titleLength);
          const body = 'b'.repeat(bodyLength);
          const outcome = parseNotificationList([
            { ...validWireRecord(), title, body },
          ]);

          expect(outcome.kind).toBe('parsed');

          if (outcome.kind === 'parsed') {
            expect(outcome.records).toHaveLength(1);
            expect(outcome.records[0].title).toBe(title);
            expect(outcome.records[0].body).toBe(body);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: Printing then parsing a record is the identity.
//
// Properties 6 and 7 above look inward from the wire. This one looks outward
// from the record model: for **any** Notification_Record, printing it and
// parsing that printed output yields exactly one Notification_Record equal to
// the original in all seven values acceptance criterion 10.8 names — identity,
// Notification_Type together with the code retained by an unrecognised marker,
// squad identity, title character-for-character, body character-for-character,
// creation instant as the same instant on the time line, and Read_State — and
// the printed output itself carries exactly the seven wire properties of 10.7,
// with `createdAt` bearing an explicit UTC designator and the two texts
// untruncated.
//
// Two notes bounding what "any record" means here, both taken from the module's
// own stated contract rather than invented for the test:
//
//  - The round trip is on **instants**, not on wire strings. `createdAt` is
//    printed with an explicit `Z` designator whatever designator or offset it
//    arrived with, and a fractional part finer than a millisecond truncates on
//    the way in, so `print ∘ parse` on a wire string is not the identity and is
//    not claimed. `parse ∘ print` on a record is, and is what 10.8 asks for.
//  - An unrecognised type marker only ever retains a code **outside** the
//    catalogued range 0 to 7 — that is the only kind of marker the parser
//    produces, because a code inside the range is a catalogued kind (10.5,
//    10.6). The generator is constrained to that input space accordingly; a
//    hand-built marker retaining code 3 is not a Notification_Record the model
//    admits, and the printer's own doc comment says a value that is not a
//    Notification_Record prints something the parser rejects rather than
//    round-tripping.
//
// Boundaries are enumerated rather than left to chance: an unrecognised code at
// each end of the 32-bit and safe-integer ranges, an empty body, a title and a
// body at their maxima of 200 and 2000 characters, identities in all three
// letter cases, both Read_States, and instants at the epoch and at both ends of
// the representable range (which print with an expanded signed year).
// ---------------------------------------------------------------------------

/** The largest absolute instant a JavaScript date value can represent. */
const MAX_INSTANT_MS = 8_640_000_000_000_000;

/**
 * An integer code no catalogued kind claims, so a Notification_Type carrying it
 * is an unrecognised marker (10.6). Both ends of the signed 32-bit range and of
 * the safe-integer range are included explicitly.
 */
const unrecognisedCodeArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.constantFrom(
      8,
      9,
      42,
      -1,
      -8,
      2_147_483_647,
      -2_147_483_648,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
    ),
  },
  {
    weight: 6,
    arbitrary: fc
      .integer({ min: -1_000_000, max: 1_000_000 })
      .filter((code) => code < 0 || code >= CATALOGUED_ORDER.length),
  },
);

const notificationTypeArb: fc.Arbitrary<NotificationType> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc
      .constantFrom(...CATALOGUED_ORDER)
      .map((value): NotificationType => ({ kind: 'catalogued', value })),
  },
  {
    weight: 5,
    arbitrary: unrecognisedCodeArb.map(
      (code): NotificationType => ({ kind: 'unrecognised', code }),
    ),
  },
);

/** The instant at midnight on 1 January of a year, however few digits it has. */
function instantAtYear(year: number): number {
  const date = new Date(0);

  date.setUTCFullYear(year, 0, 1);

  return date.getTime();
}

/**
 * Instants across the whole representable range, including the two ends — which
 * print with the expanded signed six-digit year — the epoch, and years below
 * 1000, which print zero-padded to four digits.
 */
const roundTripInstantArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.integer({ min: MIN_WIRE_INSTANT_MS, max: MAX_WIRE_INSTANT_MS }),
  },
  { weight: 3, arbitrary: fc.integer({ min: -MAX_INSTANT_MS, max: MAX_INSTANT_MS }) },
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      0,
      1,
      -1,
      MAX_INSTANT_MS,
      -MAX_INSTANT_MS,
      MAX_INSTANT_MS - 1,
      -MAX_INSTANT_MS + 1,
      Date.UTC(2026, 2, 1, 18, 30, 0, 999),
      instantAtYear(1),
      instantAtYear(50),
      instantAtYear(999),
      instantAtYear(1000),
    ),
  },
);

/** A title within the 1 to 200 characters criterion 10.2 accepts, at its maxima. */
const roundTripTitleArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: fc.string({ minLength: TITLE_MIN, maxLength: 60 }) },
  {
    weight: 2,
    arbitrary: fc
      .string({ unit: 'grapheme', minLength: TITLE_MIN, maxLength: 20 })
      .filter((text) => text.length >= TITLE_MIN && text.length <= TITLE_MAX),
  },
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      'a',
      ' ',
      '  \t ',
      '\u{1f3c6} Match drafted',
      't'.repeat(TITLE_MAX - 1),
      't'.repeat(TITLE_MAX),
    ),
  },
);

/** A body within the 0 to 2000 characters criterion 10.2 accepts, empty included. */
const roundTripBodyArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: fc.string({ minLength: BODY_MIN, maxLength: 80 }) },
  {
    weight: 2,
    arbitrary: fc
      .string({ unit: 'grapheme', minLength: BODY_MIN, maxLength: 30 })
      .filter((text) => text.length <= BODY_MAX),
  },
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      '',
      ' ',
      'Tell the squad which days you can make.',
      'b'.repeat(BODY_MAX - 1),
      'b'.repeat(BODY_MAX),
    ),
  },
);

/** Any well-formed Notification_Record, built directly in the record model. */
const wellFormedRecordArb: fc.Arbitrary<NotificationRecord> = fc.record({
  notificationId: wellFormedIdentityArb,
  type: notificationTypeArb,
  squadId: wellFormedIdentityArb,
  title: roundTripTitleArb,
  body: roundTripBodyArb,
  createdAtMs: roundTripInstantArb,
  readState: fc.constantFrom<ReadState>('unread', 'read'),
});

/**
 * A record as the parser itself produces one, drawn from Property 7's accepted
 * field cases, so the round trip is claimed over the records that actually reach
 * the shell as well as over hand-built ones.
 */
const parsedRecordArb: fc.Arbitrary<NotificationRecord> = fc
  .tuple(acceptedFieldCasesArb, extrasArb)
  .map(([cases, extras]) => assembleCandidate(cases, extras).accepted)
  .filter((record): record is NotificationRecord => record !== null);

const roundTripRecordArb: fc.Arbitrary<NotificationRecord> = fc.oneof(
  { weight: 6, arbitrary: wellFormedRecordArb },
  { weight: 4, arbitrary: parsedRecordArb },
);

/**
 * The wire `type` code acceptance criterion 10.7 owes a Notification_Type: the
 * catalogued position in the order criterion 10.5 names, restated in this file,
 * or the code the unrecognised marker retains.
 */
function owedTypeCode(type: NotificationType): number {
  return type.kind === 'catalogued' ? CATALOGUED_ORDER.indexOf(type.value) : type.code;
}

/** The printed output as a property bag, asserting it is one at all. */
function printedWire(record: NotificationRecord): Record<string, unknown> {
  const printed = printNotificationRecord(record);

  expect(typeof printed).toBe('object');
  expect(printed).not.toBeNull();
  expect(Array.isArray(printed)).toBe(false);

  return printed as Record<string, unknown>;
}

/**
 * Assert that parsing the record's printed output yields a parsed outcome
 * carrying exactly one record equal to the original (10.8), and hand that
 * record back.
 */
function expectRoundTrips(record: NotificationRecord): NotificationRecord {
  const outcome = parseNotificationList([printNotificationRecord(record)]);

  expect(outcome.kind).toBe('parsed');

  const records = outcome.kind === 'parsed' ? outcome.records : [];

  expect(records).toHaveLength(1);
  expect(records[0]).toEqual(record);

  return records[0];
}

/**
 * The enumerated boundaries of the record model, each applied to an otherwise
 * arbitrary record so every run walks all of them rather than sampling them.
 */
const BOUNDARY_OVERRIDES: readonly Partial<NotificationRecord>[] = [
  { body: '' }, // an empty body (10.2)
  { body: 'b'.repeat(BODY_MAX) }, // the body maximum
  { title: 'a' }, // the title minimum
  { title: 't'.repeat(TITLE_MAX) }, // the title maximum
  { title: 't'.repeat(TITLE_MAX), body: 'b'.repeat(BODY_MAX) },
  { title: ' ' }, // blank but present: a display concern, not a parse one
  { title: '\u{1f3c6}', body: '\u{1f3c6}\u{1f3c6}' },
  { readState: 'unread' },
  { readState: 'read' },
  { createdAtMs: 0 }, // the epoch
  { createdAtMs: -1 },
  { createdAtMs: MAX_INSTANT_MS }, // prints with an expanded signed year
  { createdAtMs: -MAX_INSTANT_MS },
  { createdAtMs: Date.UTC(2026, 2, 1, 18, 30, 0, 125) }, // millisecond precision
  { notificationId: VALID_NOTIFICATION_ID }, // lower case
  { squadId: VALID_SQUAD_ID }, // upper case
  { notificationId: mixCase(VALID_NOTIFICATION_ID) }, // mixed case
  ...CATALOGUED_ORDER.map(
    (value): Partial<NotificationRecord> => ({ type: { kind: 'catalogued', value } }),
  ),
  ...[8, 9, -1, 2_147_483_647, -2_147_483_648, Number.MAX_SAFE_INTEGER].map(
    (code): Partial<NotificationRecord> => ({ type: { kind: 'unrecognised', code } }),
  ),
];

// Feature: app-shell, Property 8: Printing then parsing a record is the identity
// Validates: Requirements 10.7, 10.8, 14.13
describe('printNotificationRecord then parseNotificationList — round trip (Property 8)', () => {
  it('yields exactly one record equal to the original for any well-formed record', () => {
    fc.assert(
      fc.property(roundTripRecordArb, (record) => {
        expectRoundTrips(record);
      }),
      { numRuns: 500 },
    );
  });

  it('preserves the integer code retained by an unrecognised type marker, unchanged', () => {
    fc.assert(
      fc.property(wellFormedRecordArb, unrecognisedCodeArb, (base, code) => {
        const record: NotificationRecord = { ...base, type: { kind: 'unrecognised', code } };

        expect(printedWire(record).type).toBe(code);
        expect(expectRoundTrips(record).type).toEqual({ kind: 'unrecognised', code });
      }),
      { numRuns: 300 },
    );
  });

  it('maps every catalogued kind back to itself through its catalogued integer code', () => {
    fc.assert(
      fc.property(wellFormedRecordArb, fc.nat({ max: 7 }), (base, code) => {
        const value = CATALOGUED_ORDER[code];
        const record: NotificationRecord = { ...base, type: { kind: 'catalogued', value } };

        expect(printedWire(record).type).toBe(code);
        expect(expectRoundTrips(record).type).toEqual({ kind: 'catalogued', value });
      }),
      { numRuns: 200 },
    );
  });

  it('prints exactly the seven wire properties, with an explicit UTC designator and both texts untruncated', () => {
    fc.assert(
      fc.property(roundTripRecordArb, (record) => {
        const wire = printedWire(record);

        // 10.7: exactly the seven properties acceptance criterion 10.2 names.
        expect(Object.keys(wire).sort()).toEqual([...WIRE_KEYS].sort());

        expect(wire.notificationId).toBe(record.notificationId);
        expect(wire.squadId).toBe(record.squadId);
        expect(wire.type).toBe(owedTypeCode(record.type));
        expect(wire.readState).toBe(record.readState === 'read' ? 1 : 0);

        // 10.7: untruncated, character for character and length for length.
        expect(wire.title).toBe(record.title);
        expect(wire.body).toBe(record.body);
        expect((wire.title as string).length).toBe(record.title.length);
        expect((wire.body as string).length).toBe(record.body.length);

        // 10.7: an explicit UTC designator, which is why 10.8 is on instants.
        expect(typeof wire.createdAt).toBe('string');
        expect((wire.createdAt as string).endsWith('Z')).toBe(true);
        expect(new Date(wire.createdAt as string).getTime()).toBe(record.createdAtMs);
      }),
      { numRuns: 400 },
    );
  });

  it('round-trips every enumerated boundary of the record model within one run', () => {
    fc.assert(
      fc.property(wellFormedRecordArb, (base) => {
        BOUNDARY_OVERRIDES.forEach((override) => {
          expectRoundTrips({ ...base, ...override });
        });
      }),
      { numRuns: 200 },
    );
  });

  it('is stable under a second round trip: the parsed record prints the same wire form', () => {
    fc.assert(
      fc.property(roundTripRecordArb, (record) => {
        const parsed = expectRoundTrips(record);

        expect(printNotificationRecord(parsed)).toEqual(printNotificationRecord(record));
        expect(expectRoundTrips(parsed)).toEqual(record);
      }),
      { numRuns: 300 },
    );
  });
});
