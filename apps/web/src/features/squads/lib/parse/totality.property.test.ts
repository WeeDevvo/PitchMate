import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  INVITE_STATE_NAMES,
  MEMBERSHIP_STATE_NAMES,
  RATING_STATE_NAMES,
  REDEEM_OUTCOME_NAMES,
  SQUAD_FEATURE_NAMES,
  SQUAD_ROLE_NAMES,
} from '../wireEnums';
import * as createdGuestModule from './createdGuest';
import * as createdSquadModule from './createdSquad';
import * as featureFlagsModule from './featureFlags';
import * as generatedInviteModule from './generatedInvite';
import * as invitePreviewModule from './invitePreview';
import * as inviteSummaryModule from './inviteSummary';
import * as leaderboardModule from './leaderboard';
import type { ParseResult } from './primitives';
import * as redemptionModule from './redemption';
import * as squadDetailModule from './squadDetail';
import * as squadSummaryModule from './squadSummary';

/**
 * Property test for the one claim every Response_Parser in this directory owes
 * jointly, placed beside the modules it covers as the design's Testing Strategy
 * asks and running well above the 100-iteration floor.
 *
 * This file carries **Property 22: Response parsers are total** — for any input
 * value a response parser can be handed, including a structurally hostile one,
 * the parser returns a parse result and raises nothing (12.5, 12.6).
 *
 * ## Why this file exists when every module already has its own property test
 *
 * Each of the ten parse modules carries a property test that asserts totality for
 * **its own** shape, over generators written around that shape's fields — a
 * mistyped `squadId`, a `role` naming no member, a `members` element that is not
 * an object. Those stay, and they are where a shape-specific misread is caught;
 * nothing here replaces them, because nothing here knows which of a shape's
 * fields are required, which absences are valid, or what a fully populated value
 * of that shape looks like.
 *
 * What this file adds is the **cross-parser** statement: one property quantified
 * over *every* exported parser at once, so the guarantee is a property of the
 * directory rather than a coincidence of ten files that each happen to assert it.
 * Two things follow from that which a per-module test cannot give:
 *
 *  - **A parser added later is covered without this file being edited.** The
 *    quantifier runs over a *discovered* set — the `parse`-prefixed exports of
 *    the ten modules, read from the module namespaces below — in the same idiom
 *    the backend guards use for discovered endpoints and enum members. An
 *    eleventh parser, or a second parser added to an existing module, enters the
 *    quantifier the moment it is exported. Per the design's note on
 *    quantification, a discovered set earns a **non-vacuity floor**, which the
 *    last `describe` in this file supplies: the discovery must find at least the
 *    fifteen parsers named there, so a discovery regression fails rather than
 *    passing empty.
 *  - **The hostile input space is written once and applied uniformly.** `null`
 *    and `undefined`, every primitive type including `BigInt` and `Symbol`,
 *    `NaN` and both infinities, boxed primitives, null-prototype objects,
 *    `Map`/`Set`/`Date`/function values, arrays where an object is expected and
 *    objects where an array is expected, values nested a hundred levels deep,
 *    self-referencing objects and cyclic arrays, and objects whose *recognised*
 *    property names are accessors that throw. A generator category added here
 *    reaches all fifteen parsers at once, where adding it to one module's test
 *    reaches one.
 *
 * ## What is asserted, and what deliberately is not
 *
 * The assertions are **structural and frame-level only**, in the idiom of
 * {@link settle} in the per-module tests: no exception escapes, the outcome's own
 * key set is exactly `ok,value` or exactly `ok,reason` and agrees with the `ok`
 * flag, a failure carries a non-empty diagnostic `reason`, a success carries an
 * object value with no `undefined` anywhere inside it, and the same input settles
 * the same way twice.
 *
 * It is **not** asserted here whether a given body ought to parse or fail. That
 * judgement belongs to the parser's own module test, which knows the shape; a
 * cross-parser file that guessed at it would either be wrong for some parser
 * (every field of a `Redemption` is optional, so a body of throwing accessors
 * legitimately *succeeds* there and legitimately *fails* for a `Created_Squad`)
 * or would have to re-encode all ten shapes and stop being a cross-parser
 * statement. Totality is exactly the claim that is uniform across the set, so
 * totality is exactly what is quantified over the set.
 *
 * React-free, DOM-free, and reads no clock or storage: the subject is pure, and
 * the determinism assertion below is what holds it to that.
 *
 * Requirements: 12.5, 12.6
 */

