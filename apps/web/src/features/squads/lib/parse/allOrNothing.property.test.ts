import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  INVITE_STATE_NAMES,
  MEMBERSHIP_STATE_NAMES,
  RATING_STATE_NAMES,
  SQUAD_FEATURE_NAMES,
  SQUAD_ROLE_NAMES,
} from '../wireEnums';
import {
  parseFeatureFlag,
  parseFeatureFlags,
  type FeatureFlag,
} from './featureFlags';
import {
  parseInviteSummary,
  parseInviteSummaryList,
  type InviteSummary,
} from './inviteSummary';
import {
  parseDisplayRatingEntry,
  parseDisplayRatingLeaderboard,
  type DisplayRatingEntry,
  type DisplayRatingLeaderboard,
} from './leaderboard';
import type { ParseResult } from './primitives';
import {
  parseSquadDetail,
  parseSquadMember,
  type SquadDetail,
  type SquadMember,
} from './squadDetail';
import {
  parseSquadSummaryList,
  parseSquadSummary,
  type SquadSummary,
} from './squadSummary';

/**
 * Property test for the one rule every collection-bearing Response_Parser of this
 * feature shares, placed beside the modules it covers as the design's Testing
 * Strategy asks and running well above the 100-iteration floor (20.1).
 *
 * This file carries **Property 23: A parse failure is all-or-nothing** — for any
 * acceptable response body containing a collection and any single corrupted
 * member of that collection, the parser fails the **whole body** and yields no
 * partially populated value, so one unacceptable member can never silently drop a
 * player from a squad list (12.7).
 *
 * ## Why this is worth a property of its own
 *
 * Every parser module already has a per-element spoiling test beside it, so the
 * per-module half of this is not new. What is new here is the two things a
 * per-module test cannot say.
 *
 * **The statement is made across collections, in one place.** `members` on a
 * squad detail, `entries` on a leaderboard, `features` on either of its two
 * operations, and the two top-level list bodies are quantified over as a table,
 * with a non-vacuity floor on the table's size. A sixth collection added to this
 * feature joins the quantifier by gaining a row rather than by someone
 * remembering to write the same test a sixth time.
 *
 * **The assertion is stronger than "the body fails".** All-or-nothing is a claim
 * about what a parser may *return*, and the dangerous outcome is not a failure —
 * it is a success carrying `n − 1` elements. So each case parses the **same
 * collection twice**: uncorrupted, where it must succeed with exactly `n`
 * elements in exactly the generated order; and with one member corrupted, where
 * there must be no value at all — the result object is asserted to carry the keys
 * `ok` and `reason` and literally not to have a `value` property. A parser that
 * skipped the bad element would pass the per-module assertion that "a bad element
 * makes the body fail" only by accident of how that test was written; it cannot
 * pass this one.
 *
 * Why it matters concretely, in the one sentence that justifies the whole rule:
 * `GetSquad` is the authority on membership, so a member quietly dropped from
 * `members` is a player who vanishes from the squad while the Player_List still
 * renders a complete-looking list, with **nothing on screen saying so**. The same
 * shape of silence would hide a squad the caller belongs to from the Squads_Home,
 * and hide from an admin an invite they therefore cannot revoke. A failure is
 * recoverable: it surfaces as the single Generic_Squads_Failure with a retry,
 * which is honest about the fact that the body could not be read.
 *
 * ## The positive half, so the property is not satisfied by a parser that fails
 * everything
 *
 * "One bad member fails the body" is trivially true of a parser that rejects
 * every body. So each shape also asserts that an **uncorrupted** collection of
 * any length succeeds with exactly that many elements in exactly that order —
 * including the empty, the singleton, and a long collection, since a fold that
 * mishandled 0 or 1 elements is exactly the defect a mid-sized random array
 * misses. Order is checked through a per-index **witness** stamped onto each
 * generated element (see {@link ShapeSpec.stamp}), so a parser that returned the
 * right number of elements in the wrong order is caught too.
 *
 * The corruption generators carry their own floor: every corrupted element is
 * asserted to be unacceptable **in its own right** before the body is parsed. Had
 * a generator drifted into producing an acceptable element, the body would
 * legitimately parse and the negative half would silently stop testing anything.
 *
 * ## One deliberate asymmetry, asserted rather than smoothed over
 *
 * Two collections of this feature treat a repeated member differently, and both
 * decisions are stated here so neither can drift into the other:
 *
 *  - a **duplicated membership identity in a leaderboard fails the body** (8.11),
 *    because two entries for one membership make that person's rating ambiguous
 *    and there is no defensible way to choose between them;
 *  - a **duplicated feature flag is carried**, because a repeated flag decides
 *    nothing about anybody — the toggle surface renders what the collection
 *    carries.
 *
 * Neither is a failure of all-or-nothing: the leaderboard yields no value at all
 * rather than a de-duplicated one, and the flags collection yields every element
 * it was given rather than a shortened set.
 *
 * React-free and DOM-free, like every module under `lib/`.
 *
 * Requirements: 12.7
 */

/* -------------------------------------------------------------------------- */
/* Shared generators: well-formed wire values                                 */
/* -------------------------------------------------------------------------- */

/** A well-formed identity, for the bodies and generators that need one to spoil. */
const WELL_FORMED_IDENTITY = '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b';

/** The 36-character hyphenated identity form, in both letter cases. */
const identityArb: fc.Arbitrary<string> = fc.oneof(
  fc.uuid(),
  fc.uuid().map((identity) => identity.toUpperCase()),
);

