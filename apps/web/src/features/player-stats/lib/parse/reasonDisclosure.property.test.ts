import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  absenceSpellingArb,
  absentRichBlockFixture,
  buildPlayerProfileFixture,
  canonicalWireDuration,
  canonicalWireInstant,
  coAppearanceEntryFixture,
  pairedStatEntryFixture,
  playerRecordFixture,
  presentRichBlockFixture,
  progressionRecordFixture,
  ratingSummaryFixture,
  richStatsFixture,
  type LengthRange,
  type PlayerProfileFixture,
  type RichBlockFixture,
  type WireDurationFixture,
} from '../../testing/playerProfileFixtures';
import {
  MEMBERSHIP_STATE_NAMES,
  RATING_STATE_NAMES,
  isMembershipState,
  isRatingState,
} from '../wireEnums';
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
 * Property 12: a parse failure reason discloses nothing it read.
 *
 * A rejected body's `reason` is a **diagnostic**, and the only thing standing
 * between it and a disclosure is that it is composed from the caller's own
 * literal label plus a fixed clause — never from the value that was read
 * (Requirement 13.8). This suite is the assertion of that: for every rejected
 * body, the reason contains no substring of any string, any number, or any
 * identity the body carried.
 *
 * ## Why a diagnostic string is a privacy surface
 *
 * A reason travels. It reaches a console, a log line, an error-reporting sink,
 * and — one careless `catch` away — a rendered outcome. Requirements 3.7 and
 * 12.5 say no failing outcome may carry anything renderable, and the
 * Not_Found_Treatment exists so a person cannot learn from the screen whether a
 * membership exists at all. A reason that echoed what it read would hand all of
 * that back: `profile displayName is not a string (got "Dave")` discloses a
 * squad member's name from a body the screen refused to show, and
 * `co-appearance entry membershipId is not an identity: 018f…` discloses an
 * identity a caller could then probe. The feature's answer is structural — a
 * reason is literal text — and this property is what keeps it so, because the
 * tempting "helpful" change is a one-line interpolation.
 *
 * ## Why the bodies are built distinctive rather than arbitrary
 *
 * The check is a substring search, so its sensitivity is entirely a property of
 * the values searched for. An arbitrary body carries the empty string (contained
 * in every reason), single characters (contained in most), and small integers
 * whose digits appear in the fixed clause `is not an ISO 8601 instant…`. A suite
 * over those values would be forced to exempt exactly the cases an accidental
 * echo hides in.
 *
 * So every value in these bodies is generated **distinctive**: names built on a
 * stem no clause uses, identities spelled from a distinctive hexadecimal stem,
 * counts of five digits, percentages carrying five decimal places, and
 * deliberately conspicuous replacement values with an `ECHOTRAP` stem. Every
 * secret is therefore at least {@link MIN_SECRET_LENGTH} characters long and
 * could not appear in a reason by coincidence — which the non-vacuity suite
 * asserts rather than assumes. The distinctive generators are declared here, in
 * this file, because distinctiveness is this property's own requirement; the
 * shared fixtures of `testing/playerProfileFixtures.ts` are still what assembles
 * a body, so a shape added there is a shape this suite reads.
 *
 * ## What counts as a secret
 *
 * Every **value** in the body's transitive graph: every string, and every number
 * by its decimal rendering. Identities and instants and durations are strings and
 * are collected as such. The wire's rating-model members are collected too —
 * they are numbers the parser never reads, and a reason that named one would
 * disclose a Rating_Internal the feature is not even allowed to hold
 * (Requirement 7.7).
 *
 * **Member names are deliberately not secrets.** A reason's label names the
 * member that failed — that is its entire usefulness, and the member names are
 * the contract's, not the squad's. `profile rating displayName` discloses nothing
 * about anybody; `Zarquon-0042-Kqxvw` does.
 *
 * ## Non-vacuity
 *
 * Three ways this suite could pass while saying nothing, each closed:
 *
 *  1. **The bodies might not be rejected.** Every case asserts the rejection,
 *     that the failure carries no value, and that the reason is a non-empty
 *     string — and the non-vacuity suite asserts the *unmutated* body parses, so
 *     the rejection is the mutation's doing.
 *  2. **The planted values might be valid.** Each target names the reader its
 *     member goes through, and every value it generates is checked against that
 *     reader directly, without asking the parser under test.
 *  3. **The detector might not detect.** A reason with a secret deliberately
 *     interpolated into it is fed to the same detector, which must report the
 *     disclosure — for every secret of every sampled body, not just one.
 *
 * React-free and DOM-free, like every module under `lib/`.
 *
 * **Validates: Requirements 13.8**
 */

/* -------------------------------------------------------------------------- */
/* Secrets: every value a body carries                                        */
/* -------------------------------------------------------------------------- */

/**
 * The shortest value this suite will search a reason for.
 *
 * Five characters, which is the length at which a coincidence stops being
 * plausible: the only digits any fixed clause in `primitives.ts` carries are the
 * four of `ISO 8601`, and no label is built from anything but member names. Every
 * generator below is built to clear this bound, and the non-vacuity suite
 * asserts that every secret it produces does.
 */
const MIN_SECRET_LENGTH = 5;

/** One value a body carried, as the text a reason must not contain. */
interface Secret {
  /** The text searched for: the string itself, or a number's rendering. */
  readonly text: string;
  /** Which kind of value it came from, for the failure message. */
  readonly kind: 'string' | 'number';
}

/**
 * Every value in a body's transitive graph, as searchable text.
 *
 * Iterative over an explicit stack, because the bodies this suite plants include
 * a nested replacement object and a 200-element collection, and because the
 * walker must not be the thing that raises. A property defined as a throwing
 * accessor is skipped: a value that cannot be read cannot be disclosed, which is
 * exactly the case {@link readProperty}'s guard exists for.
 *
 * Property **names** are not collected; see the module note on why a label is
 * not a disclosure.
 */