/* -------------------------------------------------------------------------- */
/* The parser table                                                           */
/* -------------------------------------------------------------------------- */

/** Every parser in this directory takes one unvalidated body and returns a result. */
type BodyParser = (body: unknown) => ParseResult<unknown>;

/** One discovered parser, carrying enough to name it in a failure message. */
interface DiscoveredParser {
  /** The module that exports it, for the `describe` label. */
  readonly module: string;
  /** The exported name. */
  readonly name: string;
  /** The parser itself. */
  readonly parse: BodyParser;
}

/**
 * A module namespace flattened into a plain record so its exports can be walked
 * by name. A namespace object carries no index signature, so the spread plus the
 * one cast here is what lets the discovery below be written once rather than per
 * module.
 */
function exportsOf(module: object): Readonly<Record<string, unknown>> {
  return { ...module } as Readonly<Record<string, unknown>>;
}

/**
 * The ten parse modules, in one place. This list — not a list of parsers — is
 * what has to be edited when an eleventh response shape joins the feature; the
 * parsers themselves are discovered from these namespaces, so a parser added to
 * a module already named here needs no edit at all.
 */
const PARSER_MODULES: readonly {
  readonly module: string;
  readonly exports: Readonly<Record<string, unknown>>;
}[] = [
  { module: 'squadSummary.ts', exports: exportsOf(squadSummaryModule) },
  { module: 'squadDetail.ts', exports: exportsOf(squadDetailModule) },
  { module: 'leaderboard.ts', exports: exportsOf(leaderboardModule) },
  { module: 'inviteSummary.ts', exports: exportsOf(inviteSummaryModule) },
  { module: 'generatedInvite.ts', exports: exportsOf(generatedInviteModule) },
  { module: 'invitePreview.ts', exports: exportsOf(invitePreviewModule) },
  { module: 'redemption.ts', exports: exportsOf(redemptionModule) },
  { module: 'featureFlags.ts', exports: exportsOf(featureFlagsModule) },
  { module: 'createdSquad.ts', exports: exportsOf(createdSquadModule) },
  { module: 'createdGuest.ts', exports: exportsOf(createdGuestModule) },
];

/**
 * Every exported Response_Parser of those modules, discovered by name.
 *
 * A `parse`-prefixed export is the directory's naming convention for a parser,
 * and the convention is what the discovery keys on: the `print`-prefixed printers
 * are the round-trip property's subject, and the `read`-prefixed field readers are
 * covered by `primitives.property.test.ts` and by their own module's test, so
 * neither belongs in this quantifier.
 *
 * The cast is checked rather than trusted — the non-vacuity `describe` below
 * asserts every discovered entry really is a one-argument function, so a
 * `parse`-prefixed export that was not a parser fails loudly instead of being
 * quietly called.
 */
const EVERY_PARSER: readonly DiscoveredParser[] = PARSER_MODULES.flatMap(
  ({ module, exports }) =>
    Object.keys(exports)
      .filter((name) => name.startsWith('parse'))
      .sort()
      .map((name) => ({ module, name, parse: exports[name] as BodyParser })),
);

/**
 * The parsers this file was written against, named so the covered set is visible
 * in the source and so a parser that *disappeared* fails the floor below rather
 * than silently shrinking the quantifier.
 */
const EXPECTED_PARSER_NAMES: readonly string[] = [
  'parseCreatedGuest',
  'parseCreatedSquad',
  'parseDisplayRatingEntry',
  'parseDisplayRatingLeaderboard',
  'parseFeatureFlag',
  'parseFeatureFlags',
  'parseGeneratedInvite',
  'parseInvitePreview',
  'parseInviteSummary',
  'parseInviteSummaryList',
  'parseRedemption',
  'parseSquadDetail',
  'parseSquadMember',
  'parseSquadSummary',
  'parseSquadSummaryList',
];