/**
 * A distinct well-formed identity per collection index.
 *
 * Only the leaderboard needs it — a repeated membership identity fails that body
 * by design (8.11), so the positive half must generate distinct ones rather than
 * hope a random draw avoids a collision. Decimal digits are hexadecimal digits,
 * so an index padded into the final group is a well-formed identity.
 */
function identityForIndex(index: number): string {
  return `018f3a2b-4c5d-7e6f-8a9b-${String(index).padStart(12, '0')}`;
}

/**
 * An ISO-8601 instant with an explicit `Z`, bounded to a range `toISOString`
 * renders with a four-digit year. The instant grammar itself is the primitives'
 * property, not this one's.
 */
const isoInstantArb: fc.Arbitrary<string> = fc
  .integer({ min: -8_640_000_000_000, max: 8_640_000_000_000 })
  .map((instantMs) => new Date(instantMs).toISOString());

/** A free-form display name; the readers impose no bounds on these fields. */
const displayNameArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ maxLength: 24 }),
  fc.string({ unit: 'grapheme', maxLength: 10 }),
);

/** A well-formed leaderboard value: any finite number (8.9). */
const leaderboardValueArb: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: -5_000, max: 5_000 }),
  fc.double({ noNaN: true, noDefaultInfinity: true }).filter(Number.isFinite),
);

/** A well-formed Appearance_Count: a non-negative whole number (12.9). */
const appearanceCountArb: fc.Arbitrary<number> = fc.nat({ max: 400 });

const roleOrAbsenceArb: fc.Arbitrary<string | null> = fc.option(
  fc.constantFrom(...SQUAD_ROLE_NAMES),
  { nil: null },
);

const membershipStateArb: fc.Arbitrary<string> = fc.constantFrom(
  ...MEMBERSHIP_STATE_NAMES,
);

const ratingStateOrAbsenceArb: fc.Arbitrary<string | null> = fc.option(
  fc.constantFrom(...RATING_STATE_NAMES),
  { nil: null },
);

/* -------------------------------------------------------------------------- */
/* Shared generators: unacceptable field values                               */
/* -------------------------------------------------------------------------- */

/** Drops the two absences, for a field where an absence is *valid* (16.8). */
function presentOnly(arb: fc.Arbitrary<unknown>): fc.Arbitrary<unknown> {
  return arb.filter(
    (candidate) => candidate !== null && candidate !== undefined,
  );
}

/** Values `readUuid` rejects, the near-miss identity spellings included. */
const notAnIdentityArb: fc.Arbitrary<unknown> = fc.constantFrom<unknown>(
  undefined,
  null,
  42,
  '',
  'not-an-identity',
  WELL_FORMED_IDENTITY.replace(/-/g, ''),
  `{${WELL_FORMED_IDENTITY}}`,
  ` ${WELL_FORMED_IDENTITY}`,
  `${WELL_FORMED_IDENTITY} `,
  [WELL_FORMED_IDENTITY],
  { value: WELL_FORMED_IDENTITY },
  true,
);

/** Values `readString` rejects. Nothing is coerced, so a number is not a string. */
const notAStringArb: fc.Arbitrary<unknown> = fc.constantFrom<unknown>(
  undefined,
  null,
  0,
  42,
  true,
  false,
  [],
  ['Dave'],
  {},
  { value: 'Dave' },
  Number.NaN,
  1n,
);

/** Values `readBoolean` rejects, the truthy and falsy near misses included. */
const notABooleanArb: fc.Arbitrary<unknown> = fc.constantFrom<unknown>(
  undefined,
  null,
  0,
  1,
  'true',
  'false',
  '',
  [],
  [true],
  {},
  1n,
);

/** Values the Appearance_Count reader rejects: not whole, not a number, negative. */
const notACountArb: fc.Arbitrary<unknown> = fc.constantFrom<unknown>(
  undefined,
  null,
  '0',
  '7',
  -1,
  -2,
  0.5,
  7.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  [0],
  {},
  true,
);

/** Values `readNumber` rejects, the string-encoded number included. */
const notAFiniteNumberArb: fc.Arbitrary<unknown> = fc.constantFrom<unknown>(
  undefined,
  null,
  '0',
  '12.5',
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  [1],
  {},
  true,
  1n,
);

/** Values `readInstantMs` rejects: a local time names no instant, and `2026-02-30` no day. */
const notAnInstantArb: fc.Arbitrary<unknown> = fc.constantFrom<unknown>(
  undefined,
  null,
  0,
  1_700_000_000_000,
  '',
  'yesterday',
  '2026-01-01',
  '2026-01-01T00:00:00',
  '2026-13-01T00:00:00Z',
  '2026-02-30T00:00:00Z',
  ['2026-01-01T00:00:00Z'],
  {},
  true,
);

/**
 * Values naming no member of one wire enum's Generated_Enum_Union.
 *
 * Three kinds matter, and the union's own names are excluded from the first so
 * the generator cannot accidentally produce an acceptable value: **the case
 * variations and the old internal spellings**, since a name is compared exactly;
 * **the numeric codes** the previous contract sent for these very fields, so the
 * migration to names is not a half-measure; and **the structural near misses**, a
 * name wrapped in an array or an object.
 *
 * Deliberately free of `null` and `undefined`: for a field where an absence is
 * valid (a guest's `role`, an unrated membership's `ratingState`) an absence must
 * *not* fail, and a missing required field is generated as its own corruption.
 */