function secretsIn(body: unknown): readonly Secret[] {
  const collected = new Map<string, Secret>();
  const pending: unknown[] = [body];

  while (pending.length > 0) {
    const value = pending.pop();

    if (typeof value === 'string') {
      collected.set(value, { text: value, kind: 'string' });
      continue;
    }

    if (typeof value === 'number') {
      const text = String(value);

      collected.set(text, { text, kind: 'number' });
      continue;
    }

    if (Array.isArray(value)) {
      for (const element of value as readonly unknown[]) {
        pending.push(element);
      }

      continue;
    }

    if (typeof value === 'object' && value !== null) {
      const source = value as Record<string, unknown>;

      for (const key of Object.keys(source)) {
        try {
          pending.push(source[key]);
        } catch {
          // Unreadable, and so undisclosable.
        }
      }
    }
  }

  return [...collected.values()];
}

/**
 * The secrets a reason discloses — the whole detector, used both to assert that
 * real reasons disclose nothing and, in the non-vacuity suite, to assert that a
 * planted echo is caught.
 */
function disclosuresIn(
  reason: string,
  secrets: readonly Secret[],
): readonly Secret[] {
  return secrets.filter((secret) => reason.includes(secret.text));
}

/* -------------------------------------------------------------------------- */
/* Distinctive leaf values                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A well-formed 36-character hyphenated identity spelled from a distinctive
 * hexadecimal stem.
 *
 * Hexadecimal digits only, so `isPlayerStatsIdentifier` accepts it, and a stem
 * no reason clause or member name could contain.
 */
function distinctiveIdentity(tag: number): string {
  return `dec0ded0-fade-7ace-8bed-${String(tag).padStart(4, '0')}cafebabe`;
}

/** A distinctive identity, in both letter cases. */
const distinctiveIdentityArb: fc.Arbitrary<string> = fc
  .tuple(fc.integer({ min: 0, max: 9_999 }), fc.boolean())
  .map(([tag, upperCase]) => {
    const identity = distinctiveIdentity(tag);

    return upperCase ? identity.toUpperCase() : identity;
  });

/**
 * A display name distinctive enough that an echo of it is unmistakable, while
 * keeping the shapes that would expose a repairing parser: padded with
 * whitespace, carrying a grapheme, and carrying the Anonymised_Placeholder's own
 * wording.
 */
const distinctiveDisplayNameArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc
      .integer({ min: 0, max: 9_999 })
      .map((tag) => `Zarquon-${String(tag).padStart(4, '0')}-Kqxvw`),
  },
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      '  Zarquon-Padded-Kqxvw  ',
      '🧤 Zarquon-Keeper-Kqxvw',
      'Zarquon-Former-player-Kqxvw',
      'Zarquon-Ömer-Kqxvw',
    ),
  },
);

/** A count of five digits, so its rendering cannot hide inside a clause. */
const distinctiveCountArb: fc.Arbitrary<number> = fc.integer({
  min: 20_000,
  max: 99_999,
});

/**
 * A percentage inside the closed range the contract admits, carrying five
 * decimal places — the fractional part is what makes it unmistakable.
 *
 * The last decimal digit is forced away from zero, because a trailing zero is
 * dropped from the rendering and `83.40000` would be searched for as `83.4`:
 * four characters, which is below the floor at which a coincidental match stops
 * being plausible.
 */
const distinctivePercentageArb: fc.Arbitrary<number> = fc
  .integer({ min: 1_234_567, max: 9_876_543 })
  .map(
    (hundredThousandths) =>
      (hundredThousandths - (hundredThousandths % 10) + 3) / 100_000,
  );

/** A Display_Rating of five digits, half of them carrying an exact fraction. */
const distinctiveDisplayRatingArb: fc.Arbitrary<number> = fc
  .tuple(fc.integer({ min: 10_000, max: 99_999 }), fc.boolean())
  .map(([whole, fractional]) => (fractional ? whole + 0.03125 : whole));

/**
 * A value of the wire's rating-model members, which the parser never reads.
 *
 * Generated distinctive for the same reason as everything else: a reason naming
 * one would be disclosing a quantity this feature is not permitted to hold at
 * all (Requirement 7.7), so it must be detectable if it ever appears.
 */
const distinctiveModelValueArb: fc.Arbitrary<number> = fc
  .integer({ min: 20_000, max: 99_999 })
  .map((whole) => whole + 0.5);

/** A completion instant, in the canonical `Z`-designated millisecond form. */
const distinctiveInstantArb = fc
  .integer({ min: 1_700_000_000_000, max: 1_800_000_000_000 })
  .map((ms) => canonicalWireInstant(ms));

/** A Keeper_Time of between a quarter of an hour and two and a half hours. */
const distinctiveDurationArb: fc.Arbitrary<WireDurationFixture> = fc
  .integer({ min: 1_000_000, max: 9_000_000 })
  .map((ms) => canonicalWireDuration(ms));

/* -------------------------------------------------------------------------- */
/* Distinctive blocks and collections                                         */
/* -------------------------------------------------------------------------- */

/** A record block whose appearances are the sum of its outcomes. */
const distinctiveRecordArb = fc
  .tuple(distinctiveCountArb, distinctiveCountArb, distinctiveCountArb)
  .map(([wins, draws, losses]) =>
    playerRecordFixture({
      appearances: wins + draws + losses,
      wins,
      draws,
      losses,
    }),
  );