/* -------------------------------------------------------------------------- */
/* The frame every outcome must satisfy                                       */
/* -------------------------------------------------------------------------- */

/** A value's own keys, sorted, as a comparable string. */
function keySignature(value: object): string {
  return Object.keys(value).sort().join(',');
}

/** A description of a thrown value that cannot itself throw. */
function describeRaised(raised: unknown): string {
  try {
    return String(raised);
  } catch {
    return 'an unprintable value';
  }
}

/**
 * Whether a parsed value carries no `undefined` anywhere inside it — the
 * structural reading of "never partial" that holds for every shape in the
 * directory without knowing any of them: every parser builds its result last,
 * from readings it has already checked, so an absence is carried as `null` and a
 * field that could not be read fails the body instead.
 *
 * The walk is bounded and descends only plain objects and arrays. It is safe to
 * recurse here because the subject is a value a *parser produced*, not an input:
 * the deepest shape in the feature is a squad detail holding members and feature
 * flags, three levels down, and the depth cap is the backstop rather than the
 * mechanism.
 */
function carriesNoUndefined(value: unknown, depth = 0): boolean {
  if (depth > 6) {
    return false;
  }

  if (value === undefined) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.every((element) => carriesNoUndefined(element, depth + 1));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.values(value).every((member) =>
      carriesNoUndefined(member, depth + 1),
    );
  }

  return true;
}

/**
 * Settles one parse and asserts Property 22's frame: nothing is raised, the
 * outcome is one of exactly two shapes identified by its own key set, that shape
 * agrees with the `ok` flag, a failure carries a non-empty diagnostic reason, and
 * a success carries a fully populated object value.
 */
function settle(parser: DiscoveredParser, body: unknown): ParseResult<unknown> {
  let outcome: ParseResult<unknown>;

  try {
    outcome = parser.parse(body);
  } catch (raised) {
    // 12.6: the parser returns a parse failure for any input rather than raising.
    // A parser that threw here would hand an unverified body straight through to
    // a transport seam as an exception, which is the failure mode the whole
    // parse layer exists to remove.
    throw new Error(
      `${parser.module} ${parser.name} raised instead of failing: ${describeRaised(raised)}`,
      { cause: raised },
    );
  }

  // A result is always there: never `undefined`, never a promise, never a bare
  // value the caller would have to guess the meaning of.
  expect(typeof outcome).toBe('object');
  expect(outcome).not.toBeNull();
  expect(typeof outcome.ok).toBe('boolean');

  if (outcome.ok) {
    // Exactly the success shape — no stray `reason` riding along on a success,
    // which is what would let a caller branch on the wrong field.
    expect(keySignature(outcome)).toBe('ok,value');
    // Every parser in this directory yields an object or an array; none yields a
    // bare scalar, so this holds across the whole set.
    expect(typeof outcome.value).toBe('object');
    expect(outcome.value).not.toBeNull();
    expect(carriesNoUndefined(outcome.value)).toBe(true);
  } else {
    // Exactly the failure shape, and no half-built `value` alongside it.
    expect(keySignature(outcome)).toBe('ok,reason');
    expect(typeof outcome.reason).toBe('string');
    // A reason exists so a failing test says which field was wrong; an empty or
    // whitespace-only one would be no diagnostic at all.
    expect(outcome.reason.trim().length).toBeGreaterThan(0);
  }

  return outcome;
}

/* -------------------------------------------------------------------------- */
/* The hostile input space                                                    */
/* -------------------------------------------------------------------------- */

/** A well-formed identity, so plausible-looking bodies reach past the first reader. */
const WELL_FORMED_IDENTITY = '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b';

/**
 * Every property name any parser in the directory recognises, gathered in one
 * place. These are the names worth being hostile *at*: an unrecognised property
 * is never read, so a throwing accessor on one costs nothing, while a throwing
 * accessor on a recognised one is the single place an arbitrary input could make
 * a parser raise.
 */
const RECOGNISED_KEYS: readonly string[] = [
  'appearances',
  'code',
  'createdAt',
  'createdBy',
  'displayName',
  'entries',
  'expiresAt',
  'feature',
  'features',
  'guestMembershipId',
  'isEnabled',
  'isGuest',
  'members',
  'membershipId',
  'message',
  'name',
  'outcome',
  'ownerMembershipId',
  'ratingState',
  'redeemableLink',
  'requiresAuthentication',
  'role',
  'squadId',
  'state',
];

