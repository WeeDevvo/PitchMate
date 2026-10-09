import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  FULL_PROFILE_FIXTURE,
  PROFILE_FIXTURE_ARBS,
  fullyPopulatedRichStatsFixtureArb,
  playerProfileFixtureArb,
  presentRichBlockFixture,
  profileFixtureArb,
  singletonCollectionsProfileFixtureArb,
  type PlayerProfileFixture,
} from '../../testing/playerProfileFixtures';
import { isMembershipState, isRatingState } from '../wireEnums';
import {
  parseCoAppearanceEntry,
  parsePairedStatEntry,
  parsePlayerProfile,
  parsePlayerRecord,
  parseProgressionPoint,
  parseRatingSummary,
  parseRichStats,
  type PlayerProfile,
} from './playerProfile';
import {
  readArray,
  readBoolean,
  readCount,
  readDurationMs,
  readInstantMs,
  readNumber,
  readOptional,
  readPercentage,
  readString,
  readUuid,
  readWireEnumName,
  type ParseResult,
} from './primitives';

/**
 * Property 7: one malformed member fails the whole body.
 *
 * The companion to Property 6. Property 6 says what an **accepted** body
 * yields; this one says what happens when a single member of an otherwise valid
 * body carries a value its reader rejects — the parse fails, and it yields no
 * value (Requirement 13.3).
 *
 * ## Why "no value" is the whole of the claim
 *
 * The tempting alternative is a parser that salvages what it can: skip the one
 * row it could not read, default the one count that arrived as a string, and
 * hand back the rest. It would look generous and it would be the worst outcome
 * available, because a dropped row and a defaulted figure are indistinguishable
 * on screen from data the backend sent. "Most played with" missing the person
 * you have played with most is a wrong answer presented confidently; a
 * `winStreak` read as `0` because it arrived as `'4'` erases a run with nothing
 * saying so. The Generic_Profile_Failure with a retry is less information and
 * more honesty.
 *
 * So the assertion is not merely `ok === false`. Every rejected body is checked
 * to yield a result carrying **exactly** `ok` and `reason` — no `value` key at
 * all, so there is no half-profile for a caller to render beside the failure,
 * and no partial collection to fall back on.
 *
 * ## The mutation is single, and it is genuinely rejected
 *
 * Each case starts from a generated **valid** body — the shared fixtures of
 * `testing/playerProfileFixtures.ts`, the same set Properties 6 and 8 through 14
 * quantify over — and replaces exactly one member of it. Every target names the
 * reader that member goes through, and the non-vacuity suite at the foot of this
 * file asserts both halves of the setup independently of the parser:
 *
 *  1. the unmutated body parses, so the body really was valid; and
 *  2. every value a target generates is rejected by **that member's own
 *     reader**, so the mutation really is malformed.
 *
 * Without the second check the property would be satisfied by generators that
 * produced perfectly valid replacements and a parser that failed everything.
 *
 * ## The five collections, at three indices each
 *
 * A fold over a collection is where "skip the bad one" creeps in, and where it
 * creeps in position-dependently: an implementation that fails on the first
 * element may still drop the last, and one that checks `index > 0` passes every
 * single-element test. So each of `mostPlayedWith`, `mostPlayedAgainst`,
 * `bestPartnerships`, `bogeyOpponents`, and `progression` is mutated at its
 * **first**, a **middle**, and its **last** index, over bodies whose collections
 * carry at least three elements so the three are distinct, and again over
 * single-element collections where they coincide.
 *
 * Both kinds of collection damage are covered: one member of one element made
 * malformed, and the whole element replaced by something that is not an object.
 *
 * React-free and DOM-free, like every module under `lib/`.
 *
 * **Validates: Requirements 13.3**
 */

/* -------------------------------------------------------------------------- */
/* Values the readers reject                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The two spellings of an absence, as replacement values.
 *
 * Added to a **required** member's rejected set, where an absence is a failure,
 * and withheld from every declared-optional member's set, where it is an
 * accepted reading (Requirement 13.6 — Property 8's subject, not this one's).
 * A property set to `undefined` is the same thing to a reader as a property that
 * was never there: `readProperty` yields `undefined` for both.
 */
const ABSENT_VALUES: readonly unknown[] = [null, undefined];