/** A rating block, in any of the shapes the contract admits. */
const distinctiveRatingArb = fc
  .record({
    state: fc.option(fc.constantFrom(...RATING_STATE_NAMES), { nil: null }),
    displayRating: fc.option(distinctiveDisplayRatingArb, { nil: null }),
    stateAbsence: absenceSpellingArb,
    displayRatingAbsence: absenceSpellingArb,
    modelValues: fc.tuple(distinctiveModelValueArb, distinctiveModelValueArb),
  })
  .map((input) => ratingSummaryFixture(input));

/** A progression record, mostly carrying a plottable Display_Rating. */
const distinctiveProgressionRecordArb = fc
  .record({
    instant: distinctiveInstantArb,
    displayRating: fc.option(distinctiveDisplayRatingArb, { nil: null }),
    displayRatingAbsence: absenceSpellingArb,
    state: fc.option(fc.constantFrom(...RATING_STATE_NAMES), { nil: null }),
    modelValues: fc.tuple(distinctiveModelValueArb, distinctiveModelValueArb),
  })
  .map((input) => progressionRecordFixture(input));

/** One row of "most played with" or "most played against". */
const distinctiveCoAppearanceArb = fc
  .record({
    membershipId: distinctiveIdentityArb,
    displayName: distinctiveDisplayNameArb,
    count: distinctiveCountArb,
  })
  .map((entry) => coAppearanceEntryFixture(entry));

/** One row of "best partnerships" or "bogey opponents". */
const distinctivePairedStatArb = fc
  .record({
    membershipId: distinctiveIdentityArb,
    displayName: distinctiveDisplayNameArb,
    value: distinctivePercentageArb,
    qualifyingMatches: distinctiveCountArb,
  })
  .map((entry) => pairedStatEntryFixture(entry));

/** A rich block with every one of its four members present. */
const populatedDistinctiveRichStatsArb = fc
  .record({
    goals: distinctiveCountArb,
    cleanSheets: distinctiveCountArb,
    goalsConcededAsKeeper: distinctiveCountArb,
    keeperTime: distinctiveDurationArb,
    absence: absenceSpellingArb,
  })
  .map((input) => richStatsFixture(input));

/** A rich block with an arbitrary subset of its members present. */
const partialDistinctiveRichStatsArb = fc
  .record({
    goals: fc.option(distinctiveCountArb, { nil: null }),
    cleanSheets: fc.option(distinctiveCountArb, { nil: null }),
    goalsConcededAsKeeper: fc.option(distinctiveCountArb, { nil: null }),
    keeperTime: fc.option(distinctiveDurationArb, { nil: null }),
    absence: absenceSpellingArb,
  })
  .map((input) => richStatsFixture(input));

/** The `rich` member: a present block, or no block at all. */
const distinctiveRichBlockArb: fc.Arbitrary<RichBlockFixture> = fc.oneof(
  absenceSpellingArb.map((absence) => absentRichBlockFixture(absence)),
  populatedDistinctiveRichStatsArb.map((fixture) =>
    presentRichBlockFixture(fixture),
  ),
  partialDistinctiveRichStatsArb.map((fixture) =>
    presentRichBlockFixture(fixture),
  ),
);

/** The `rich` member, always a present and fully populated block. */
const populatedRichBlockArb: fc.Arbitrary<RichBlockFixture> =
  populatedDistinctiveRichStatsArb.map((fixture) =>
    presentRichBlockFixture(fixture),
  );

/* -------------------------------------------------------------------------- */
/* Distinctive whole bodies                                                   */
/* -------------------------------------------------------------------------- */

/** How a generated distinctive body varies. */
interface DistinctiveBodyOptions {
  /** Length bounds for each of the four Pairwise_Sections. */
  readonly pairwise?: LengthRange;
  /** Length bounds for the progression. */
  readonly progression?: LengthRange;
  /** The `rich` member to use. */
  readonly rich?: fc.Arbitrary<RichBlockFixture>;
}

/**
 * A valid `GetPlayerProfile` body, every value of which is distinctive.
 *
 * Assembled by the shared fixtures' own builder, so this is the same kind of
 * body the rest of the parsing suites quantify over — only with its leaves
 * chosen for detectability rather than for variety.
 */
function distinctiveBodyArb(
  options: DistinctiveBodyOptions = {},
): fc.Arbitrary<PlayerProfileFixture> {
  const pairwise = options.pairwise ?? { minLength: 1, maxLength: 4 };
  const progression = options.progression ?? { minLength: 1, maxLength: 4 };

  return fc
    .record({
      membershipId: distinctiveIdentityArb,
      displayName: distinctiveDisplayNameArb,
      state: fc.option(fc.constantFrom(...MEMBERSHIP_STATE_NAMES), {
        nil: null,
      }),
      stateAbsence: absenceSpellingArb,
      isGuest: fc.boolean(),
      record: distinctiveRecordArb,
      winPercentage: fc.option(distinctivePercentageArb, { nil: null }),
      winPercentageAbsence: absenceSpellingArb,
      rating: distinctiveRatingArb,
      progression: fc.array(distinctiveProgressionRecordArb, progression),
      winStreak: distinctiveCountArb,
      unbeatenStreak: distinctiveCountArb,
      mostPlayedWith: fc.array(distinctiveCoAppearanceArb, pairwise),
      mostPlayedAgainst: fc.array(distinctiveCoAppearanceArb, pairwise),
      bestPartnerships: fc.array(distinctivePairedStatArb, pairwise),
      bogeyOpponents: fc.array(distinctivePairedStatArb, pairwise),
      bibAppearances: distinctiveCountArb,
      rich: options.rich ?? distinctiveRichBlockArb,
    })
    .map((input) => buildPlayerProfileFixture(input));
}

/** Ordinary distinctive bodies. */
const ordinaryBodyArb = distinctiveBodyArb();

/**
 * Bodies whose every collection carries at least two elements, so the first and
 * the last are distinct positions.
 */