/**
 * Every Wire_Enum_Name the feature declares, read from `lib/wireEnums.ts` rather
 * than restated, so a vocabulary change reaches these generators unedited. They
 * are here to make some generated bodies *plausible* — a parser that rejected
 * everything would satisfy a totality property trivially, and plausible bodies
 * are what drive the generators past the first reader and into the field reads
 * where a throw would actually live.
 */
const EVERY_ENUM_NAME: readonly string[] = [
  ...INVITE_STATE_NAMES,
  ...MEMBERSHIP_STATE_NAMES,
  ...RATING_STATE_NAMES,
  ...REDEEM_OUTCOME_NAMES,
  ...SQUAD_FEATURE_NAMES,
  ...SQUAD_ROLE_NAMES,
];

/** The two absences, generated in their own right because they are the commonest bodies. */
const absenceArb: fc.Arbitrary<unknown> = fc.constantFrom<unknown>(
  undefined,
  null,
);

/**
 * A value of every primitive type, with the numeric and textual edges named
 * explicitly: `NaN` and both infinities (none of which JSON can carry, so a
 * reader that trusted `typeof value === 'number'` alone would pass them on),
 * negative zero, the safe-integer bounds, a `BigInt`, and a `Symbol` — the last
 * two being the values that make an incautious coercion or template-string
 * interpolation throw.
 */
const primitiveArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 8,
    arbitrary: fc.constantFrom<unknown>(
      true,
      false,
      0,
      -0,
      1,
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
      Number.MAX_VALUE,
      Number.EPSILON,
      '',
      ' ',
      '\u0000',
      '0',
      'null',
      'undefined',
      '{}',
      '[]',
      '{"squadId":"018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b"}',
      WELL_FORMED_IDENTITY,
      0n,
      -1n,
      2n ** 70n,
      Symbol('wire'),
      Symbol.iterator,
    ),
  },
  { weight: 2, arbitrary: fc.string({ maxLength: 32 }) },
  { weight: 1, arbitrary: fc.string({ unit: 'grapheme', maxLength: 12 }) },
  { weight: 2, arbitrary: fc.double() },
  { weight: 1, arbitrary: fc.integer() },
  { weight: 1, arbitrary: fc.bigInt() },
);

/**
 * The exotic object shapes a body could arrive as: boxed primitives, a
 * null-prototype object, `Date`, `Map`, `Set`, functions, a regular expression,
 * an error, and a promise. Each is `typeof 'object'` (or callable) without being
 * the plain wire object or array the parsers accept, which is exactly the region
 * where a structural test written as "not a primitive" would go wrong.
 */
const exoticArb: fc.Arbitrary<unknown> = fc.constantFrom<unknown>(
  Object(1),
  Object(''),
  Object('a'),
  Object(true),
  Object(0n),
  Object.create(null),
  Object.assign(Object.create(null), { squadId: WELL_FORMED_IDENTITY }),
  new Date(0),
  new Date(Number.NaN),
  new Map<unknown, unknown>([['squadId', WELL_FORMED_IDENTITY]]),
  new Set<unknown>([1, 'a']),
  new WeakMap<object, unknown>(),
  () => ({ squadId: WELL_FORMED_IDENTITY }),
  function named(): void {},
  class Shape {},
  /squadId/g,
  new Error('a body that is an error'),
  Promise.resolve({ squadId: WELL_FORMED_IDENTITY }),
  new Int8Array([1, 2, 3]),
  Object.freeze({ squadId: WELL_FORMED_IDENTITY }),
);

/**
 * A plausible value for a recognised field: the kinds of value the backend really
 * sends, so that a generated body gets *past* the structural readers and into the
 * field reads.
 */
const plausibleFieldArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 3, arbitrary: fc.uuid() },
  { weight: 1, arbitrary: fc.constant(WELL_FORMED_IDENTITY) },
  { weight: 3, arbitrary: fc.constantFrom<unknown>(...EVERY_ENUM_NAME) },
  { weight: 2, arbitrary: fc.string({ maxLength: 24 }) },
  { weight: 2, arbitrary: fc.boolean() },
  { weight: 2, arbitrary: fc.nat({ max: 400 }) },
  {
    weight: 2,
    arbitrary: fc
      .integer({ min: -8_640_000_000_000, max: 8_640_000_000_000 })
      .map((instantMs) => new Date(instantMs).toISOString()),
  },
  { weight: 2, arbitrary: fc.constant(null) },
);

/** An object over a subset of the recognised keys, carrying the given value kind. */
function bodyOverRecognisedKeys(
  valueArb: fc.Arbitrary<unknown>,
): fc.Arbitrary<Record<string, unknown>> {
  return fc.dictionary(fc.constantFrom(...RECOGNISED_KEYS), valueArb, {
    maxKeys: 10,
  });
}

/** A plausible leaf body: recognised keys carrying values of the right kinds. */
const plausibleLeafBodyArb = bodyOverRecognisedKeys(plausibleFieldArb);

/**
 * A plausible body, including the nested forms: a detail carrying `members` or
 * `features`, a leaderboard carrying `entries`, and the bare array the three list
 * parsers take as their whole body.
 */
const plausibleBodyArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 4, arbitrary: plausibleLeafBodyArb },
  {
    weight: 3,
    arbitrary: fc
      .tuple(
        plausibleLeafBodyArb,
        fc.constantFrom('members', 'features', 'entries'),
        fc.array(plausibleLeafBodyArb, { maxLength: 4 }),
      )
      .map(([body, key, elements]) => ({ ...body, [key]: elements })),
  },
  { weight: 3, arbitrary: fc.array(plausibleLeafBodyArb, { maxLength: 6 }) },
);

/**
 * An object where an array is expected and an array where an object is expected,
 * generated by name rather than left to chance: the three list parsers take an
 * array body and every other parser takes an object, so each generated value is
 * the wrong one of the pair for some parser in the table.
 */
const transposedShapeArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 2, arbitrary: fc.array(primitiveArb, { maxLength: 5 }) },
  {
    weight: 2,
    arbitrary: plausibleLeafBodyArb.map((body) => [body, body]),
  },
  {
    weight: 2,
    arbitrary: fc
      .array(plausibleLeafBodyArb, { maxLength: 4 })
      .map((elements) => ({ ...elements })),
  },
  {
    weight: 1,
    arbitrary: fc.constantFrom<unknown>(
      [],
      [[]],
      [{}],
      [null],
      [undefined],
      {},
      { 0: {}, length: 1 },
      { length: 0 },
    ),
  },
);

/** Wraps `leaf` in `depth` levels of alternating arrays and objects. */
function nest(leaf: unknown, depth: number, key: string): unknown {
  let value: unknown = leaf;

  for (let level = 0; level < depth; level += 1) {
    value = level % 2 === 0 ? [value] : { [key]: value };
  }

  return value;
}

/**
 * A value nested to between 1 and 100 levels, alternating arrays and objects and
 * using a *recognised* key at each object level so a parser that walked an
 * interior it had not asked for would be made to walk this one.
 *
 * No parser descends an interior it did not name, so depth costs a type test
 * rather than a stack frame per level; this generator is what holds that true.
 */
const deeplyNestedArb: fc.Arbitrary<unknown> = fc
  .tuple(
    fc.oneof(primitiveArb, plausibleLeafBodyArb),
    fc.integer({ min: 1, max: 100 }),
    fc.constantFrom(...RECOGNISED_KEYS),
  )
  .map(([leaf, depth, key]) => nest(leaf, depth, key));

/** The shapes of reference cycle a body can carry. */
const CYCLE_SHAPES = [
  'self-object',
  'self-array',
  'mutual-objects',
  'array-of-self',
  'deep-tail',
] as const;

/**
 * A value containing a reference cycle, built fresh per run.
 *
 * A cycle is the input that separates "does not recurse" from "recurses but
 * usually terminates": a parser that walked an unknown interior would not
 * overflow on these, it would never return. Each shape plants the cycle on a
 * recognised key, since an unrecognised one is never read.
 */