/** Values `readUuid` rejects: everything but the 36-character hyphenated form. */
const NON_IDENTITY_VALUES: readonly unknown[] = [
  // The three near-misses `lib/identifiers.ts` names by hand.
  '018f3a2b4c5d7e6f8a9b0c1d2e3f4a5b',
  '{018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b}',
  ' 018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b',
  'urn:uuid:018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b',
  // Right length, wrong alphabet; and the wrong length either way.
  '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3g4a5b',
  '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5',
  '',
  // Not a string at all.
  0,
  1,
  true,
  [],
  {},
  ['018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b'],
];

/** Values `readString` rejects: every non-string. */
const NON_STRING_VALUES: readonly unknown[] = [
  0,
  -1,
  1.5,
  true,
  false,
  [],
  ['Dave'],
  {},
  { value: 'Dave' },
];

/** Values `readBoolean` rejects — the truthy and falsy lookalikes included. */
const NON_BOOLEAN_VALUES: readonly unknown[] = [
  0,
  1,
  'true',
  'false',
  '',
  [],
  {},
];

/**
 * Values `readCount` rejects: a fraction, a negative, a non-finite number, a
 * string-encoded count, and every non-number.
 *
 * None of them is rounded or clamped into a figure a person would believe
 * (Requirement 13.2) — `2.5` appearances must fail the body, not render as `3`.
 */
const NON_COUNT_VALUES: readonly unknown[] = [
  2.5,
  -0.5,
  -1,
  -2,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  '12',
  '0',
  true,
  false,
  [],
  [3],
  {},
];

/**
 * Values `readPercentage` rejects: outside the closed range 0.0 to 100.0, not
 * finite, string-encoded, or not a number.
 *
 * `100.1` is the one that matters most: clamped to `100` it would present a
 * perfect record for a membership that has lost matches.
 */
const NON_PERCENTAGE_VALUES: readonly unknown[] = [
  -0.1,
  -1,
  100.1,
  1_000,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  '50',
  '0',
  true,
  false,
  [],
  [50],
  {},
];

/** Values `readNumber` rejects: non-finite, string-encoded, or not a number. */
const NON_NUMBER_VALUES: readonly unknown[] = [
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  '1200',
  '0',
  '',
  true,
  false,
  [],
  [1_200],
  {},
  { value: 1_200 },
];

/** Values `readObject` rejects — an array among them: a list is not a block. */
const NON_OBJECT_VALUES: readonly unknown[] = [
  '',
  'record',
  0,
  1,
  true,
  false,
  [],
  [{}],
];

/** Values `readArray` rejects, including an array-like object. */
const NON_ARRAY_VALUES: readonly unknown[] = [
  {},
  { length: 0 },
  { 0: {}, length: 1 },
  '',
  'list',
  0,
  1,
  true,
  false,
];

/** Values no `MembershipState` name test admits — the other union's included. */
const NON_MEMBERSHIP_STATE_VALUES: readonly unknown[] = [
  'active',
  'ACTIVE',
  ' Active',
  'Active ',
  'Settled',
  'Provisional',
  '',
  0,
  1,
  true,
  [],
  ['Active'],
  {},
];

/** Values no `RatingState` name test admits — the other union's included. */
const NON_RATING_STATE_VALUES: readonly unknown[] = [
  'provisional',
  'PROVISIONAL',
  ' Established',
  'Established ',
  'Settled',
  'Active',
  '',
  0,
  1,
  true,
  [],
  ['Provisional'],
  {},
];

/**
 * Values `readInstantMs` rejects: a local time naming no instant, an impossible
 * calendar day, an out-of-range offset, epoch milliseconds as a number, and
 * every other shape.
 */
const NON_INSTANT_VALUES: readonly unknown[] = [
  '2026-01-01T00:00:00',
  '2026-01-01',
  '2026-02-30T00:00:00Z',
  '2026-13-01T00:00:00Z',
  '2026-01-01T24:00:00Z',
  '2026-01-01T00:00:00+25:00',
  'now',
  '',
  1_767_225_600_000,
  0,
  true,
  [],
  {},
];

/**
 * Values `readDurationMs` rejects: the negative form, a one-digit hour field, a
 * truncated clock, a fraction finer than seven digits, another notation
 * entirely, and a number of milliseconds (accepting both forms would make the
 * printer ambiguous).
 */