const multiElementBodyArb = distinctiveBodyArb({
  pairwise: { minLength: 2, maxLength: 5 },
  progression: { minLength: 2, maxLength: 5 },
});

/** Bodies carrying a present, fully populated `rich` block to damage. */
const richPopulatedBodyArb = distinctiveBodyArb({
  rich: populatedRichBlockArb,
});

/**
 * Bodies at the sizes the design names — 200-element Pairwise_Sections and a
 * 500-point progression — so the reason for a failure deep in a long collection
 * is checked as well as the reason for one near the front.
 */
const largeBodyArb = distinctiveBodyArb({
  pairwise: { minLength: 200, maxLength: 200 },
  progression: { minLength: 500, maxLength: 500 },
  rich: populatedRichBlockArb,
});

/* -------------------------------------------------------------------------- */
/* Distinctive values the readers reject                                      */
/* -------------------------------------------------------------------------- */

/** A conspicuous string, rejected wherever anything but a string is read. */
const ECHO_TEXT = 'ECHOTRAP-TEXT-Q7ZVXK';

/** A conspicuous string-encoded number, rejected wherever a number is read. */
const ECHO_NUMERIC_TEXT = '90217364';

/** A conspicuous number, rejected wherever a number is not read. */
const ECHO_NUMBER = 91_827_364;

/** A conspicuous negative, rejected as a count and as a percentage. */
const ECHO_NEGATIVE = -70_413;

/** A conspicuous fraction, rejected as a count. */
const ECHO_FRACTION = 50_731.25;

/** A conspicuous value above the percentage range, rejected unclamped. */
const ECHO_ABOVE_PERCENTAGE = 90_217.5;

/** A conspicuous nested object, rejected wherever an object is not read. */
const ECHO_OBJECT = { echoTrap: 'ECHOTRAP-NESTED-M4KQD' };

/** A conspicuous array, rejected wherever an array is not read. */
const ECHO_ARRAY = ['ECHOTRAP-ELEMENT-R8WPL'];

/** A conspicuous string that is not an identity. */
const ECHO_NON_IDENTITY = 'ECHOTRAP-NOT-AN-IDENTITY-5XQW';

/** A conspicuous instant naming an impossible calendar day. */
const ECHO_NON_INSTANT = '2026-02-30T00:00:00Z';

/** A conspicuous duration in the negative form the reader rejects. */
const ECHO_NEGATIVE_DURATION = '-04:11:59';

/** Values `readUuid` rejects. */
const NON_IDENTITY_VALUES: readonly unknown[] = [
  ECHO_NON_IDENTITY,
  ECHO_TEXT,
  ECHO_NUMBER,
  ECHO_OBJECT,
  ECHO_ARRAY,
];

/** Values `readString` rejects. */
const NON_STRING_VALUES: readonly unknown[] = [
  ECHO_NUMBER,
  ECHO_FRACTION,
  ECHO_OBJECT,
  ECHO_ARRAY,
];

/** Values `readBoolean` rejects. */
const NON_BOOLEAN_VALUES: readonly unknown[] = [
  ECHO_TEXT,
  ECHO_NUMERIC_TEXT,
  ECHO_NUMBER,
  ECHO_OBJECT,
  ECHO_ARRAY,
];

/** Values `readNumber` rejects — the string-encoded number included. */
const NON_NUMBER_VALUES: readonly unknown[] = [
  ECHO_NUMERIC_TEXT,
  ECHO_TEXT,
  ECHO_OBJECT,
  ECHO_ARRAY,
];

/** Values `readCount` rejects, none of them rounded or clamped into a tally. */
const NON_COUNT_VALUES: readonly unknown[] = [
  ECHO_NUMERIC_TEXT,
  ECHO_TEXT,
  ECHO_NEGATIVE,
  ECHO_FRACTION,
  ECHO_OBJECT,
  ECHO_ARRAY,
];

/** Values `readPercentage` rejects, including one above the range. */
const NON_PERCENTAGE_VALUES: readonly unknown[] = [
  ECHO_ABOVE_PERCENTAGE,
  ECHO_NEGATIVE,
  ECHO_NUMERIC_TEXT,
  ECHO_TEXT,
  ECHO_OBJECT,
  ECHO_ARRAY,
];

/** Values no wire-enum name test admits. */
const NON_ENUM_NAME_VALUES: readonly unknown[] = [
  ECHO_TEXT,
  ECHO_NUMERIC_TEXT,
  ECHO_NUMBER,
  ECHO_OBJECT,
  ECHO_ARRAY,
];

/** Values `readObject` rejects — an array among them: a list is not a block. */
const NON_OBJECT_VALUES: readonly unknown[] = [
  ECHO_TEXT,
  ECHO_NUMERIC_TEXT,
  ECHO_NUMBER,
  ECHO_ARRAY,
];

/** Values `readArray` rejects, including an object. */
const NON_ARRAY_VALUES: readonly unknown[] = [
  ECHO_TEXT,
  ECHO_NUMERIC_TEXT,
  ECHO_NUMBER,
  ECHO_OBJECT,
];

/** Values `readInstantMs` rejects. */
const NON_INSTANT_VALUES: readonly unknown[] = [
  ECHO_NON_INSTANT,
  ECHO_TEXT,
  ECHO_NUMBER,
  ECHO_OBJECT,
  ECHO_ARRAY,
];

/** Values `readDurationMs` rejects, the negative form included. */
const NON_DURATION_VALUES: readonly unknown[] = [
  ECHO_NEGATIVE_DURATION,
  ECHO_TEXT,
  ECHO_NUMBER,
  ECHO_OBJECT,
  ECHO_ARRAY,
];