function buildCycle(
  shape: (typeof CYCLE_SHAPES)[number],
  key: string,
  leaf: Record<string, unknown>,
): unknown {
  if (shape === 'self-object') {
    const body: Record<string, unknown> = { ...leaf };
    body[key] = body;

    return body;
  }

  if (shape === 'self-array') {
    const body: unknown[] = [];
    body.push(body, leaf);

    return body;
  }

  if (shape === 'mutual-objects') {
    const first: Record<string, unknown> = { ...leaf };
    const second: Record<string, unknown> = { ...leaf };
    first[key] = second;
    second[key] = first;

    return first;
  }

  if (shape === 'array-of-self') {
    const body: unknown[] = [];
    body.push({ ...leaf, [key]: body });

    return body;
  }

  // 'deep-tail': fifty levels deep, with the innermost level pointing back at the
  // root, so the cycle is only reachable by a walker that got all the way down.
  const root: Record<string, unknown> = { ...leaf };
  let tail = root;

  for (let level = 0; level < 50; level += 1) {
    const next: Record<string, unknown> = {};
    tail[key] = next;
    tail = next;
  }

  tail[key] = root;

  return root;
}

const cyclicArb: fc.Arbitrary<unknown> = fc
  .tuple(
    fc.constantFrom(...CYCLE_SHAPES),
    fc.constantFrom(...RECOGNISED_KEYS),
    plausibleLeafBodyArb,
  )
  .map(([shape, key, leaf]) => buildCycle(shape, key, leaf));

/**
 * `body` with each of `keys` redefined as an enumerable accessor that throws when
 * it is read.
 *
 * This is the only operation on an arbitrary input that can make a parser raise,
 * which is why every parser takes its fields through `readProperty` and why this
 * generator exists: a throwing *recognised* property must cost that field its
 * reading, not the process its stack.
 */