function outsideUnionArb(names: readonly string[]): fc.Arbitrary<unknown> {
  const strings = [
    'owner',
    'Owner',
    'OWNER',
    'admin',
    'member',
    'Captain',
    'active',
    'Active',
    'inactive',
    'revoked',
    'expired',
    'provisional',
    'Provisional',
    'Established',
    'LiveMatchTracking',
    'livematchtracking',
    'live-match-tracking',
    '',
    ' ',
  ].filter((candidate) => !names.includes(candidate));

  return fc.oneof(
    { weight: 3, arbitrary: fc.constantFrom<unknown>(...strings) },
    {
      weight: 3,
      arbitrary: fc.constantFrom<unknown>(
        0,
        1,
        2,
        3,
        -1,
        0.5,
        Number.NaN,
        true,
        false,
        [names[0]],
        { value: names[0] },
        1n,
      ),
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Shared generators: elements that are not objects at all                    */
/* -------------------------------------------------------------------------- */

/**
 * Values no element position accepts, because `readObject` establishes that an
 * element is a plain object before any field is read. An array is a list, not a
 * body; a function, a symbol, and a bigint are not objects either.
 */
const notAnObjectArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      true,
      false,
      0,
      1,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '',
      'LiveMatchTracking',
      '{}',
      '[]',
      0n,
      1n,
      Symbol('wire'),
      [],
      [{}],
      [[[]]],
      () => ({}),
    ),
  },
  { weight: 2, arbitrary: fc.string({ maxLength: 16 }) },
  { weight: 2, arbitrary: fc.array(fc.integer(), { maxLength: 3 }) },
);

/**
 * Object-typed values that are structurally hostile rather than merely wrong: a
 * null-prototype object, the built-in collections, a boxed primitive, a value
 * whose `toString` throws, and a prototype-polluting payload.
 *
 * Every one of them is an object `readObject` admits and none of them carries a
 * single field any element shape requires, so each fails on its first reading —
 * and the one with the throwing `toString` proves that no reader coerces, since
 * coercion would raise rather than fail.
 */
const hostileObjectArb: fc.Arbitrary<unknown> = fc.constantFrom<unknown>(
  {},
  Object.create(null) as object,
  new Date(0),
  new Map<unknown, unknown>([['squadId', WELL_FORMED_IDENTITY]]),
  new Set<unknown>([WELL_FORMED_IDENTITY]),
  Object(1),
  Object('LiveMatchTracking'),
  {
    toString(): never {
      throw new Error('a hostile element');
    },
  },
  JSON.parse('{"__proto__": {"polluted": true}}') as object,
);

/** Wraps `leaf` in `depth` levels of alternating arrays and objects. */
function nest(leaf: unknown, depth: number): unknown {
  let value: unknown = leaf;

  for (let level = 0; level < depth; level += 1) {
    value = level % 2 === 0 ? [value] : { value };
  }

  return value;
}

/**
 * An element nested to between 1 and 100 levels. No reader walks the interior of
 * an unknown value, so depth costs one type test — but it must still *fail*
 * rather than raise, and that is what is asserted.
 */
const deeplyNestedArb: fc.Arbitrary<unknown> = fc
  .tuple(fc.integer({ min: -1, max: 1 }), fc.integer({ min: 1, max: 100 }))
  .map(([leaf, depth]) => nest(leaf, depth));

/* -------------------------------------------------------------------------- */
/* Element surgery                                                            */
/* -------------------------------------------------------------------------- */