/** Bodies that are not objects at all, each carrying a distinctive value. */
const NON_OBJECT_BODIES: readonly unknown[] = [
  ECHO_TEXT,
  ECHO_NUMERIC_TEXT,
  ECHO_NUMBER,
  ECHO_FRACTION,
  ECHO_NEGATIVE,
  ECHO_ARRAY,
  [ECHO_OBJECT],
  [[ECHO_TEXT]],
];

/* -------------------------------------------------------------------------- */
/* Naming the reader a member goes through                                    */
/* -------------------------------------------------------------------------- */

/** A reader of one unknown value, as every reader of `primitives.ts` is shaped. */
type LabelledReader = (value: unknown, label: string) => ParseResult<unknown>;

/**
 * Whether a member's own reader rejects a value.
 *
 * Asked of the reader directly rather than inferred from the parser, because
 * "was this replacement really malformed?" must be answerable without consulting
 * the code under test.
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

/** A nested block of the body this suite damages a member of. */
type BlockKey = 'record' | 'rating' | 'rich';

/** Every collection of the body whose elements this suite damages. */
type CollectionKey =
  | 'mostPlayedWith'
  | 'mostPlayedAgainst'
  | 'bestPartnerships'
  | 'bogeyOpponents'
  | 'progression';

/** The two Pairwise_Sections of co-appearance rows. */
const CO_APPEARANCE_KEYS = ['mostPlayedWith', 'mostPlayedAgainst'] as const;

/** The two Pairwise_Sections of paired statistics. */
const PAIRED_STAT_KEYS = ['bestPartnerships', 'bogeyOpponents'] as const;

/** Which end of a collection the damaged element sits at. */
const POSITIONS = ['first', 'last'] as const;

/** One of the two positions. */
type Position = (typeof POSITIONS)[number];

/** The index a position names in a collection of the given length. */
function indexAt(position: Position, length: number): number {
  return position === 'first' ? 0 : length - 1;
}

/** One element's wire form, taken from the fixture's own `parts`. */
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

/** The body with exactly one top-level member replaced. */
function withTopLevelMember(
  fixture: PlayerProfileFixture,
  key: string,
  value: unknown,
): unknown {
  return { ...fixture.wire, [key]: value };
}

/** The body with exactly one top-level member removed. */
function withoutTopLevelMember(
  fixture: PlayerProfileFixture,
  key: string,
): unknown {
  const body: Record<string, unknown> = { ...fixture.wire };

  delete body[key];

  return body;
}