function withThrowingAccessors(
  body: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Record<string, unknown> {
  const hostile: Record<string, unknown> = { ...body };

  for (const key of keys) {
    Object.defineProperty(hostile, key, {
      enumerable: true,
      configurable: true,
      get(): never {
        throw new Error('a throwing accessor');
      },
    });
  }

  return hostile;
}

const throwingAccessorArb: fc.Arbitrary<unknown> = fc
  .tuple(
    plausibleLeafBodyArb,
    fc.subarray([...RECOGNISED_KEYS], { minLength: 1, maxLength: 4 }),
  )
  .map(([body, keys]) => withThrowingAccessors(body, keys));

/**
 * The same hostility one level down, inside a collection: an element of a
 * `members`, `features`, or `entries` array, and an element of a bare array body,
 * defined as a throwing accessor. A parser that guarded its own property reads
 * but not its elements' would pass the generator above and fail this one.
 */
const throwingElementArb: fc.Arbitrary<unknown> = fc
  .tuple(
    plausibleLeafBodyArb,
    fc.subarray([...RECOGNISED_KEYS], { minLength: 1, maxLength: 3 }),
    fc.constantFrom('members', 'features', 'entries'),
    fc.boolean(),
  )
  .map(([body, keys, collectionKey, asBareArray]) => {
    const element = withThrowingAccessors(body, keys);

    return asBareArray
      ? [body, element]
      : { ...body, [collectionKey]: [body, element] };
  });

/**
 * Everything fast-check itself can build, with every exotic flag on — the
 * open-ended tail of the input space, which is what catches a category nobody
 * thought to name above.
 */
const anythingArb: fc.Arbitrary<unknown> = fc.anything({
  maxDepth: 4,
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

/** The whole input space Property 22 quantifies over. */
const hostileBodyArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 2, arbitrary: absenceArb },
  { weight: 5, arbitrary: primitiveArb },
  { weight: 3, arbitrary: exoticArb },
  { weight: 5, arbitrary: plausibleBodyArb },
  { weight: 4, arbitrary: transposedShapeArb },
  { weight: 3, arbitrary: deeplyNestedArb },
  { weight: 3, arbitrary: cyclicArb },
  { weight: 3, arbitrary: throwingAccessorArb },
  { weight: 3, arbitrary: throwingElementArb },
  { weight: 5, arbitrary: anythingArb },
);

/* -------------------------------------------------------------------------- */
/* Property 22, over every discovered parser                                  */
/* -------------------------------------------------------------------------- */

/**
 * States Property 22 for one parser. Invoked once per discovered parser, so a
 * parser cannot hide behind a sibling that is total, and a parser exported later
 * acquires these assertions without this file changing.
 */
function describeTotality(parser: DiscoveredParser): void {
  // Feature: api-response-contracts, Property 22: Response parsers are total — for
  // any input value a response parser can be handed, including a structurally
  // hostile one, the parser returns a parse result and raises nothing.
  // Validates: Requirements 12.5, 12.6
  describe(`${parser.module} · ${parser.name} — total over every input`, () => {
    it('returns a parse result and raises nothing, for any input at all', () => {
      fc.assert(
        fc.property(hostileBodyArb, (body) => {
          settle(parser, body);
        }),
        { numRuns: 1000 },
      );
    });

    it('settles both absences, every primitive type, and the exotic objects', () => {
      fc.assert(
        fc.property(fc.oneof(absenceArb, primitiveArb, exoticArb), (body) => {
          // Only the frame is claimed, not which way the input settles. This
          // region is where that restraint earns its keep: an absent body is a
          // *valid* already-a-member no-op for `parseRedemption` and a failure
          // for every other parser, and a boxed primitive or a `Date` is a plain
          // object to a structural reader, so a body of no recognised properties
          // parses wherever every property is optional. Asserting "a primitive
          // always fails" would be asserting one shape's rules over the set.
          settle(parser, body);
        }),
        { numRuns: 600 },
      );
    });

    it('settles a value nested to 100 levels without walking it', () => {
      fc.assert(
        fc.property(deeplyNestedArb, (body) => {
          settle(parser, body);
        }),
        { numRuns: 400 },
      );
    });

    it('settles a self-referencing object and a cyclic array', () => {
      fc.assert(
        fc.property(cyclicArb, (body) => {
          settle(parser, body);
        }),
        { numRuns: 400 },
      );
    });

    it('settles a body whose recognised properties throw when read', () => {
      fc.assert(
        fc.property(
          fc.oneof(throwingAccessorArb, throwingElementArb),
          (body) => {
            // A throwing accessor reads as an absence, which the field's own
            // reader turns into a failure where the field is required and into a
            // valid absence where it is not. Either is total; raising is not.
            settle(parser, body);
          },
        ),
        { numRuns: 500 },
      );
    });

    it('settles a transposed shape: an array for an object, an object for an array', () => {
      fc.assert(
        fc.property(transposedShapeArb, (body) => {
          settle(parser, body);
        }),
        { numRuns: 400 },
      );
    });

    it('settles the same input the same way twice', () => {
      fc.assert(
        fc.property(hostileBodyArb, (body) => {
          const first = settle(parser, body);
          const second = settle(parser, body);

          // A parse reads no clock, no counter, and no storage, so the outcome is
          // a function of the body alone. Without this, a parser could satisfy
          // totality while being unreproducible — and the replay of a failure in
          // a bug report would not reproduce it.
          expect(second).toStrictEqual(first);
        }),
        { numRuns: 500 },
      );
    });
  });
}

for (const parser of EVERY_PARSER) {
  describeTotality(parser);
}

/* -------------------------------------------------------------------------- */
/* The non-vacuity floor                                                      */
/* -------------------------------------------------------------------------- */

// Feature: api-response-contracts, Property 22: Response parsers are total — the
// discovery floor, so a quantifier over a discovered set cannot pass empty.
// Validates: Requirements 12.5, 12.6
describe('the discovered parser table is non-vacuous', () => {
  it('finds at least the fifteen parsers this file was written against', () => {
    const discovered = EVERY_PARSER.map((parser) => parser.name).sort();

    // The floor the design's note on discovered quantification asks for: a
    // discovery regression — a renamed convention, a module that stopped
    // exporting, a bad import — fails here rather than passing with an empty
    // quantifier and an all-green report.
    expect(EVERY_PARSER.length).toBeGreaterThanOrEqual(
      EXPECTED_PARSER_NAMES.length,
    );

    for (const expected of EXPECTED_PARSER_NAMES) {
      expect(discovered).toContain(expected);
    }
  });

  it('draws from all ten parse modules', () => {
    const modules = new Set(EVERY_PARSER.map((parser) => parser.module));

    expect(modules.size).toBe(PARSER_MODULES.length);
    expect(PARSER_MODULES.length).toBe(10);

    for (const { module } of PARSER_MODULES) {
      expect(modules).toContain(module);
    }
  });

  it('discovered only callable one-argument parsers', () => {
    for (const parser of EVERY_PARSER) {
      // The cast at the discovery site is checked here rather than trusted: a
      // `parse`-prefixed export that was not a one-body parser would otherwise be
      // called with a body it never agreed to take.
      expect(typeof parser.parse).toBe('function');
      expect(parser.parse.length).toBe(1);
    }
  });

  it('names each discovered parser exactly once', () => {
    const names = EVERY_PARSER.map((parser) => `${parser.module}#${parser.name}`);

    expect(new Set(names).size).toBe(names.length);
  });

  it('generates every category of hostile input it claims to', () => {
    const sample = fc.sample(hostileBodyArb, 4000);

    const has = (predicate: (value: unknown) => boolean): boolean =>
      sample.some((value) => {
        try {
          return predicate(value);
        } catch {
          return false;
        }
      });

    // Without this, a generator that had quietly narrowed — a filter that
    // rejected everything interesting, a weight set to zero — would leave the
    // properties above passing over a space of plain objects.
    expect(has((value) => value === undefined)).toBe(true);
    expect(has((value) => value === null)).toBe(true);
    expect(has((value) => typeof value === 'number' && Number.isNaN(value))).toBe(
      true,
    );
    expect(
      has(
        (value) =>
          typeof value === 'number' &&
          !Number.isNaN(value) &&
          !Number.isFinite(value),
      ),
    ).toBe(true);
    expect(has((value) => typeof value === 'bigint')).toBe(true);
    expect(has((value) => typeof value === 'symbol')).toBe(true);
    expect(has((value) => typeof value === 'function')).toBe(true);
    expect(has((value) => typeof value === 'string')).toBe(true);
    expect(has((value) => typeof value === 'boolean')).toBe(true);
    expect(has((value) => Array.isArray(value))).toBe(true);
    expect(
      has(
        (value) =>
          typeof value === 'object' && value !== null && !Array.isArray(value),
      ),
    ).toBe(true);
    expect(
      has((value) => typeof value === 'object' && value instanceof Date),
    ).toBe(true);
    expect(has((value) => value instanceof Map)).toBe(true);
    expect(has((value) => value instanceof Set)).toBe(true);
    expect(
      has(
        (value) =>
          typeof value === 'object' &&
          value !== null &&
          Object.getPrototypeOf(value) === null,
      ),
    ).toBe(true);
    // A boxed primitive: `typeof 'object'` while wrapping a scalar.
    expect(
      has(
        (value) =>
          value instanceof Number ||
          value instanceof String ||
          value instanceof Boolean,
      ),
    ).toBe(true);
    // A reference cycle, detected the cheap way: a structure `JSON.stringify`
    // refuses is either cyclic or carries a `BigInt`, and both are in the space.
    expect(
      has((value) => {
        try {
          JSON.stringify(value);

          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
    // A throwing accessor on a recognised property name.
    expect(
      has((value) => {
        if (typeof value !== 'object' || value === null) {
          return false;
        }

        return RECOGNISED_KEYS.some((key) => {
          const descriptor = Object.getOwnPropertyDescriptor(value, key);

          return descriptor?.get !== undefined;
        });
      }),
    ).toBe(true);
  });

  it('generates bodies some parser in the table accepts', () => {
    const sample = fc.sample(plausibleBodyArb, 2000);

    // The complement of the floor above: totality is cheap to satisfy by
    // rejecting everything, so the space must also contain bodies that really
    // parse. At least one parser in the table must succeed on at least one
    // generated body, or the suite is only ever exercising the rejection paths.
    const accepted = sample.some((body) =>
      EVERY_PARSER.some((parser) => {
        try {
          return parser.parse(body).ok;
        } catch {
          return false;
        }
      }),
    );

    expect(accepted).toBe(true);
  });
});