/** `element` without `key`. */
function without(
  element: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, unknown> {
  const copy = { ...element };

  delete copy[key];

  return copy;
}

/**
 * `element` with `key` defined as an accessor that throws when it is read.
 *
 * Applied to **required** keys only: `readProperty` catches the raise and reports
 * the property as absent, which fails a required field and is a valid absence for
 * an optional one.
 */
function throwingAt(
  element: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, unknown> {
  return Object.defineProperty({ ...element }, key, {
    enumerable: true,
    configurable: true,
    get(): never {
      throw new Error('a hostile property');
    },
  });
}

/** A value's own keys, sorted, as a comparable signature. */
function keySignature(value: object): string {
  return Object.keys(value).sort().join(',');
}

/**
 * The five kinds of corruption the property applies to a single member, built
 * once and specialised per shape by the keys that shape declares.
 *
 * The weights favour the field-level corruptions, because those are the ones a
 * real contract drift produces — a renamed field, a field that went from a number
 * to a string, an enum member nobody told the client about.
 */
function corruptionsOf(spec: {
  readonly elementArb: fc.Arbitrary<Record<string, unknown>>;
  readonly requiredKeys: readonly string[];
  /** A key paired with a value that key's reader must reject. */
  readonly mistypedArb: fc.Arbitrary<[string, unknown]>;
}): fc.Arbitrary<unknown> {
  const requiredKeyArb = fc.constantFrom(...spec.requiredKeys);

  return fc.oneof(
    // A required field missing entirely.
    {
      weight: 3,
      arbitrary: fc
        .tuple(spec.elementArb, requiredKeyArb)
        .map(([element, key]) => without(element, key)),
    },
    // A field mistyped, or an enum field naming no member of its union.
    {
      weight: 5,
      arbitrary: fc
        .tuple(spec.elementArb, spec.mistypedArb)
        .map(([element, [key, value]]) => ({ ...element, [key]: value })),
    },
    // A required field that throws when it is read.
    {
      weight: 1,
      arbitrary: fc
        .tuple(spec.elementArb, requiredKeyArb)
        .map(([element, key]) => throwingAt(element, key)),
    },
    // Not an object at all.
    { weight: 3, arbitrary: notAnObjectArb },
    // Structurally hostile, and deeply nested.
    { weight: 2, arbitrary: hostileObjectArb },
    { weight: 1, arbitrary: deeplyNestedArb },
  );
}

/* -------------------------------------------------------------------------- */
/* The table: one row per collection-bearing parser                           */
/* -------------------------------------------------------------------------- */

/**
 * A settled parse in erased form: the witness sequence of the parsed collection
 * on success, and the diagnostic reason on failure. There is no third shape,
 * which is the whole point — a `SettledParse` cannot express "succeeded with a
 * shortened collection" without the witnesses to prove it.
 */
type SettledParse =
  | {
      readonly ok: true;
      readonly length: number;
      readonly witnesses: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

/** One collection-bearing parser, with its types erased so the table is uniform. */
interface CollectionShape {
  /** The body shape and the collection within it, for the test titles. */
  readonly label: string;
  /** Where the collection sits in the body, for the test titles. */
  readonly collectionPath: string;
  /** Well-formed elements, stamped so each carries a distinct order witness. */
  readonly collectionArb: (
    minLength: number,
    maxLength: number,
  ) => fc.Arbitrary<Record<string, unknown>[]>;
  /** Corrupted elements, every one of them unacceptable in its own right. */
  readonly corruptionArb: fc.Arbitrary<unknown>;
  /** Whether one element parses on its own, through this shape's element parser. */
  readonly elementParses: (element: unknown) => boolean;
  /** The order witness an element carries on the wire. */
  readonly witnessOfWire: (element: Record<string, unknown>) => string;
  /** Parses a body carrying exactly `elements` at this shape's collection path. */
  readonly parse: (elements: readonly unknown[]) => SettledParse;
}

/** How one shape is declared, with its parsed types still intact. */
interface ShapeSpec<TValue, TElement> {
  readonly label: string;
  readonly collectionPath: string;
  readonly elementArb: fc.Arbitrary<Record<string, unknown>>;
  /**
   * Stamps a distinct order witness onto the element at `index`.
   *
   * Element order is part of the claim — a parsed collection must carry exactly
   * the elements it was given, in exactly their order — and a randomly generated
   * collection can repeat a value, which would make a reordering invisible. So
   * one free-form field per shape is overwritten with the index.
   */
  readonly stamp: (
    element: Record<string, unknown>,
    index: number,
  ) => Record<string, unknown>;
  readonly corruptionArb: fc.Arbitrary<unknown>;
  readonly parseElement: (element: unknown) => ParseResult<TElement>;
  readonly parseBody: (elements: readonly unknown[]) => ParseResult<TValue>;
  readonly collectionOf: (value: TValue) => readonly TElement[];
  readonly witnessOfWire: (element: Record<string, unknown>) => string;
  readonly witnessOfParsed: (element: TElement) => string;
  /** Whether a parsed element is fully populated: its exact fields, each valid. */
  readonly isPopulatedElement: (element: TElement) => boolean;
}

/**
 * Erases one shape's types into a {@link CollectionShape}, asserting the frame of
 * Property 23 on every parse it settles:
 *
 *  - the parser **raises nothing**, whatever the body;
 *  - the result is exactly one of the two declared shapes, with exactly its own
 *    keys — so a failure carries a reason and, demonstrably, **no `value`
 *    property at all**: there is nothing to read a shortened collection out of;
 *  - on success every element is **fully populated** — its exact declared fields,
 *    none left `undefined` — so "no partially populated value" is checked at the
 *    element level as well as at the collection level.
 */
function shapeOf<TValue, TElement>(
  spec: ShapeSpec<TValue, TElement>,
): CollectionShape {
  return {
    label: spec.label,
    collectionPath: spec.collectionPath,
    corruptionArb: spec.corruptionArb,
    witnessOfWire: spec.witnessOfWire,
    collectionArb: (minLength, maxLength) =>
      fc
        .array(spec.elementArb, { minLength, maxLength })
        .map((elements) =>
          elements.map((element, index) => spec.stamp(element, index)),
        ),
    elementParses: (element) => spec.parseElement(element).ok,
    parse: (elements) => {
      let outcome: ParseResult<TValue>;

      try {
        outcome = spec.parseBody(elements);
      } catch (raised) {
        // 16.4: a Response_Parser is total. A raise is not a parse failure — it
        // escapes the call site and takes the screen's error handling with it.
        throw new Error(
          `${spec.label}: the parser raised instead of failing: ${String(raised)}`,
          { cause: raised },
        );
      }

      expect(typeof outcome).toBe('object');
      expect(outcome).not.toBeNull();
      expect(typeof outcome.ok).toBe('boolean');

      if (!outcome.ok) {
        // The all-or-nothing claim on the failure side: a failure is a reason and
        // nothing else. No `value`, so no caller — and no future refactor — can
        // read a half-built collection out of it.
        expect(keySignature(outcome)).toBe('ok,reason');
        expect('value' in outcome).toBe(false);
        expect(typeof outcome.reason).toBe('string');
        expect(outcome.reason.length).toBeGreaterThan(0);

        return { ok: false, reason: outcome.reason };
      }

      expect(keySignature(outcome)).toBe('ok,value');

      const collection = spec.collectionOf(outcome.value);

      expect(Array.isArray(collection)).toBe(true);
      expect(collection.every(spec.isPopulatedElement)).toBe(true);

      return {
        ok: true,
        length: collection.length,
        witnesses: collection.map(spec.witnessOfParsed),
      };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Well-formed elements, per shape                                            */
/* -------------------------------------------------------------------------- */

const squadSummaryElementArb: fc.Arbitrary<Record<string, unknown>> = fc
  .tuple(identityArb, displayNameArb, roleOrAbsenceArb, membershipStateArb)
  .map(([squadId, name, role, state]) => ({ squadId, name, role, state }));

const squadMemberElementArb: fc.Arbitrary<Record<string, unknown>> = fc
  .tuple(
    identityArb,
    displayNameArb,
    roleOrAbsenceArb,
    membershipStateArb,
    fc.boolean(),
    appearanceCountArb,
    ratingStateOrAbsenceArb,
  )
  .map(
    ([
      membershipId,
      displayName,
      role,
      state,
      isGuest,
      appearances,
      ratingState,
    ]) => ({
      membershipId,
      displayName,
      role,
      state,
      isGuest,
      appearances,
      ratingState,
    }),
  );

const featureFlagElementArb: fc.Arbitrary<Record<string, unknown>> = fc
  .tuple(fc.constantFrom(...SQUAD_FEATURE_NAMES), fc.boolean())
  .map(([feature, isEnabled]) => ({ feature, isEnabled }));

const inviteSummaryElementArb: fc.Arbitrary<Record<string, unknown>> = fc
  .tuple(
    identityArb,
    fc.constantFrom(...INVITE_STATE_NAMES),
    isoInstantArb,
    displayNameArb,
    fc.option(isoInstantArb, { nil: null }),
  )
  .map(([inviteId, state, createdAt, createdBy, expiresAt]) => ({
    inviteId,
    state,
    createdAt,
    createdBy,
    expiresAt,
  }));

const leaderboardEntryElementArb: fc.Arbitrary<Record<string, unknown>> = fc
  .tuple(identityArb, displayNameArb, leaderboardValueArb)
  .map(([membershipId, displayName, value]) => ({
    membershipId,
    displayName,
    value,
  }));

/* -------------------------------------------------------------------------- */
/* Fully-populated predicates, per shape                                      */
/* -------------------------------------------------------------------------- */

function isPopulatedSummary(summary: SquadSummary): boolean {
  return (
    keySignature(summary) === 'name,role,squadId,state' &&
    typeof summary.squadId === 'string' &&
    typeof summary.name === 'string' &&
    (summary.role === null || SQUAD_ROLE_NAMES.includes(summary.role)) &&
    (summary.state === null || MEMBERSHIP_STATE_NAMES.includes(summary.state))
  );
}

function isPopulatedMember(member: SquadMember): boolean {
  return (
    keySignature(member) ===
      'appearances,displayName,isGuest,membershipId,ratingState,role,state' &&
    typeof member.membershipId === 'string' &&
    typeof member.displayName === 'string' &&
    (member.role === null || SQUAD_ROLE_NAMES.includes(member.role)) &&
    MEMBERSHIP_STATE_NAMES.includes(member.state) &&
    typeof member.isGuest === 'boolean' &&
    Number.isInteger(member.appearances) &&
    member.appearances >= 0 &&
    (member.ratingState === null ||
      RATING_STATE_NAMES.includes(member.ratingState))
  );
}

function isPopulatedFlag(flag: FeatureFlag): boolean {
  return (
    keySignature(flag) === 'feature,isEnabled' &&
    SQUAD_FEATURE_NAMES.includes(flag.feature) &&
    typeof flag.isEnabled === 'boolean'
  );
}

function isPopulatedInvite(summary: InviteSummary): boolean {
  return (
    keySignature(summary) ===
      'createdAtMs,createdBy,expiresAtMs,inviteId,state' &&
    typeof summary.inviteId === 'string' &&
    INVITE_STATE_NAMES.includes(summary.state) &&
    Number.isFinite(summary.createdAtMs) &&
    (summary.createdBy === null || typeof summary.createdBy === 'string') &&
    (summary.expiresAtMs === null || Number.isFinite(summary.expiresAtMs))
  );
}

function isPopulatedEntry(entry: DisplayRatingEntry): boolean {
  return (
    keySignature(entry) === 'displayName,membershipId,value' &&
    typeof entry.membershipId === 'string' &&
    typeof entry.displayName === 'string' &&
    Number.isFinite(entry.value)
  );
}

/* -------------------------------------------------------------------------- */
/* The shapes                                                                 */
/* -------------------------------------------------------------------------- */

/** The squad a `GetSquad` body is built around while its collections vary. */
const SQUAD_DETAIL_FRAME = {
  squadId: WELL_FORMED_IDENTITY,
  name: 'Thursday Eight',
} as const;

/**
 * Every collection a Response_Parser of this feature reads, as a table.
 *
 * Five modules, six collections: the squad detail body carries two, and they are
 * stated separately because they are read by different element parsers and their
 * duplicate rules differ.
 */
const SHAPES: readonly CollectionShape[] = [
  shapeOf<readonly SquadSummary[], SquadSummary>({
    label: 'the ListMySquads body',
    collectionPath: 'the body itself',
    elementArb: squadSummaryElementArb,
    // The squad name is free-form, so it carries the order witness.
    stamp: (element, index) => ({ ...element, name: `#${index}` }),
    corruptionArb: corruptionsOf({
      elementArb: squadSummaryElementArb,
      requiredKeys: ['squadId', 'name'],
      mistypedArb: fc.oneof(
        fc.tuple(fc.constant('squadId'), notAnIdentityArb),
        fc.tuple(fc.constant('name'), notAStringArb),
        // `role` and `state` are *valid absences* here, so only a present value
        // outside the generated union is a corruption (16.8, 12.8).
        fc.tuple(fc.constant('role'), outsideUnionArb(SQUAD_ROLE_NAMES)),
        fc.tuple(fc.constant('state'), outsideUnionArb(MEMBERSHIP_STATE_NAMES)),
      ),
    }),
    parseElement: parseSquadSummary,
    parseBody: (elements) => parseSquadSummaryList(elements),
    collectionOf: (summaries) => summaries,
    witnessOfWire: (element) => String(element.name),
    witnessOfParsed: (summary) => summary.name,
    isPopulatedElement: isPopulatedSummary,
  }),

  shapeOf<SquadDetail, SquadMember>({
    label: 'the GetSquad body members',
    collectionPath: '`members`',
    elementArb: squadMemberElementArb,
    stamp: (element, index) => ({ ...element, displayName: `#${index}` }),
    corruptionArb: corruptionsOf({
      elementArb: squadMemberElementArb,
      requiredKeys: [
        'membershipId',
        'displayName',
        'state',
        'isGuest',
        'appearances',
      ],
      mistypedArb: fc.oneof(
        fc.tuple(fc.constant('membershipId'), notAnIdentityArb),
        fc.tuple(fc.constant('displayName'), notAStringArb),
        fc.tuple(fc.constant('role'), outsideUnionArb(SQUAD_ROLE_NAMES)),
        fc.tuple(fc.constant('state'), outsideUnionArb(MEMBERSHIP_STATE_NAMES)),
        fc.tuple(fc.constant('isGuest'), notABooleanArb),
        fc.tuple(fc.constant('appearances'), notACountArb),
        fc.tuple(
          fc.constant('ratingState'),
          outsideUnionArb(RATING_STATE_NAMES),
        ),
      ),
    }),
    parseElement: parseSquadMember,
    parseBody: (elements) =>
      parseSquadDetail({
        ...SQUAD_DETAIL_FRAME,
        members: elements,
        features: [],
      }),
    collectionOf: (detail) => detail.members,
    witnessOfWire: (element) => String(element.displayName),
    witnessOfParsed: (member) => member.displayName,
    isPopulatedElement: isPopulatedMember,
  }),

  shapeOf<SquadDetail, FeatureFlag>({
    label: 'the GetSquad body features',
    collectionPath: '`features`',
    elementArb: featureFlagElementArb,
    // A Feature_Flag has no free-form field: the feature union has one member and
    // `isEnabled` is a boolean. So the enabled flag is the strongest order witness
    // this shape admits, and the duplicate-carrying assertion below covers the
    // case it cannot distinguish.
    stamp: (element) => element,
    corruptionArb: corruptionsOf({
      elementArb: featureFlagElementArb,
      requiredKeys: ['feature', 'isEnabled'],
      mistypedArb: fc.oneof(
        fc.tuple(fc.constant('feature'), outsideUnionArb(SQUAD_FEATURE_NAMES)),
        fc.tuple(fc.constant('isEnabled'), notABooleanArb),
      ),
    }),
    parseElement: parseFeatureFlag,
    parseBody: (elements) =>
      parseSquadDetail({
        ...SQUAD_DETAIL_FRAME,
        members: [],
        features: elements,
      }),
    collectionOf: (detail) => detail.features,
    witnessOfWire: (element) => String(element.isEnabled),
    witnessOfParsed: (flag) => String(flag.isEnabled),
    isPopulatedElement: isPopulatedFlag,
  }),

  shapeOf<DisplayRatingLeaderboard, DisplayRatingEntry>({
    label: 'the GetSquadLeaderboard body',
    collectionPath: '`entries`',
    elementArb: leaderboardEntryElementArb,
    // Distinct identities by construction: a repeated membership identity fails
    // this body by design (8.11), and that decision is asserted separately below
    // rather than tripped over here.
    stamp: (element, index) => ({
      ...element,
      membershipId: identityForIndex(index),
      displayName: `#${index}`,
    }),
    corruptionArb: corruptionsOf({
      elementArb: leaderboardEntryElementArb,
      requiredKeys: ['membershipId', 'displayName', 'value'],
      mistypedArb: fc.oneof(
        fc.tuple(fc.constant('membershipId'), notAnIdentityArb),
        fc.tuple(fc.constant('displayName'), notAStringArb),
        fc.tuple(fc.constant('value'), notAFiniteNumberArb),
      ),
    }),
    parseElement: parseDisplayRatingEntry,
    parseBody: (elements) => parseDisplayRatingLeaderboard({ entries: elements }),
    collectionOf: (leaderboard) => leaderboard.entries,
    witnessOfWire: (element) => String(element.displayName),
    witnessOfParsed: (entry) => entry.displayName,
    isPopulatedElement: isPopulatedEntry,
  }),

  shapeOf<readonly InviteSummary[], InviteSummary>({
    label: 'the ListInvites body',
    collectionPath: 'the body itself',
    elementArb: inviteSummaryElementArb,
    // `createdBy` is a free-form audit actor string, so it carries the witness.
    stamp: (element, index) => ({ ...element, createdBy: `#${index}` }),
    corruptionArb: corruptionsOf({
      elementArb: inviteSummaryElementArb,
      requiredKeys: ['inviteId', 'state', 'createdAt'],
      mistypedArb: fc.oneof(
        fc.tuple(fc.constant('inviteId'), notAnIdentityArb),
        fc.tuple(fc.constant('state'), outsideUnionArb(INVITE_STATE_NAMES)),
        fc.tuple(fc.constant('createdAt'), notAnInstantArb),
        // Both of these are valid absences, so only a present-but-malformed
        // value is a corruption.
        fc.tuple(fc.constant('createdBy'), presentOnly(notAStringArb)),
        fc.tuple(fc.constant('expiresAt'), presentOnly(notAnInstantArb)),
      ),
    }),
    parseElement: parseInviteSummary,
    parseBody: (elements) => parseInviteSummaryList(elements),
    collectionOf: (summaries) => summaries,
    witnessOfWire: (element) => String(element.createdBy),
    witnessOfParsed: (summary) => String(summary.createdBy),
    isPopulatedElement: isPopulatedInvite,
  }),

  shapeOf<readonly FeatureFlag[], FeatureFlag>({
    label: 'the GetFeatureFlags body',
    collectionPath: 'the body itself',
    elementArb: featureFlagElementArb,
    stamp: (element) => element,
    corruptionArb: corruptionsOf({
      elementArb: featureFlagElementArb,
      requiredKeys: ['feature', 'isEnabled'],
      mistypedArb: fc.oneof(
        fc.tuple(fc.constant('feature'), outsideUnionArb(SQUAD_FEATURE_NAMES)),
        fc.tuple(fc.constant('isEnabled'), notABooleanArb),
      ),
    }),
    parseElement: parseFeatureFlag,
    parseBody: (elements) => parseFeatureFlags(elements),
    collectionOf: (flags) => flags,
    witnessOfWire: (element) => String(element.isEnabled),
    witnessOfParsed: (flag) => String(flag.isEnabled),
    isPopulatedElement: isPopulatedFlag,
  }),
];

/* -------------------------------------------------------------------------- */
/* Non-vacuity: the table covers what it claims to                            */
/* -------------------------------------------------------------------------- */

// Feature: api-response-contracts, Property 23: A parse failure is all-or-nothing
// Validates: Requirements 12.7
describe('all-or-nothing — the table of collection-bearing parsers', () => {
  it('quantifies over every collection the squads parsers read', () => {
    // The floor that keeps the quantifier honest. Five modules carry a
    // collection and the squad detail carries two of them, so six rows is the
    // whole of the feature's collection surface today — a seventh collection
    // should arrive here as a row rather than as an untested parser.
    expect(SHAPES.length).toBeGreaterThanOrEqual(6);
    expect(SHAPES.map((shape) => shape.label)).toStrictEqual([
      'the ListMySquads body',
      'the GetSquad body members',
      'the GetSquad body features',
      'the GetSquadLeaderboard body',
      'the ListInvites body',
      'the GetFeatureFlags body',
    ]);
    expect(new Set(SHAPES.map((shape) => shape.label)).size).toBe(SHAPES.length);
  });

  it('generates acceptable elements, so the positive half is not vacuous', () => {
    fc.assert(
      fc.property(
        fc
          .constantFrom(...SHAPES)
          .chain((shape) =>
            shape
              .collectionArb(1, 6)
              .map((elements) => ({ shape, elements }) as const),
          ),
        ({ shape, elements }) => {
          // Every generated element parses in its own right. Were a generator to
          // drift outside what its parser accepts, the "an uncorrupted body
          // succeeds" half below would start failing for a reason that has
          // nothing to do with the property.
          expect(elements.every((element) => shape.elementParses(element))).toBe(
            true,
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Property 23, stated once and run per collection                            */
/* -------------------------------------------------------------------------- */

/**
 * Property 23 for one collection-bearing parser.
 *
 * @param shape the parser, its element generator, and the path its collection
 *   sits at — see {@link SHAPES}
 */
function describeAllOrNothing(shape: CollectionShape): void {
  // Feature: api-response-contracts, Property 23: A parse failure is all-or-nothing
  // Validates: Requirements 12.7
  describe(`all-or-nothing — ${shape.label} (${shape.collectionPath})`, () => {
    it('parses an uncorrupted collection of any length, in order and entire', () => {
      fc.assert(
        fc.property(shape.collectionArb(0, 12), (elements) => {
          const outcome = shape.parse(elements);

          // The positive half. Without it, a parser that failed every body would
          // satisfy the negative half below completely.
          expect(outcome.ok).toBe(true);

          if (!outcome.ok) {
            return;
          }

          // Exactly as many elements as were sent, in exactly the order they were
          // sent in — not "at least as many", and not "the same set".
          expect(outcome.length).toBe(elements.length);
          expect(outcome.witnesses).toStrictEqual(
            elements.map(shape.witnessOfWire),
          );
        }),
        { numRuns: 300 },
      );
    });

    it('parses an empty, a singleton, and a long collection', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            shape.collectionArb(0, 0),
            shape.collectionArb(1, 1),
            shape.collectionArb(2, 2),
            shape.collectionArb(25, 25),
          ),
          (elements) => {
            const outcome = shape.parse(elements);

            // A fold that mishandled an empty or a singleton collection is the
            // defect a mid-sized random array misses, so the edges are named.
            expect(outcome.ok).toBe(true);

            if (outcome.ok) {
              expect(outcome.length).toBe(elements.length);
            }
          },
        ),
        { numRuns: 200 },
      );
    });

    it('fails the whole body when one member is corrupted, yielding no value', () => {
      fc.assert(
        fc.property(
          shape.collectionArb(1, 12),
          fc.nat(),
          shape.corruptionArb,
          (elements, offset, corrupted) => {
            const index = offset % elements.length;

            // The corruption is unacceptable in its own right. This is the
            // precondition of the property, not an incidental check: a generator
            // that produced an acceptable element would make the assertion below
            // false for a good reason, and a generator that produced one *only
            // sometimes* would make this file flaky rather than wrong.
            expect(shape.elementParses(corrupted)).toBe(false);

            // The same collection, uncorrupted, parses to all of its members —
            // so the failure below is caused by the one corrupted member and by
            // nothing else about the body.
            const clean = shape.parse(elements);

            expect(clean.ok).toBe(true);

            if (clean.ok) {
              expect(clean.length).toBe(elements.length);
            }

            const corruptedBody: unknown[] = [...elements];
            corruptedBody[index] = corrupted;

            // 12.7: the whole body fails. `shape.parse` has already asserted the
            // harder half — the result carries a reason and no `value` property
            // at all, so there is no collection of `n - 1` members anywhere in
            // it. One unacceptable member cannot silently drop a player from a
            // squad list, because nothing is returned to drop them from.
            expect(shape.parse(corruptedBody).ok).toBe(false);
          },
        ),
        { numRuns: 600 },
      );
    });

    it('fails wherever the corruption sits — first, middle, or last', () => {
      fc.assert(
        fc.property(
          shape.collectionArb(3, 9),
          shape.corruptionArb,
          (elements, corrupted) => {
            // A parser that validated only the head, or stopped short of the
            // tail, would pass a random-index test often enough to look green.
            const positions = [
              0,
              Math.floor(elements.length / 2),
              elements.length - 1,
            ];

            for (const index of positions) {
              const body: unknown[] = [...elements];
              body[index] = corrupted;

              expect(shape.parse(body).ok).toBe(false);
            }
          },
        ),
        { numRuns: 300 },
      );
    });

    it('fails once for every corrupted member, however many there are', () => {
      fc.assert(
        fc.property(
          shape.collectionArb(2, 10),
          fc.array(shape.corruptionArb, { minLength: 2, maxLength: 4 }),
          (elements, corruptions) => {
            // All-or-nothing says nothing about *how many* members are bad: a
            // body with two bad members must fail exactly as flatly as a body
            // with one, rather than returning the members that happened to be
            // acceptable.
            const body: unknown[] = [...elements];

            corruptions.forEach((corrupted, position) => {
              body[position % body.length] = corrupted;
            });

            expect(shape.parse(body).ok).toBe(false);
          },
        ),
        { numRuns: 300 },
      );
    });
  });
}

for (const shape of SHAPES) {
  describeAllOrNothing(shape);
}

/* -------------------------------------------------------------------------- */
/* The one deliberate asymmetry: duplicates                                   */
/* -------------------------------------------------------------------------- */

/**
 * Two collections of this feature treat a repeated member differently. Both
 * decisions are asserted here, in one place, so that neither drifts into the
 * other — and so that a reader who finds the inconsistency surprising finds the
 * reason beside it rather than having to infer one.
 */
// Feature: api-response-contracts, Property 23: A parse failure is all-or-nothing
// Validates: Requirements 12.7
describe('all-or-nothing — a repeated member, where it decides something and where it does not', () => {
  it('fails a leaderboard body carrying a duplicated membership identity', () => {
    fc.assert(
      fc.property(
        fc.array(leaderboardEntryElementArb, { minLength: 2, maxLength: 8 }),
        fc.nat(),
        fc.nat(),
        (generated, keptOffset, repeatedOffset) => {
          const entries = generated.map((entry, index) => ({
            ...entry,
            membershipId: identityForIndex(index),
            displayName: `#${index}`,
          }));

          const kept = keptOffset % entries.length;
          const repeated =
            kept === repeatedOffset % entries.length
              ? (kept + 1) % entries.length
              : repeatedOffset % entries.length;

          // Distinct identities parse; the duplication is the only difference
          // between the two bodies below.
          expect(parseDisplayRatingLeaderboard({ entries }).ok).toBe(true);

          const ambiguous = [...entries];
          ambiguous[repeated] = {
            ...ambiguous[repeated],
            membershipId: entries[kept].membershipId,
          };

          const outcome = parseDisplayRatingLeaderboard({ entries: ambiguous });

          // 8.11: two entries for one membership make that person's rating
          // ambiguous, and there is no defensible way to choose between them —
          // so no player gets a rating derived from the body. Note that this is
          // still all-or-nothing: the parser yields *no* leaderboard rather than
          // a de-duplicated one, and every row degrades to Rating_Unavailable.
          expect(outcome.ok).toBe(false);
          expect('value' in outcome).toBe(false);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('carries a duplicated feature flag, in both readers of the shape', () => {
    fc.assert(
      fc.property(
        fc.array(featureFlagElementArb, { minLength: 1, maxLength: 4 }),
        fc.nat(),
        (flags, offset) => {
          const repeated = offset % flags.length;
          const withDuplicate = [...flags, flags[repeated]];

          const standalone = parseFeatureFlags(withDuplicate);

          // A repeated flag decides nothing about anybody: the toggle surface
          // renders what the collection carries. So this is *not* the leaderboard
          // case, and it is not a weakening of all-or-nothing either — every
          // element sent comes back, including the repeat.
          expect(standalone.ok).toBe(true);

          if (standalone.ok) {
            expect(standalone.value.length).toBe(withDuplicate.length);
            expect(standalone.value.map((flag) => flag.feature)).toStrictEqual(
              withDuplicate.map((flag) => flag.feature),
            );
          }

          // The same collection read through the squad detail body, since both
          // operations share the element shape and must agree about it.
          const nested = parseSquadDetail({
            ...SQUAD_DETAIL_FRAME,
            members: [],
            features: withDuplicate,
          });

          expect(nested.ok).toBe(true);

          if (nested.ok) {
            expect(nested.value.features.length).toBe(withDuplicate.length);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