/** The body with exactly one member of one nested block replaced. */
function withBlockMember(
  fixture: PlayerProfileFixture,
  block: BlockKey,
  key: string,
  value: unknown,
): unknown {
  const original = fixture.wire[block];

  expect(typeof original, `the body carries a \`${block}\` block`).toBe(
    'object',
  );
  expect(original).not.toBeNull();

  return {
    ...fixture.wire,
    [block]: { ...(original as Record<string, unknown>), [key]: value },
  };
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
/* The targets: every member, and the reader it goes through                  */
/* -------------------------------------------------------------------------- */

/** One way of turning a valid distinctive body into a rejected one. */
interface Mutation {
  /** Where the damage is, for the test name and the failure message. */
  readonly label: string;
  /** Valid bodies this mutation applies to. */
  readonly bodies: fc.Arbitrary<PlayerProfileFixture>;
  /** Values the damaged member's own reader rejects. */
  readonly values: fc.Arbitrary<unknown>;
  /** Whether the damaged member's own reader rejects a value. */
  readonly rejects: (value: unknown) => boolean;
  /** The damaged body. */
  readonly apply: (fixture: PlayerProfileFixture, value: unknown) => unknown;
}

/** A top-level member replaced by a value its reader rejects. */
function topLevelMutation(
  key: string,
  reader: LabelledReader,
  values: readonly unknown[],
  bodies: fc.Arbitrary<PlayerProfileFixture> = ordinaryBodyArb,
): Mutation {
  return {
    label: key,
    bodies,
    values: fc.constantFrom<unknown>(...values),
    rejects: rejectedBy(reader),
    apply: (fixture, value) => withTopLevelMember(fixture, key, value),
  };
}

/**
 * A required top-level member removed altogether.
 *
 * Covered because an absence is the one failure whose reason is produced without
 * the parser ever holding a value for that member — and the body around it is
 * still full of values a reason must not reach for.
 */
function removalMutation(
  key: string,
  reader: LabelledReader,
  bodies: fc.Arbitrary<PlayerProfileFixture> = ordinaryBodyArb,
): Mutation {
  return {
    label: `${key} removed`,
    bodies,
    values: fc.constant<unknown>(undefined),
    rejects: rejectedBy(reader),
    apply: (fixture) => withoutTopLevelMember(fixture, key),
  };
}

/** A member of one of the three nested blocks. */
function blockMutation(
  block: BlockKey,
  key: string,
  reader: LabelledReader,
  values: readonly unknown[],
  bodies: fc.Arbitrary<PlayerProfileFixture> = ordinaryBodyArb,
): Mutation {
  return {
    label: `${block}.${key}`,
    bodies,
    values: fc.constantFrom<unknown>(...values),
    rejects: rejectedBy(reader),
    apply: (fixture, value) => withBlockMember(fixture, block, key, value),
  };
}

/** One member of one element of a collection, at one end of it. */
function elementMemberMutation(
  collection: CollectionKey,
  position: Position,
  key: string,
  reader: LabelledReader,
  values: readonly unknown[],
  bodies: fc.Arbitrary<PlayerProfileFixture> = multiElementBodyArb,
): Mutation {
  return {
    label: `${position} ${collection}[].${key}`,
    bodies,
    values: fc.constantFrom<unknown>(...values),
    rejects: rejectedBy(reader),
    apply: (fixture, value) => {
      const index = indexAt(position, collectionLength(fixture, collection));
      const original = elementWireAt(fixture, collection, index);

      return withElementAt(fixture, collection, index, {
        ...original,
        [key]: value,
      });
    },
  };
}

/** A whole element replaced by a value that is not a wire object. */
function elementShapeMutation(
  collection: CollectionKey,
  position: Position,
  parse: (value: unknown) => ParseResult<unknown>,
  bodies: fc.Arbitrary<PlayerProfileFixture> = multiElementBodyArb,
): Mutation {
  return {
    label: `${position} ${collection}[]`,
    bodies,
    values: fc.constantFrom<unknown>(...NON_OBJECT_VALUES),
    rejects: (value) => !parse(value).ok,
    apply: (fixture, value) =>
      withElementAt(
        fixture,
        collection,
        indexAt(position, collectionLength(fixture, collection)),
        value,
      ),
  };
}

/**
 * Every way this suite rejects a distinctive body.
 *
 * Breadth matters here for a specific reason: a reason is composed per *reader*,
 * and a disclosure would be introduced one reader or one parser at a time. A
 * suite that only damaged a count would never see an interpolation added to the
 * identity reader. So every member of the body, every member of the three nested
 * blocks, and every member of the five collections is damaged, at both ends of
 * each collection.
 */
const MUTATIONS: readonly Mutation[] = [
  // --- Required top-level members -------------------------------------------
  topLevelMutation('membershipId', readUuid, NON_IDENTITY_VALUES),
  topLevelMutation('displayName', readString, NON_STRING_VALUES),
  topLevelMutation('isGuest', readBoolean, NON_BOOLEAN_VALUES),
  topLevelMutation('record', parsePlayerRecord, NON_OBJECT_VALUES),
  topLevelMutation('rating', parseRatingSummary, NON_OBJECT_VALUES),
  topLevelMutation('progression', readArray, NON_ARRAY_VALUES),
  topLevelMutation('winStreak', readCount, NON_COUNT_VALUES),
  topLevelMutation('unbeatenStreak', readCount, NON_COUNT_VALUES),
  topLevelMutation('bibAppearances', readCount, NON_COUNT_VALUES),
  ...[...CO_APPEARANCE_KEYS, ...PAIRED_STAT_KEYS].map((key) =>
    topLevelMutation(key, readArray, NON_ARRAY_VALUES),
  ),

  // --- Required top-level members, removed ----------------------------------
  removalMutation('membershipId', readUuid),
  removalMutation('displayName', readString),
  removalMutation('isGuest', readBoolean),
  removalMutation('record', parsePlayerRecord),
  removalMutation('rating', parseRatingSummary),
  removalMutation('progression', readArray),
  removalMutation('winStreak', readCount),
  removalMutation('bibAppearances', readCount),
  ...[...CO_APPEARANCE_KEYS, ...PAIRED_STAT_KEYS].map((key) =>
    removalMutation(key, readArray),
  ),

  // --- Declared-optional top-level members, present but malformed -----------
  topLevelMutation(
    'state',
    optional(membershipStateReader),
    NON_ENUM_NAME_VALUES,
  ),
  topLevelMutation(
    'winPercentage',
    optional(readPercentage),
    NON_PERCENTAGE_VALUES,
  ),
  topLevelMutation('rich', optional(parseRichStats), NON_OBJECT_VALUES),

  // --- The record block: four required counts -------------------------------
  ...['appearances', 'wins', 'draws', 'losses'].map((key) =>
    blockMutation('record', key, readCount, NON_COUNT_VALUES),
  ),

  // --- The rating block: two declared-optional members ----------------------
  blockMutation(
    'rating',
    'state',
    optional(ratingStateReader),
    NON_ENUM_NAME_VALUES,
  ),
  blockMutation(
    'rating',
    'displayRating',
    optional(readNumber),
    NON_NUMBER_VALUES,
  ),

  // --- The rich block: four independently optional members ------------------
  ...['goals', 'cleanSheets', 'goalsConcededAsKeeper'].map((key) =>
    blockMutation(
      'rich',
      key,
      optional(readCount),
      NON_COUNT_VALUES,
      richPopulatedBodyArb,
    ),
  ),
  blockMutation(
    'rich',
    'keeperTime',
    optional(readDurationMs),
    NON_DURATION_VALUES,
    richPopulatedBodyArb,
  ),

  // --- Inside the five collections, at both ends of each --------------------
  ...POSITIONS.flatMap((position) => [
    ...CO_APPEARANCE_KEYS.flatMap((collection) => [
      elementMemberMutation(
        collection,
        position,
        'membershipId',
        readUuid,
        NON_IDENTITY_VALUES,
      ),
      elementMemberMutation(
        collection,
        position,
        'displayName',
        readString,
        NON_STRING_VALUES,
      ),
      elementMemberMutation(
        collection,
        position,
        'count',
        readCount,
        NON_COUNT_VALUES,
      ),
      elementShapeMutation(collection, position, parseCoAppearanceEntry),
    ]),
    ...PAIRED_STAT_KEYS.flatMap((collection) => [
      elementMemberMutation(
        collection,
        position,
        'membershipId',
        readUuid,
        NON_IDENTITY_VALUES,
      ),
      elementMemberMutation(
        collection,
        position,
        'displayName',
        readString,
        NON_STRING_VALUES,
      ),
      elementMemberMutation(
        collection,
        position,
        'value',
        readPercentage,
        NON_PERCENTAGE_VALUES,
      ),
      elementMemberMutation(
        collection,
        position,
        'qualifyingMatches',
        readCount,
        NON_COUNT_VALUES,
      ),
      elementShapeMutation(collection, position, parsePairedStatEntry),
    ]),
    elementMemberMutation(
      'progression',
      position,
      'completedAt',
      readInstantMs,
      NON_INSTANT_VALUES,
    ),
    elementMemberMutation(
      'progression',
      position,
      'displayRating',
      optional(readNumber),
      NON_NUMBER_VALUES,
    ),
    elementShapeMutation('progression', position, parseProgressionPoint),
  ]),

  // --- One failure deep inside a body at the sizes the design names ---------
  {
    ...elementMemberMutation(
      'bestPartnerships',
      'last',
      'value',
      readPercentage,
      NON_PERCENTAGE_VALUES,
      largeBodyArb,
    ),
    label: 'the 200th bestPartnerships[].value',
  },
  {
    ...elementMemberMutation(
      'progression',
      'last',
      'completedAt',
      readInstantMs,
      NON_INSTANT_VALUES,
      largeBodyArb,
    ),
    label: 'the 500th progression[].completedAt',
  },
];

/* -------------------------------------------------------------------------- */
/* The frame: a rejection carries a reason, and the reason carries no value   */
/* -------------------------------------------------------------------------- */

/** A body rendered for a failure message, on a best-effort basis. */
function describeBody(body: unknown): string {
  try {
    return JSON.stringify(body) ?? String(body);
  } catch {
    return '[a body that cannot be rendered]';
  }
}

/**
 * The reason a body was rejected with, asserted to be a reason and nothing else.
 *
 * A raise is not a parse failure — it escapes the call site and takes the
 * screen's own handling with it (Requirement 13.1) — so it is reported as a
 * distinct fault rather than as a rejected body.
 */
function rejectionReasonOf(body: unknown, context: string): string {
  let outcome: ParseResult<PlayerProfile>;

  try {
    outcome = parsePlayerProfile(body);
  } catch (raised) {
    throw new Error(
      `the parser raised instead of settling for ${context}: ${String(raised)}`,
      { cause: raised },
    );
  }

  if (outcome.ok) {
    throw new Error(
      `a body damaged at ${context} was accepted: ${describeBody(body)}`,
    );
  }

  expect(typeof outcome.reason, context).toBe('string');
  expect(outcome.reason.length, context).toBeGreaterThan(0);

  return outcome.reason;
}

/** Assert that a reason discloses none of the values its body carried. */
function expectNoDisclosure(
  reason: string,
  body: unknown,
  context: string,
): void {
  const secrets = secretsIn(body);

  // A body with nothing in it to disclose would satisfy the property for free.
  expect(secrets.length, `${context} carries values to disclose`).toBeGreaterThan(
    0,
  );

  for (const secret of secrets) {
    expect(
      secret.text.length,
      `${context} carries a ${secret.kind} too short to detect an echo of: ${secret.text}`,
    ).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
  }

  const disclosed = disclosuresIn(reason, secrets);

  if (disclosed.length > 0) {
    throw new Error(
      `the reason for ${context} discloses ${String(disclosed.length)} value(s) it read — ` +
        `${disclosed.map((secret) => `${secret.kind} ${secret.text}`).join(', ')} — ` +
        `in: ${reason}`,
    );
  }
}

/** The body a fixture carries, asserted to parse. */
function expectAccepted(fixture: PlayerProfileFixture, context: string): void {
  const outcome = parsePlayerProfile(fixture.wire);

  if (!outcome.ok) {
    throw new Error(
      `a valid distinctive body (${context}) was rejected: ${outcome.reason} — ${describeBody(fixture.wire)}`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Property 12, over every rejected body                                      */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 12: A parse failure reason discloses nothing it read
// Validates: Requirements 13.8
describe('a parse failure reason discloses nothing it read', () => {
  for (const mutation of MUTATIONS) {
    it(`discloses nothing when \`${mutation.label}\` is rejected`, () => {
      fc.assert(
        fc.property(mutation.bodies, mutation.values, (fixture, value) => {
          const body = mutation.apply(fixture, value);
          const reason = rejectionReasonOf(body, `\`${mutation.label}\``);

          expectNoDisclosure(reason, body, `\`${mutation.label}\``);
        }),
        { numRuns: 100 },
      );
    });
  }

  it('discloses nothing when the body is not an object at all', () => {
    fc.assert(
      fc.property(fc.constantFrom<unknown>(...NON_OBJECT_BODIES), (body) => {
        const reason = rejectionReasonOf(body, 'a body that is not an object');

        expectNoDisclosure(reason, body, 'a body that is not an object');
      }),
      { numRuns: 100 },
    );
  });

  it('discloses nothing read through a throwing accessor', () => {
    // The one value an arbitrary body can make the parser touch at its own risk.
    // `readProperty` guards it and reads the member as absent; the raised
    // message must not reach the reason either, which the walker cannot check
    // for us because it cannot read the property either.
    const raisedSecret = 'ECHOTRAP-RAISED-FROM-ACCESSOR-W3NQ';

    fc.assert(
      fc.property(ordinaryBodyArb, (fixture) => {
        const body: Record<string, unknown> = { ...fixture.wire };

        Object.defineProperty(body, 'displayName', {
          enumerable: true,
          get(): never {
            throw new Error(raisedSecret);
          },
        });

        const reason = rejectionReasonOf(body, 'a throwing `displayName`');

        expect(reason.includes(raisedSecret)).toBe(false);
        expect(reason.includes('ECHOTRAP')).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Non-vacuity                                                               */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 12: A parse failure reason discloses nothing it read
// Validates: Requirements 13.8
describe('the rejections this property quantifies over', () => {
  it('starts from distinctive bodies the parser accepts', () => {
    for (const [label, bodies] of [
      ['ordinary', ordinaryBodyArb],
      ['multi-element collections', multiElementBodyArb],
      ['a populated rich block', richPopulatedBodyArb],
      ['large collections', largeBodyArb],
    ] as const) {
      fc.assert(
        fc.property(bodies, (fixture) => {
          expectAccepted(fixture, label);
        }),
        { numRuns: 100 },
      );
    }
  });

  it('names a reader that rejects every value it plants', () => {
    // A fixed seed, so this is a fact about the generators rather than a hope
    // about a particular run. Were a planted value readable, the property above
    // would be satisfied by bodies that were never rejected at all.
    for (const mutation of MUTATIONS) {
      const values = fc.sample(mutation.values, {
        numRuns: 100,
        seed: 20_260_112,
      });

      expect(values.length, mutation.label).toBeGreaterThan(0);

      for (const value of values) {
        expect(
          mutation.rejects(value),
          `\`${mutation.label}\` accepts ${describeBody(value)}`,
        ).toBe(true);
      }
    }
  });

  it('detects a deliberately planted echo of every value a body carries', () => {
    // The detector's own test. Each secret is interpolated into a reason of
    // exactly the shape a "helpful" parser would produce, and must be reported.
    for (const fixture of fc.sample(ordinaryBodyArb, {
      numRuns: 12,
      seed: 20_260_113,
    })) {
      const secrets = secretsIn(fixture.wire);

      expect(secrets.length).toBeGreaterThan(0);

      for (const secret of secrets) {
        const planted = `profile displayName is not a string: ${secret.text}`;
        const disclosed = disclosuresIn(planted, secrets);

        expect(
          disclosed.some((found) => found.text === secret.text),
          `an echo of ${secret.kind} ${secret.text} went undetected`,
        ).toBe(true);
      }
    }
  });

  it('reports nothing for a reason built only from the parser vocabulary', () => {
    // The other half of the detector's calibration: the labels and clauses the
    // parser really composes must not be mistaken for disclosures, or the
    // property would be failing for the wrong reason.
    const parserReasons: readonly string[] = [
      'profile is not an object',
      'profile membershipId is not an identity',
      'profile displayName is not a string',
      'profile state names no member of its wire enum',
      'profile record appearances is not a whole number',
      'profile winPercentage is outside the accepted percentage range',
      'profile rating displayRating is not a number',
      'progression point completedAt is not an ISO 8601 instant with a UTC designator',
      'co-appearance entry count is a negative count',
      'paired statistic entry qualifyingMatches is not a finite number',
      'profile rich stats keeperTime is not a duration',
    ];

    for (const fixture of fc.sample(ordinaryBodyArb, {
      numRuns: 12,
      seed: 20_260_114,
    })) {
      const secrets = secretsIn(fixture.wire);

      for (const reason of parserReasons) {
        expect(
          disclosuresIn(reason, secrets).map((secret) => secret.text),
          reason,
        ).toStrictEqual([]);
      }
    }
  });

  it('collects the values nested throughout a body, not just its surface', () => {
    const [fixture] = fc.sample(
      distinctiveBodyArb({
        pairwise: { minLength: 2, maxLength: 2 },
        progression: { minLength: 2, maxLength: 2 },
        rich: populatedRichBlockArb,
      }),
      { numRuns: 1, seed: 20_260_115 },
    );

    const texts = new Set(secretsIn(fixture.wire).map((secret) => secret.text));
    const parts = fixture.parts;

    // The surface.
    expect(texts.has(parts.membershipId)).toBe(true);
    expect(texts.has(parts.displayName)).toBe(true);
    expect(texts.has(String(parts.bibAppearances))).toBe(true);

    // A nested block, and a member of it the parser reads.
    expect(texts.has(String(parts.record.parsed.appearances))).toBe(true);

    // The rating-model members the parser never reads — a reason naming one
    // would disclose a Rating_Internal (Requirement 7.7).
    const modelValues = parts.rating.wire;

    for (const key of Object.keys(modelValues)) {
      const value = modelValues[key];

      if (typeof value === 'number') {
        expect(texts.has(String(value))).toBe(true);
      }
    }

    // Deep inside the collections: a row's identity and name, an instant, and
    // the Keeper_Time duration string.
    for (const entry of parts.mostPlayedWith) {
      expect(texts.has(entry.parsed.membershipId)).toBe(true);
      expect(texts.has(entry.parsed.displayName)).toBe(true);
    }

    for (const record of parts.progression) {
      expect(texts.has(String(record.wire.completedAt))).toBe(true);
    }

    const richWire = parts.rich.wire;

    expect(richWire).not.toBeNull();
    expect(texts.has(String(richWire?.keeperTime))).toBe(true);
  });

  it('covers every member of the body, and both ends of every collection', () => {
    // The mutation list is the claim's scope: were a member to drop off it, the
    // property above would still pass while saying less.
    const labels = new Set(MUTATIONS.map((mutation) => mutation.label));

    for (const key of [
      'membershipId',
      'displayName',
      'state',
      'isGuest',
      'record',
      'winPercentage',
      'rating',
      'progression',
      'winStreak',
      'unbeatenStreak',
      'mostPlayedWith',
      'mostPlayedAgainst',
      'bestPartnerships',
      'bogeyOpponents',
      'bibAppearances',
      'rich',
    ]) {
      expect(labels.has(key), key).toBe(true);
    }

    for (const member of [
      'record.appearances',
      'record.wins',
      'record.draws',
      'record.losses',
      'rating.state',
      'rating.displayRating',
      'rich.goals',
      'rich.cleanSheets',
      'rich.goalsConcededAsKeeper',
      'rich.keeperTime',
    ]) {
      expect(labels.has(member), member).toBe(true);
    }

    for (const position of POSITIONS) {
      for (const collection of [
        ...CO_APPEARANCE_KEYS,
        ...PAIRED_STAT_KEYS,
        'progression' as const,
      ]) {
        expect(
          labels.has(`${position} ${collection}[]`),
          `${position} ${collection}[]`,
        ).toBe(true);
      }
    }
  });
});