const NON_DURATION_VALUES: readonly unknown[] = [
  '-00:01:00',
  '-1.00:00:00',
  '0:01:00',
  '00:01',
  '1.00:00:00.12345678',
  'PT1H',
  '',
  3_600_000,
  0,
  true,
  [],
  {},
];

/* -------------------------------------------------------------------------- */
/* Naming the reader a member goes through                                    */
/* -------------------------------------------------------------------------- */

/** A reader of one unknown value, as every reader of `primitives.ts` is shaped. */
type LabelledReader = (value: unknown, label: string) => ParseResult<unknown>;

/**
 * Whether the member's own reader rejects a value — the non-vacuity test each
 * target carries.
 *
 * Named per target rather than inferred from the parser, because the question
 * "is this replacement actually malformed?" must be answerable without asking
 * the parser under test.
 */
function rejectedBy(reader: LabelledReader): (value: unknown) => boolean {
  return (value) => !reader(value, 'the member under test').ok;
}

/** A declared-optional member's reader: an absence, or a reading of `reader`. */
function optional(reader: LabelledReader): LabelledReader {
  return (value, label) => readOptional(value, label, reader);
}

/** The `MembershipState` name reader. */
const membershipStateReader: LabelledReader = (value, label) =>
  readWireEnumName(value, label, isMembershipState);

/** The `RatingState` name reader. */
const ratingStateReader: LabelledReader = (value, label) =>
  readWireEnumName(value, label, isRatingState);

/* -------------------------------------------------------------------------- */
/* Mutating one member of a valid body                                        */
/* -------------------------------------------------------------------------- */

/** The four Pairwise_Sections. */
type PairwiseKey =
  | 'mostPlayedWith'
  | 'mostPlayedAgainst'
  | 'bestPartnerships'
  | 'bogeyOpponents';

/** Every collection of the body whose elements this suite mutates. */
type CollectionKey = PairwiseKey | 'progression';

/** The two Pairwise_Sections of co-appearance rows. */
const CO_APPEARANCE_KEYS: readonly PairwiseKey[] = [
  'mostPlayedWith',
  'mostPlayedAgainst',
];

/** The two Pairwise_Sections of paired statistics. */
const PAIRED_STAT_KEYS: readonly PairwiseKey[] = [
  'bestPartnerships',
  'bogeyOpponents',
];

/** A nested block of the body this suite mutates a member of. */
type BlockKey = 'record' | 'rating' | 'rich';

/** The body with exactly one top-level member replaced. */
function withTopLevelMember(
  fixture: PlayerProfileFixture,
  key: string,
  value: unknown,
): unknown {
  return { ...fixture.wire, [key]: value };
}

/** The body with exactly one member of one nested block replaced. */
function withBlockMember(
  fixture: PlayerProfileFixture,
  block: BlockKey,
  key: string,
  value: unknown,
): unknown {
  const original = fixture.wire[block];

  expect(typeof original, `the fixture carries a \`${block}\` block`).toBe(
    'object',
  );
  expect(original).not.toBeNull();

  return {
    ...fixture.wire,
    [block]: { ...(original as Record<string, unknown>), [key]: value },
  };
}

/**
 * One element's wire form, taken from the fixture's own `parts` rather than cast
 * back out of the assembled body — the fixtures expose the sub-fixtures a body
 * was built from precisely so a single element can be reached without
 * re-deriving it.
 */
function elementWireAt(
  fixture: PlayerProfileFixture,
  collection: CollectionKey,
  index: number,
): Record<string, unknown> {
  switch (collection) {
    case 'mostPlayedWith':
      return fixture.parts.mostPlayedWith[index].wire;
    case 'mostPlayedAgainst':
      return fixture.parts.mostPlayedAgainst[index].wire;
    case 'bestPartnerships':
      return fixture.parts.bestPartnerships[index].wire;
    case 'bogeyOpponents':
      return fixture.parts.bogeyOpponents[index].wire;
    case 'progression':
      return fixture.parts.progression[index].wire;
  }
}

/** How many elements one collection of a body carries. */
function collectionLength(
  fixture: PlayerProfileFixture,
  collection: CollectionKey,
): number {
  return fixture.parts[collection].length;
}

/** The body with exactly one element of one collection replaced. */
function withElementAt(
  fixture: PlayerProfileFixture,
  collection: CollectionKey,
  index: number,
  value: unknown,
): unknown {
  const elements = fixture.wire[collection];

  expect(Array.isArray(elements)).toBe(true);

  return {
    ...fixture.wire,
    [collection]: (elements as readonly unknown[]).map((element, at) =>
      at === index ? value : element,
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* The index positions a collection is damaged at                             */
/* -------------------------------------------------------------------------- */

/** The three index positions of a non-empty collection. */
const POSITIONS = ['first', 'middle', 'last'] as const;

/** One of the three index positions. */
type Position = (typeof POSITIONS)[number];

/** The index a position names in a collection of the given length. */
function indexAt(position: Position, length: number): number {
  switch (position) {
    case 'first':
      return 0;
    case 'middle':
      return Math.floor((length - 1) / 2);
    case 'last':
      return length - 1;
  }
}

/* -------------------------------------------------------------------------- */
/* The bodies the mutations are applied to                                    */
/* -------------------------------------------------------------------------- */

/**
 * Valid bodies carrying a present `rich` block with every member populated —
 * the only bodies on which a `rich` member is there to be damaged.
 */
const richPopulatedBodyArb: fc.Arbitrary<PlayerProfileFixture> =
  playerProfileFixtureArb({
    rich: fullyPopulatedRichStatsFixtureArb.map((rich) =>
      presentRichBlockFixture(rich),
    ),
  });

/**
 * Valid bodies whose every collection carries at least three elements, so that
 * the first, a middle, and the last index are three distinct positions.
 */
const multiElementBodyArb: fc.Arbitrary<PlayerProfileFixture> =
  playerProfileFixtureArb({
    pairwise: { minLength: 3, maxLength: 9 },
    progression: { minLength: 3, maxLength: 11 },
  });

/* -------------------------------------------------------------------------- */
/* The targets: every member, and the reader it goes through                  */
/* -------------------------------------------------------------------------- */

/** One member of the body, and the values its own reader rejects. */
interface MemberTarget {
  /** Where the member sits, for the test name and the failure message. */
  readonly label: string;
  /** Values the member's own reader rejects. */
  readonly rejected: fc.Arbitrary<unknown>;
  /** Whether the member's own reader rejects a value. */
  readonly rejects: (value: unknown) => boolean;
  /** Valid bodies this member can be damaged in. */
  readonly bodies: fc.Arbitrary<PlayerProfileFixture>;
  /** The body with exactly this member replaced. */
  readonly mutate: (fixture: PlayerProfileFixture, value: unknown) => unknown;
}

/** A top-level member of the body. */
function topLevelTarget(
  key: string,
  reader: LabelledReader,
  values: readonly unknown[],
  bodies: fc.Arbitrary<PlayerProfileFixture> = profileFixtureArb,
): MemberTarget {
  return {
    label: key,
    rejected: fc.constantFrom<unknown>(...values),
    rejects: rejectedBy(reader),
    bodies,
    mutate: (fixture, value) => withTopLevelMember(fixture, key, value),
  };
}

/** A member of one of the three nested blocks. */
function blockTarget(
  block: BlockKey,
  key: string,
  reader: LabelledReader,
  values: readonly unknown[],
  bodies: fc.Arbitrary<PlayerProfileFixture> = profileFixtureArb,
): MemberTarget {
  return {
    label: `${block}.${key}`,
    rejected: fc.constantFrom<unknown>(...values),
    rejects: rejectedBy(reader),
    bodies,
    mutate: (fixture, value) => withBlockMember(fixture, block, key, value),
  };
}

/**
 * Every scalar and block member of the body, with the reader it goes through.
 *
 * A required member's rejected set carries both spellings of an absence; a
 * declared-optional member's does not, because an absence is an accepted
 * reading there and a *present but malformed* value is what fails it.
 */
const MEMBER_TARGETS: readonly MemberTarget[] = [
  // --- Required top-level members -------------------------------------------
  topLevelTarget('membershipId', readUuid, [
    ...NON_IDENTITY_VALUES,
    ...ABSENT_VALUES,
  ]),
  topLevelTarget('displayName', readString, [
    ...NON_STRING_VALUES,
    ...ABSENT_VALUES,
  ]),
  topLevelTarget('isGuest', readBoolean, [
    ...NON_BOOLEAN_VALUES,
    ...ABSENT_VALUES,
  ]),
  topLevelTarget('record', (value) => parsePlayerRecord(value), [
    ...NON_OBJECT_VALUES,
    ...ABSENT_VALUES,
  ]),
  topLevelTarget('rating', (value) => parseRatingSummary(value), [
    ...NON_OBJECT_VALUES,
    ...ABSENT_VALUES,
  ]),
  topLevelTarget('progression', readArray, [
    ...NON_ARRAY_VALUES,
    ...ABSENT_VALUES,
  ]),
  topLevelTarget('winStreak', readCount, [
    ...NON_COUNT_VALUES,
    ...ABSENT_VALUES,
  ]),
  topLevelTarget('unbeatenStreak', readCount, [
    ...NON_COUNT_VALUES,
    ...ABSENT_VALUES,
  ]),
  topLevelTarget('bibAppearances', readCount, [
    ...NON_COUNT_VALUES,
    ...ABSENT_VALUES,
  ]),
  ...[...CO_APPEARANCE_KEYS, ...PAIRED_STAT_KEYS].map((key) =>
    topLevelTarget(key, readArray, [...NON_ARRAY_VALUES, ...ABSENT_VALUES]),
  ),

  // --- Declared-optional top-level members, present but malformed -----------
  topLevelTarget(
    'state',
    optional(membershipStateReader),
    NON_MEMBERSHIP_STATE_VALUES,
  ),
  topLevelTarget(
    'winPercentage',
    optional(readPercentage),
    NON_PERCENTAGE_VALUES,
  ),
  topLevelTarget(
    'rich',
    optional((value) => parseRichStats(value)),
    NON_OBJECT_VALUES,
  ),

  // --- The record block: four required counts -------------------------------
  ...['appearances', 'wins', 'draws', 'losses'].map((key) =>
    blockTarget('record', key, readCount, [
      ...NON_COUNT_VALUES,
      ...ABSENT_VALUES,
    ]),
  ),

  // --- The rating block: two declared-optional members ----------------------
  blockTarget(
    'rating',
    'state',
    optional(ratingStateReader),
    NON_RATING_STATE_VALUES,
  ),
  blockTarget(
    'rating',
    'displayRating',
    optional(readNumber),
    NON_NUMBER_VALUES,
  ),

  // --- The rich block: four independently optional members ------------------
  ...['goals', 'cleanSheets', 'goalsConcededAsKeeper'].map((key) =>
    blockTarget(
      'rich',
      key,
      optional(readCount),
      NON_COUNT_VALUES,
      richPopulatedBodyArb,
    ),
  ),
  blockTarget(
    'rich',
    'keeperTime',
    optional(readDurationMs),
    NON_DURATION_VALUES,
    richPopulatedBodyArb,
  ),
];

/* -------------------------------------------------------------------------- */
/* The targets inside the five collections                                    */
/* -------------------------------------------------------------------------- */

/** One element of one collection, and the damage done to it. */
interface ElementTarget {
  /** Where the member sits, for the test name and the failure message. */
  readonly label: string;
  /** The collection the damaged element belongs to. */
  readonly collection: CollectionKey;
  /** Values the member's own reader rejects. */
  readonly rejected: fc.Arbitrary<unknown>;
  /** Whether the member's own reader rejects a value. */
  readonly rejects: (value: unknown) => boolean;
  /** The element to put in place of the original. */
  readonly element: (
    original: Record<string, unknown>,
    value: unknown,
  ) => unknown;
}

/** One member of one element of a collection. */
function elementMemberTarget(
  collection: CollectionKey,
  key: string,
  reader: LabelledReader,
  values: readonly unknown[],
): ElementTarget {
  return {
    label: `${collection}[].${key}`,
    collection,
    rejected: fc.constantFrom<unknown>(...values),
    rejects: rejectedBy(reader),
    element: (original, value) => ({ ...original, [key]: value }),
  };
}

/** The whole element replaced by a value that is not a wire object. */
function elementShapeTarget(
  collection: CollectionKey,
  parse: (value: unknown) => ParseResult<unknown>,
): ElementTarget {
  return {
    label: `${collection}[]`,
    collection,
    rejected: fc.constantFrom<unknown>(
      ...NON_OBJECT_VALUES,
      ...ABSENT_VALUES,
    ),
    rejects: (value) => !parse(value).ok,
    element: (_original, value) => value,
  };
}

/**
 * Every element member of the five collections.
 *
 * A co-appearance row and a paired statistic row require every member they
 * carry; a progression record requires its completion instant and declares its
 * Display_Rating optional, so the instant is damaged with an absence in its set
 * and the Display_Rating only with present-but-malformed values.
 */
const ELEMENT_TARGETS: readonly ElementTarget[] = [
  ...CO_APPEARANCE_KEYS.flatMap((collection) => [
    elementMemberTarget(collection, 'membershipId', readUuid, [
      ...NON_IDENTITY_VALUES,
      ...ABSENT_VALUES,
    ]),
    elementMemberTarget(collection, 'displayName', readString, [
      ...NON_STRING_VALUES,
      ...ABSENT_VALUES,
    ]),
    elementMemberTarget(collection, 'count', readCount, [
      ...NON_COUNT_VALUES,
      ...ABSENT_VALUES,
    ]),
    elementShapeTarget(collection, parseCoAppearanceEntry),
  ]),
  ...PAIRED_STAT_KEYS.flatMap((collection) => [
    elementMemberTarget(collection, 'membershipId', readUuid, [
      ...NON_IDENTITY_VALUES,
      ...ABSENT_VALUES,
    ]),
    elementMemberTarget(collection, 'displayName', readString, [
      ...NON_STRING_VALUES,
      ...ABSENT_VALUES,
    ]),
    elementMemberTarget(collection, 'value', readPercentage, [
      ...NON_PERCENTAGE_VALUES,
      ...ABSENT_VALUES,
    ]),
    elementMemberTarget(collection, 'qualifyingMatches', readCount, [
      ...NON_COUNT_VALUES,
      ...ABSENT_VALUES,
    ]),
    elementShapeTarget(collection, parsePairedStatEntry),
  ]),
  elementMemberTarget('progression', 'completedAt', readInstantMs, [
    ...NON_INSTANT_VALUES,
    ...ABSENT_VALUES,
  ]),
  elementMemberTarget(
    'progression',
    'displayRating',
    optional(readNumber),
    NON_NUMBER_VALUES,
  ),
  elementShapeTarget('progression', parseProgressionPoint),
];

/* -------------------------------------------------------------------------- */
/* The frame: a rejected body yields a reason and nothing else                */
/* -------------------------------------------------------------------------- */

/**
 * Assert that the given body is rejected, and that the rejection carries no
 * value.
 *
 * A raise is not a parse failure — it escapes the call site and takes the
 * screen's own error handling with it (Requirement 13.1) — so it is reported as
 * a distinct fault rather than as a rejected body.
 */
function expectRejected(body: unknown, context: string): void {
  let outcome: ParseResult<PlayerProfile>;

  try {
    outcome = parsePlayerProfile(body);
  } catch (raised) {
    throw new Error(
      `the parser raised instead of settling for ${context}: ${String(raised)}`,
      { cause: raised },
    );
  }

  expect(typeof outcome).toBe('object');
  expect(outcome).not.toBeNull();
  expect(typeof outcome.ok).toBe('boolean');

  if (outcome.ok) {
    throw new Error(
      `a body whose ${context} was malformed was accepted: ${describeBody(body)}`,
    );
  }

  // The whole of Requirement 13.3's second clause: the failure is a reason and
  // nothing else, so there is no half-populated profile for a caller to render
  // a statistic out of.
  expect(Object.keys(outcome).sort().join(',')).toBe('ok,reason');
  expect('value' in outcome).toBe(false);
  expect(typeof outcome.reason).toBe('string');
  expect(outcome.reason.length).toBeGreaterThan(0);
}

/**
 * A body rendered for a failure message.
 *
 * `JSON.stringify` drops the non-finite numbers and the `undefined` members
 * this suite plants, so the shape is reported on a best-effort basis; the
 * message exists to locate a defect, not to reproduce one.
 */
function describeBody(body: unknown): string {
  try {
    return JSON.stringify(body) ?? String(body);
  } catch {
    return '[a body that cannot be rendered]';
  }
}

/** The profile a fixture's body parses to, asserted to be accepted. */
function expectAccepted(fixture: PlayerProfileFixture, context: string): void {
  const outcome = parsePlayerProfile(fixture.wire);

  if (!outcome.ok) {
    throw new Error(
      `a valid body (${context}) was rejected: ${outcome.reason} — ${describeBody(fixture.wire)}`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Property 7, over every scalar and block member                             */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 7: One malformed member fails the whole body
// Validates: Requirements 13.3
describe('one malformed member fails the whole body', () => {
  for (const target of MEMBER_TARGETS) {
    it(`fails the body when \`${target.label}\` is rejected by its reader`, () => {
      fc.assert(
        fc.property(target.bodies, target.rejected, (fixture, value) => {
          // The body was valid before the mutation, so the rejection below is
          // the mutation's doing and not the body's.
          expectAccepted(fixture, `before damaging \`${target.label}\``);

          expectRejected(target.mutate(fixture, value), `\`${target.label}\``);
        }),
        { numRuns: 100 },
      );
    });
  }
});

/* -------------------------------------------------------------------------- */
/* Property 7, inside the five collections, at three indices each             */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 7: One malformed member fails the whole body
// Validates: Requirements 13.3
describe('one malformed collection element fails the whole body', () => {
  for (const target of ELEMENT_TARGETS) {
    for (const position of POSITIONS) {
      it(`fails the body when the ${position} \`${target.label}\` is rejected by its reader`, () => {
        fc.assert(
          fc.property(
            multiElementBodyArb,
            target.rejected,
            (fixture, value) => {
              const length = collectionLength(fixture, target.collection);

              expect(length).toBeGreaterThanOrEqual(3);

              const index = indexAt(position, length);
              const original = elementWireAt(fixture, target.collection, index);

              expectAccepted(
                fixture,
                `before damaging \`${target.label}\` at ${position}`,
              );

              expectRejected(
                withElementAt(
                  fixture,
                  target.collection,
                  index,
                  target.element(original, value),
                ),
                `the ${position} \`${target.label}\``,
              );
            },
          ),
          { numRuns: 100 },
        );
      });
    }

    it(`fails the body when a single-element \`${target.label}\` is rejected by its reader`, () => {
      fc.assert(
        fc.property(
          singletonCollectionsProfileFixtureArb,
          target.rejected,
          (fixture, value) => {
            // The degenerate collection, where the three positions coincide: a
            // fold that only checks interior elements passes everything above
            // and fails here.
            expect(collectionLength(fixture, target.collection)).toBe(1);

            const original = elementWireAt(fixture, target.collection, 0);

            expectAccepted(fixture, `before damaging \`${target.label}\``);

            expectRejected(
              withElementAt(
                fixture,
                target.collection,
                0,
                target.element(original, value),
              ),
              `the only \`${target.label}\``,
            );
          },
        ),
        { numRuns: 100 },
      );
    });
  }
});

/* -------------------------------------------------------------------------- */
/* Non-vacuity: the bodies are valid, and every mutation is really rejected   */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 7: One malformed member fails the whole body
// Validates: Requirements 13.3
describe('the mutations this property applies', () => {
  it('names a reader that rejects every value it generates', () => {
    // A fixed seed, so this is a fact about the generators rather than a hope
    // about a particular run. Were any target's values readable, the property
    // above would be satisfied by a parser that failed every body.
    for (const target of MEMBER_TARGETS) {
      const values = fc.sample(target.rejected, {
        numRuns: 200,
        seed: 20_260_101,
      });

      expect(values.length, target.label).toBeGreaterThan(0);

      for (const value of values) {
        expect(
          target.rejects(value),
          `\`${target.label}\` accepts ${describeBody(value)}`,
        ).toBe(true);
      }
    }

    for (const target of ELEMENT_TARGETS) {
      const values = fc.sample(target.rejected, {
        numRuns: 200,
        seed: 20_260_101,
      });

      expect(values.length, target.label).toBeGreaterThan(0);

      for (const value of values) {
        expect(
          target.rejects(value),
          `\`${target.label}\` accepts ${describeBody(value)}`,
        ).toBe(true);
      }
    }
  });

  it('generates every value in each target set, absences included', () => {
    const sampled = fc.sample(
      fc.constantFrom<unknown>(...NON_COUNT_VALUES, ...ABSENT_VALUES),
      { numRuns: 400, seed: 20_260_102 },
    );

    // `undefined` is the spelling that a careless generator silently drops: a
    // property set to `undefined` is a present property whose reading is an
    // absence, and it must reach the parser.
    expect(sampled.some((value) => value === undefined)).toBe(true);
    expect(sampled.some((value) => value === null)).toBe(true);
    expect(sampled.some((value) => value === '12')).toBe(true);
    expect(sampled.some((value) => Number.isNaN(value))).toBe(true);
  });

  it('starts from bodies every fixture shape accepts', () => {
    for (const shape of PROFILE_FIXTURE_ARBS) {
      fc.assert(
        fc.property(shape.arbitrary, (fixture) => {
          expectAccepted(fixture, shape.label);
        }),
        { numRuns: 100 },
      );
    }
  });

  it('addresses three distinct indices of a collection of three or more', () => {
    for (let length = 1; length <= 11; length += 1) {
      const indices = POSITIONS.map((position) => indexAt(position, length));

      for (const index of indices) {
        expect(index, `length ${String(length)}`).toBeGreaterThanOrEqual(0);
        expect(index, `length ${String(length)}`).toBeLessThan(length);
      }

      if (length >= 3) {
        expect(new Set(indices).size, `length ${String(length)}`).toBe(3);
      }
    }

    // And the bodies the collection cases run over really do carry enough
    // elements for that to mean something.
    for (const fixture of fc.sample(multiElementBodyArb, {
      numRuns: 40,
      seed: 20_260_103,
    })) {
      for (const collection of [
        ...CO_APPEARANCE_KEYS,
        ...PAIRED_STAT_KEYS,
        'progression' as const,
      ]) {
        expect(collectionLength(fixture, collection)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('covers every member and element of the body, and no more', () => {
    // The member list is the claim's scope. Were a member to drop off it, the
    // property above would still pass while saying less, so the scope is
    // asserted rather than left to the list.
    const members = MEMBER_TARGETS.map((target) => target.label).sort();

    expect(members).toStrictEqual(
      [
        'bestPartnerships',
        'bibAppearances',
        'bogeyOpponents',
        'displayName',
        'isGuest',
        'membershipId',
        'mostPlayedAgainst',
        'mostPlayedWith',
        'progression',
        'rating',
        'rating.displayRating',
        'rating.state',
        'record',
        'record.appearances',
        'record.draws',
        'record.losses',
        'record.wins',
        'rich',
        'rich.cleanSheets',
        'rich.goals',
        'rich.goalsConcededAsKeeper',
        'rich.keeperTime',
        'state',
        'unbeatenStreak',
        'winPercentage',
        'winStreak',
      ].sort(),
    );

    // Every collection of the body is damaged, both in one of its members and
    // in the shape of a whole element.
    for (const collection of [
      ...CO_APPEARANCE_KEYS,
      ...PAIRED_STAT_KEYS,
      'progression' as const,
    ]) {
      const targets = ELEMENT_TARGETS.filter(
        (target) => target.collection === collection,
      );

      expect(targets.length, collection).toBeGreaterThanOrEqual(3);
      expect(
        targets.some((target) => target.label === `${collection}[]`),
        collection,
      ).toBe(true);
    }
  });

  it('leaves the fixed sample accepted, and fails it one member at a time', () => {
    // A worked example beside the generators: the fully populated sample, which
    // carries every optional member, three progression records, and rows in all
    // four Pairwise_Sections.
    expectAccepted(FULL_PROFILE_FIXTURE, 'the fully populated sample');

    expectRejected(
      withTopLevelMember(FULL_PROFILE_FIXTURE, 'winStreak', '4'),
      '`winStreak` as a string-encoded count',
    );
    expectRejected(
      withBlockMember(FULL_PROFILE_FIXTURE, 'record', 'appearances', 2.5),
      '`record.appearances` as a fraction',
    );
    expectRejected(
      withElementAt(FULL_PROFILE_FIXTURE, 'mostPlayedWith', 1, {
        ...elementWireAt(FULL_PROFILE_FIXTURE, 'mostPlayedWith', 1),
        count: -1,
      }),
      'the last `mostPlayedWith` row as a negative count',
    );
    expectRejected(
      withElementAt(FULL_PROFILE_FIXTURE, 'progression', 2, {
        ...elementWireAt(FULL_PROFILE_FIXTURE, 'progression', 2),
        completedAt: '2026-02-30T00:00:00Z',
      }),
      'the last progression record as an impossible day',
    );
  });
});
