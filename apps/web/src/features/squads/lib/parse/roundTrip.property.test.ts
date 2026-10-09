import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { isSquadIdentifier } from '../identifiers';
import {
  INVITE_STATE_NAMES,
  MEMBERSHIP_STATE_NAMES,
  RATING_STATE_NAMES,
  REDEEM_OUTCOME_NAMES,
  SQUAD_FEATURE_NAMES,
  SQUAD_ROLE_NAMES,
  type RatingState,
} from '../wireEnums';
import {
  parseCreatedGuest,
  printCreatedGuest,
  type CreatedGuest,
} from './createdGuest';
import {
  parseCreatedSquad,
  printCreatedSquad,
  type CreatedSquad,
} from './createdSquad';
import {
  parseFeatureFlag,
  parseFeatureFlags,
  printFeatureFlag,
  printFeatureFlags,
  type FeatureFlag,
} from './featureFlags';
import {
  parseGeneratedInvite,
  printGeneratedInvite,
  type GeneratedInvite,
} from './generatedInvite';
import {
  parseInvitePreview,
  printInvitePreview,
  type InvitePreview,
} from './invitePreview';
import {
  parseInviteSummary,
  parseInviteSummaryList,
  printInviteSummary,
  printInviteSummaryList,
  type InviteSummary,
} from './inviteSummary';
import {
  parseDisplayRatingEntry,
  parseDisplayRatingLeaderboard,
  printDisplayRatingEntry,
  printDisplayRatingLeaderboard,
  type DisplayRatingEntry,
  type DisplayRatingLeaderboard,
} from './leaderboard';
import {
  MAX_INSTANT_MS,
  readInstantMs,
  type ParseResult,
} from './primitives';
import { parseRedemption, printRedemption, type Redemption } from './redemption';
import {
  parseSquadDetail,
  parseSquadMember,
  printSquadDetail,
  printSquadMember,
  type SquadDetail,
  type SquadMember,
} from './squadDetail';
import {
  parseSquadSummary,
  parseSquadSummaryList,
  printSquadSummary,
  printSquadSummaryList,
  type SquadSummary,
} from './squadSummary';

/*
 * The same modules again, as namespaces.
 *
 * These are not a second way of calling anything — nothing below invokes a
 * function through them. They exist so the coverage floor at the end of the file
 * can enumerate the Response_Parsers each module *exports* and compare that set,
 * by function reference, against the set this file actually states the round trip
 * for. Naming the parsers in a literal checklist instead would make the floor as
 * easy to forget as the arm it is meant to protect.
 *
 * `primitives.ts` is deliberately absent: its readers are field-level pieces a
 * Response_Parser is built from rather than parsers of a response body, and its
 * one printer (`printInstant`) has no body-level parser to pair with — it is
 * exercised through `readInstantMs` in the wire-form section instead.
 */
import * as createdGuestModule from './createdGuest';
import * as createdSquadModule from './createdSquad';
import * as featureFlagsModule from './featureFlags';
import * as generatedInviteModule from './generatedInvite';
import * as invitePreviewModule from './invitePreview';
import * as inviteSummaryModule from './inviteSummary';
import * as leaderboardModule from './leaderboard';
import * as redemptionModule from './redemption';
import * as squadDetailModule from './squadDetail';
import * as squadSummaryModule from './squadSummary';

/**
 * Property test for the Response_Parser / Response_Printer pair, placed beside
 * the modules it covers as the design's Testing Strategy asks and running well
 * above the 100-iteration floor (20.1).
 *
 * This file carries **Property 36: Printing then parsing a value is the
 * identity** — for any producible parsed value of any of the feature's response
 * shapes, parsing that value's printed form yields a parsed outcome equal to the
 * original in every field, with enum values carried as their Wire_Enum_Names and
 * instants as the same instant on the time line (12.11, 16.5, 20.2).
 *
 * Four things about how this is written matter more than the run counts.
 *
 * First, the round trip is stated **per shape, over all fifteen of them** — the
 * eleven body shapes plus the four element shapes their collections are built
 * from. One driver ({@link describeRoundTrip}) states the property once and is
 * invoked per shape, so a printer that forgot a field cannot hide behind a
 * sibling shape that round-trips.
 *
 * Second, only **producible** values are generated, because the property is about
 * values a parser can yield and no others. That constraint is read from the
 * modules rather than guessed:
 *
 *  - an identity is the 36-character hyphenated form `lib/identifiers.ts` accepts,
 *    in either letter case, and letter case is preserved because the identity is
 *    opaque to this feature;
 *  - an instant is a **whole millisecond** within `MAX_INSTANT_MS`, since
 *    `printInstant` deliberately prints anything else as a string the reader
 *    rejects rather than truncating it — a value that cannot round-trip must not
 *    appear to;
 *  - `redeemableLink` and `code` are non-empty, the bound `parseGeneratedInvite`
 *    states;
 *  - a leaderboard's entries carry **distinct** membership identities, because
 *    `parseDisplayRatingLeaderboard` fails a repeated one (8.11) — a generated
 *    duplicate would fail here for that reason rather than for a printer defect.
 *
 * A generator that drifted outside those bounds would report a printer defect
 * that is not there, so the last `describe` in the file asserts the generators'
 * own producibility directly.
 *
 * Third, **the comparison is over parsed values, and the wire form is checked
 * separately.** A parsed value holds an instant as epoch milliseconds and an enum
 * as its named value, so equality of parsed values compares instants as numbers
 * and enums as names — which is what makes the round trip exact rather than
 * spelling-sensitive: `'2026-01-01T00:00:00Z'` and `'2026-01-01T00:00:00.000+00:00'`
 * are the same instant. That the *wire* form carries the enum as a member name of
 * its Generated_Enum_Union and the instant as ISO-8601 with an explicit `Z` is a
 * separate claim, asserted against each union's declared names and against
 * `readInstantMs` in its own section — without it, a pair that printed and parsed
 * some private spelling would round-trip perfectly and still be wrong on the
 * wire.
 *
 * Fourth, the shapes the task names explicitly are generated by name rather than
 * left to chance: `Redemption` in **both** the identity-bearing form and the
 * empty-body form the already-a-member no-op answers with, and leaderboards with
 * **0, 1, and 200** entries. Collections of 0, 1, and 200 are stated for the
 * member list and both response lists too, since a fold that mishandled an empty
 * or singleton collection is exactly the defect a mid-sized random array misses.
 *
 * ### What the contract migration added
 *
 * The same identity is also **Property 25 of the api-response-contracts work**,
 * and that restatement is not a relabelling of the old one: it narrows the claim
 * in two places, both of which are asserted below rather than assumed.
 *
 * Fifth, then: every enum value in this file is a **Wire_Enum_Name read from
 * `lib/wireEnums.ts`** (12.11). No generator carries a numeric code, and none
 * carries a retired lower-case or kebab spelling — the names are read from the
 * feature's single declaration of each union, and the shape of the names
 * themselves is asserted in the generator section so a vocabulary that regressed
 * to `'live-match-tracking'` would fail here rather than round-trip happily
 * through a pair that agreed on it.
 *
 * Sixth, the two new Squad_Member fields are generated on **every** member rather
 * than inherited from the general text generators: an `appearances` count across
 * the whole range `parseSquadMember` accepts — **zero included**, because that is
 * the form a never-played membership arrives in — and a `ratingState` across
 * **both** members of its union *and* the valid absence that means no rating is
 * established (12.9). A squad detail in which every member carries both is
 * generated by name, since that is the value Property 25 quantifies over
 * explicitly.
 *
 * Seventh, the file states its own **coverage floor**. The set of pairs the
 * driver was invoked for is compared, by function reference, against the
 * Response_Parsers the modules under `lib/parse/` actually export: a deleted arm
 * fails there rather than quietly shrinking what the property claims, and a newly
 * added parser fails there rather than arriving uncovered.
 *
 * Requirements: 12.9, 12.11, 16.5, 20.2
 */

/* -------------------------------------------------------------------------- */
/* Generators — producible values only                                        */
/* -------------------------------------------------------------------------- */

/** The hexadecimal digits an identity is spelled with, in both letter cases. */
const HEX_DIGITS = '0123456789abcdefABCDEF'.split('');

/** A run of `length` hexadecimal digits, mixed case. */
function hexRunArb(length: number): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...HEX_DIGITS), { minLength: length, maxLength: length })
    .map((digits) => digits.join(''));
}

/**
 * An identity in the 36-character hyphenated form, in mixed, lower, and upper
 * case. Case is generated deliberately: the parser preserves it, so a printer
 * that normalised it would break the round trip on an upper-case identity alone.
 */
const identityArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc
      .tuple(hexRunArb(8), hexRunArb(4), hexRunArb(4), hexRunArb(4), hexRunArb(12))
      .map((groups) => groups.join('-')),
  },
  { weight: 2, arbitrary: fc.uuid() },
  { weight: 1, arbitrary: fc.uuid().map((identity) => identity.toUpperCase()) },
);

/**
 * The name and display-name edges the design's Testing Strategy names: 0, 1, 100,
 * and 101 characters, whitespace-only, values equal to and near
 * `"Former player"`, and names differing only in case.
 */
const EDGE_TEXTS = [
  '',
  ' ',
  '   ',
  '\t',
  '\n',
  'a',
  'A',
  'Dave',
  'BigDave',
  'dave',
  'Former player',
  'former player',
  'Former Player',
  'Former player ',
  ' Former player',
  'Former playe',
  'A'.repeat(100),
  'A'.repeat(101),
  '🙂',
  '👨‍👩‍👧‍👦',
  'e\u0301',
  '\u00e9',
  '\u0000',
  'null',
  'undefined',
  'NaN',
  '__proto__',
  'constructor',
  'toString',
] as const;

/**
 * A free-form wire string. `readString` with no bounds accepts every string
 * exactly as supplied — nothing is trimmed and nothing is coerced — so every
 * string is producible, lone surrogates and control characters included.
 */
const wireTextArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: fc.string({ maxLength: 40 }) },
  { weight: 2, arbitrary: fc.constantFrom(...EDGE_TEXTS) },
  { weight: 2, arbitrary: fc.string({ unit: 'grapheme', maxLength: 16 }) },
  { weight: 1, arbitrary: fc.string({ unit: 'binary', maxLength: 16 }) },
);

/**
 * A non-empty wire string, for the two secret-bearing fields of a
 * Generated_Invite: `parseGeneratedInvite` reads both with `{ minLength: 1 }`, so
 * the empty string is not a producible value there.
 */
const nonEmptyWireTextArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: fc.string({ minLength: 1, maxLength: 64 }) },
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      'a',
      ' ',
      'https://pitch-mate.co.uk/join/018f3a2b4c5d7e6f8a9b0c1d2e3f4a5b',
      'https://pitch-mate.co.uk/join/a%2Fb',
      'ABCD-1234',
      '🙂',
      'x'.repeat(512),
    ),
  },
  { weight: 2, arbitrary: fc.string({ unit: 'grapheme', minLength: 1, maxLength: 16 }) },
);

/**
 * Instants at the edges of what is printable: the epoch, the millisecond either
 * side of it, the year-0 and year-10000 boundaries where the printed form widens
 * to an expanded signed year, a leap day, sub-second precision, and both extremes
 * of the representable range.
 */
const EDGE_INSTANTS_MS = [
  0,
  1,
  -1,
  999,
  -999,
  1_000,
  1_700_000_000_123,
  1_767_225_600_000,
  1_709_164_800_000,
  -62_167_219_200_000,
  -62_167_219_200_001,
  253_402_300_799_999,
  253_402_300_800_000,
  MAX_INSTANT_MS,
  -MAX_INSTANT_MS,
  MAX_INSTANT_MS - 1,
  -MAX_INSTANT_MS + 1,
] as const;

/**
 * A producible instant: a whole millisecond within `MAX_INSTANT_MS`.
 *
 * The bound is not incidental. `printInstant` prints a fraction, an infinity, or
 * an out-of-range value as a string the reader **rejects**, precisely so a value
 * that cannot round-trip does not appear to — so those values are not producible
 * and are not generated here.
 *
 * **Negative zero is not a producible instant either.** `readInstantMs` yields
 * `localMs - offsetMinutes * 60_000`, and that subtraction produces positive zero
 * at the epoch, so no parse ever yields `-0`. It is worth stating because the
 * asymmetry is real and would otherwise look like a defect: `printInstant(-0)`
 * prints the epoch, which reads back as `+0`. Since a parser cannot produce `-0`
 * in an instant field, Property 36 says nothing about it — unlike a leaderboard
 * `value`, where `readNumber` accepts and preserves `-0` and the round trip
 * therefore must hold for it.
 */
const instantMsArb: fc.Arbitrary<number> = fc.oneof(
  // The four-digit-year range, where the great majority of real instants sit.
  {
    weight: 6,
    arbitrary: fc.integer({ min: -62_167_219_200_000, max: 253_402_300_799_999 }),
  },
  // The whole representable range, including the expanded-year regions.
  { weight: 3, arbitrary: fc.integer({ min: -MAX_INSTANT_MS, max: MAX_INSTANT_MS }) },
  { weight: 3, arbitrary: fc.constantFrom(...EDGE_INSTANTS_MS) },
);

/**
 * A producible leaderboard value: any finite number, since `readNumber` accepts
 * every finite number and the rounding to a displayed integer belongs to
 * `lib/ratingPresentation.ts` rather than to the parser (8.9).
 */
const leaderboardValueArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 4, arbitrary: fc.integer({ min: -5_000, max: 5_000 }) },
  {
    weight: 3,
    arbitrary: fc
      .double({ noNaN: true, noDefaultInfinity: true })
      .filter(Number.isFinite),
  },
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      0,
      -0,
      0.5,
      -0.5,
      1_000,
      1_499.5,
      -1_499.5,
      Number.EPSILON,
      Number.MIN_VALUE,
      -Number.MIN_VALUE,
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
      2 ** 53,
      -(2 ** 53),
    ),
  },
);

/**
 * A record arbitrary whose values are ordinary objects.
 *
 * `fc.record` builds its values on a **null prototype**, while a parser builds
 * its result from an object literal. The two are equal field for field and
 * different in type, so `toStrictEqual` — which is right to separate them — would
 * report every round trip as a failure for a reason that has nothing to do with
 * the pair under test. Normalising here keeps the comparison strict about the
 * thing that matters (fields, and the absence of stray `undefined` ones) without
 * making it a test of how fast-check allocates.
 */
function plainRecord<T extends object>(arb: fc.Arbitrary<T>): fc.Arbitrary<T> {
  return arb.map((value) => ({ ...value }));
}

/**
 * The member names of each wire enum, read out of `lib/wireEnums.ts` — the
 * feature's single declaration of each union, itself pinned to the
 * Generated_Enum_Union at compile time (12.2, 12.3). This file must not carry a
 * second declaration of the names, and must not carry a numeric enum literal at
 * all.
 */
const memberRoleArb = fc.constantFrom(...SQUAD_ROLE_NAMES);
const membershipStateArb = fc.constantFrom(...MEMBERSHIP_STATE_NAMES);
const ratingStateArb = fc.constantFrom(...RATING_STATE_NAMES);
// The feature is a Wire_Enum_Name now, read from the feature's single
// declaration of the union (12.2, 12.11).
const squadFeatureArb = fc.constantFrom(...SQUAD_FEATURE_NAMES);
// The invite state and the redemption outcome are Wire_Enum_Names now, read from
// the feature's single declaration of each union (12.2, 12.11).
const inviteStateArb = fc.constantFrom(...INVITE_STATE_NAMES);
const redeemOutcomeArb = fc.constantFrom(...REDEEM_OUTCOME_NAMES);

/** A Squad_Summary; `role` and `state` are absences for a caller with no membership. */
const squadSummaryArb: fc.Arbitrary<SquadSummary> = plainRecord(
  fc.record({
    squadId: identityArb,
    name: wireTextArb,
    role: fc.option(memberRoleArb, { nil: null }),
    state: fc.option(membershipStateArb, { nil: null }),
  }),
);

/**
 * The Appearance_Count edges worth naming: never played, the first two matches, a
 * plausible long-standing member, the `int32` the contract declares, and the
 * largest integer a JSON number carries exactly.
 *
 * Zero leads the list because it is not an edge case at all — it is how a
 * membership that has never played, and a membership the standing source had no
 * row for, both arrive (10.5, 12.9). A round trip that quietly lost it would
 * misreport every new player.
 */
const EDGE_APPEARANCE_COUNTS = [
  0,
  -0,
  1,
  2,
  400,
  2_147_483_647,
  Number.MAX_SAFE_INTEGER,
] as const;

/**
 * A producible Appearance_Count: a **non-negative whole number**, which is
 * exactly the bound `readAppearanceCount` enforces — nothing is rounded and
 * nothing is clamped, so a fraction or a negative is not producible and is not
 * generated. `-0` *is* producible: `Number.isInteger(-0)` holds and `-0 < 0` does
 * not, so the reader carries it through rather than repairing it, and the round
 * trip therefore has to preserve it (`toStrictEqual` tells it from `0`).
 */
const appearanceCountArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 5, arbitrary: fc.nat({ max: 400 }) },
  { weight: 3, arbitrary: fc.constantFrom(...EDGE_APPEARANCE_COUNTS) },
  { weight: 1, arbitrary: fc.nat() },
);

/**
 * A Rating_State_Signal as it sits on a member: either member of the union, or
 * the absence that means no rating is established for that membership (12.9).
 *
 * Uniform over the three rather than built with `fc.option`, so each of the two
 * names and the absence is reached often — the absence and `Provisional` are the
 * two the Player_List renders differently from everything else, and a weighting
 * that made one rare would weaken the property without failing it. The names come
 * from `RATING_STATE_NAMES`; nothing here spells one out.
 */
const ratingStateOrAbsenceArb: fc.Arbitrary<RatingState | null> = fc.constantFrom(
  ...RATING_STATE_NAMES,
  null,
);

/**
 * A Squad_Member; `role` is an absence for a guest, `state` is always present,
 * and `ratingState` is an absence for a membership with no rating established.
 */
const squadMemberArb: fc.Arbitrary<SquadMember> = plainRecord(
  fc.record({
    membershipId: identityArb,
    displayName: wireTextArb,
    role: fc.option(memberRoleArb, { nil: null }),
    state: membershipStateArb,
    isGuest: fc.boolean(),
    appearances: appearanceCountArb,
    ratingState: ratingStateOrAbsenceArb,
  }),
);

/**
 * A Squad_Member whose rating state is **present**, for the value Property 25
 * names: a squad detail carrying an appearance count and a rating state on every
 * member. Generated separately because {@link squadMemberArb} reaches the absence
 * a third of the time, so a random squad of eight members almost never has a
 * state on all eight.
 */
const decoratedSquadMemberArb: fc.Arbitrary<SquadMember> = plainRecord(
  fc.record({
    membershipId: identityArb,
    displayName: wireTextArb,
    role: fc.option(memberRoleArb, { nil: null }),
    state: membershipStateArb,
    isGuest: fc.boolean(),
    appearances: appearanceCountArb,
    ratingState: ratingStateArb,
  }),
);

/** A Feature_Flag. A repeated feature is producible: the collection parser allows it. */
const featureFlagArb: fc.Arbitrary<FeatureFlag> = plainRecord(
  fc.record({
    feature: squadFeatureArb,
    isEnabled: fc.boolean(),
  }),
);

const featureFlagsArb: fc.Arbitrary<readonly FeatureFlag[]> = fc.array(featureFlagArb, {
  maxLength: 4,
});

/**
 * A Squad_Detail. Members may repeat a display name and even an identity — the
 * parser imposes no uniqueness there, unlike the leaderboard.
 */
const squadDetailArb: fc.Arbitrary<SquadDetail> = plainRecord(
  fc.record({
    squadId: identityArb,
    name: wireTextArb,
    members: fc.array(squadMemberArb, { maxLength: 8 }),
    features: featureFlagsArb,
  }),
);

/**
 * The squad detail Property 25 names: **every** member carries an appearance
 * count and a present rating state, and the squad has at least one member so the
 * claim is not satisfied by an empty list.
 */
const decoratedSquadDetailArb: fc.Arbitrary<SquadDetail> = plainRecord(
  fc.record({
    squadId: identityArb,
    name: wireTextArb,
    members: fc.array(decoratedSquadMemberArb, { minLength: 1, maxLength: 8 }),
    features: featureFlagsArb,
  }),
);

/** An Invite_Summary; `createdBy` is a free-form actor string, `expiresAt` an absence. */
const inviteSummaryArb: fc.Arbitrary<InviteSummary> = plainRecord(
  fc.record({
    inviteId: identityArb,
    state: inviteStateArb,
    createdAtMs: instantMsArb,
    createdBy: fc.option(wireTextArb, { nil: null }),
    expiresAtMs: fc.option(instantMsArb, { nil: null }),
  }),
);

const generatedInviteArb: fc.Arbitrary<GeneratedInvite> = plainRecord(
  fc.record({
    inviteId: identityArb,
    redeemableLink: nonEmptyWireTextArb,
    code: nonEmptyWireTextArb,
    expiresAtMs: fc.option(instantMsArb, { nil: null }),
  }),
);

const invitePreviewArb: fc.Arbitrary<InvitePreview> = plainRecord(
  fc.record({
    requiresAuthentication: fc.boolean(),
    message: wireTextArb,
  }),
);

const createdSquadArb: fc.Arbitrary<CreatedSquad> = plainRecord(
  fc.record({
    squadId: identityArb,
    ownerMembershipId: identityArb,
  }),
);

const createdGuestArb: fc.Arbitrary<CreatedGuest> = plainRecord(
  fc.record({
    guestMembershipId: identityArb,
  }),
);

/** The identity-bearing Redemption form: a membership and a named outcome. */
const identityBearingRedemptionArb: fc.Arbitrary<Redemption> = plainRecord(
  fc.record({
    membershipId: identityArb,
    outcome: redeemOutcomeArb,
    squadId: fc.option(identityArb, { nil: null }),
  }),
);

/**
 * Every other producible Redemption: each of the three fields independently
 * present or absent, since each is read through `readOptional` in its own right.
 *
 * Built from a tuple rather than through {@link plainRecord}, because a record of
 * three optional readings widens to a type with *optional* properties, and a
 * Redemption's fields are present-and-nullable rather than optional — the parser
 * always yields all three.
 */
const mixedRedemptionArb: fc.Arbitrary<Redemption> = fc
  .tuple(
    fc.option(identityArb, { nil: null }),
    fc.option(redeemOutcomeArb, { nil: null }),
    fc.option(identityArb, { nil: null }),
  )
  .map(([membershipId, outcome, squadId]) => ({ membershipId, outcome, squadId }));

/**
 * Every producible Redemption, weighted so both forms the task names occur often:
 * the identity-bearing form, the all-absent value the empty body parses to, and
 * the mixed values the field-by-field optionality admits.
 */
const redemptionArb: fc.Arbitrary<Redemption> = fc.oneof(
  { weight: 4, arbitrary: identityBearingRedemptionArb },
  {
    weight: 2,
    arbitrary: fc.constant<Redemption>({
      membershipId: null,
      outcome: null,
      squadId: null,
    }),
  },
  { weight: 4, arbitrary: mixedRedemptionArb },
);

const displayRatingEntryArb: fc.Arbitrary<DisplayRatingEntry> = plainRecord(
  fc.record({
    membershipId: identityArb,
    displayName: wireTextArb,
    value: leaderboardValueArb,
  }),
);

/**
 * A leaderboard of `minLength`..`maxLength` entries carrying **distinct**
 * membership identities, because a repeated identity fails the parser (8.11) and
 * is therefore not a producible value.
 */
function leaderboardArb(
  minLength: number,
  maxLength: number,
): fc.Arbitrary<DisplayRatingLeaderboard> {
  return fc
    .uniqueArray(displayRatingEntryArb, {
      selector: (entry) => entry.membershipId,
      minLength,
      maxLength,
    })
    .map((entries) => ({ entries }));
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The value of a reading that must have succeeded, raising with the reading's own
 * diagnostic reason when it did not.
 *
 * A reason is composed from literal labels only and never embeds the value that
 * was read, so surfacing it here cannot leak an Invite_Secret or a display name
 * into the test output (4.10, 17.2). fast-check reports the counterexample
 * separately.
 */
function mustParse<T>(parsed: ParseResult<T>): T {
  if (!parsed.ok) {
    throw new Error(`the printed form did not parse back: ${parsed.reason}`);
  }

  return parsed.value;
}

/** A printed wire form established as a plain object, for reading its properties. */
function wireObject(printed: unknown): Record<string, unknown> {
  expect(typeof printed).toBe('object');
  expect(printed).not.toBeNull();
  expect(Array.isArray(printed)).toBe(false);

  return printed as Record<string, unknown>;
}

/** A printed wire form established as an array. */
function wireArray(printed: unknown): readonly unknown[] {
  expect(Array.isArray(printed)).toBe(true);

  return printed as readonly unknown[];
}

/** The keys of a wire object, sorted, so a field set can be asserted whole. */
function wireKeys(printed: unknown): readonly string[] {
  return Object.keys(wireObject(printed)).sort();
}

/* -------------------------------------------------------------------------- */
/* The property, stated once and run per shape                                */
/* -------------------------------------------------------------------------- */

/**
 * One Response_Parser / Response_Printer pair this file states the round trip
 * for, recorded as the driver is invoked.
 *
 * The parser is held by reference rather than by name so the coverage floor can
 * compare this registry against what the modules export without a second,
 * hand-maintained list of parser names to fall out of date.
 */
interface CoveredPair {
  readonly label: string;
  readonly parse: (body: unknown) => ParseResult<unknown>;
  readonly print: (value: never) => unknown;
}

/** Every pair the driver below was invoked for, in invocation order. */
const COVERED_PAIRS: CoveredPair[] = [];

/**
 * Property 36 / Property 25 for one response shape.
 *
 * @param label the shape's name, for the test titles
 * @param arb producible values of the shape — see the module note on producibility
 * @param print the shape's Response_Printer
 * @param parse the shape's Response_Parser
 * @param numRuns iterations, at or above the 100-iteration floor (20.1)
 */
function describeRoundTrip<T>(
  label: string,
  arb: fc.Arbitrary<T>,
  print: (value: T) => unknown,
  parse: (body: unknown) => ParseResult<T>,
  numRuns = 300,
): void {
  // Registered before the tests are declared, so the coverage floor at the end of
  // the file sees every arm regardless of the order Vitest runs them in: the
  // registrations all happen while the file is being collected, and the floor's
  // assertions run afterwards.
  COVERED_PAIRS.push({
    label,
    parse: parse as (body: unknown) => ParseResult<unknown>,
    print,
  });

  // Feature: web-squads-screens, Property 36: Printing then parsing a value is the identity
  // Feature: api-response-contracts, Property 25: Parser and printer round-trip, including the new member fields
  // Validates: Requirements 12.9, 12.11, 16.5, 20.2
  describe(`round trip — ${label}`, () => {
    it('parses its own printed form back to a value equal in every field', () => {
      fc.assert(
        fc.property(arb, (value) => {
          // The property proper (16.5): parse(print(v)) equals v. Instants compare
          // as epoch milliseconds and enums as named values, because that is what
          // a parsed value holds — the wire spelling is asserted separately.
          expect(mustParse(parse(print(value)))).toStrictEqual(value);
        }),
        { numRuns },
      );
    });

    it('reaches a fixed point, so a second round trip changes nothing', () => {
      fc.assert(
        fc.property(arb, (value) => {
          const once = mustParse(parse(print(value)));
          const twice = mustParse(parse(print(once)));

          // Identity once implies identity forever, but stating it catches a pair
          // that agreed on a *normalised* value rather than on the original: a
          // printer that dropped a field would settle on the second pass and pass
          // a weaker property that only compared consecutive rounds.
          expect(twice).toStrictEqual(once);
          expect(print(once)).toStrictEqual(print(value));
        }),
        { numRuns },
      );
    });

    it('prints a wire form determined by the value alone', () => {
      fc.assert(
        fc.property(arb, (value) => {
          // A printer is pure (16.10): no clock, no storage, no counter. Two
          // printings of one value must be indistinguishable, or the round trip
          // would hold only for whichever printing the parser happened to see.
          expect(print(value)).toStrictEqual(print(value));
        }),
        { numRuns },
      );
    });
  });
}

describeRoundTrip<SquadSummary>(
  'Squad_Summary',
  squadSummaryArb,
  printSquadSummary,
  parseSquadSummary,
);

describeRoundTrip<readonly SquadSummary[]>(
  'the ListMySquads body',
  fc.array(squadSummaryArb, { maxLength: 8 }),
  printSquadSummaryList,
  parseSquadSummaryList,
);

describeRoundTrip<SquadMember>(
  'Squad_Member',
  squadMemberArb,
  printSquadMember,
  parseSquadMember,
);

describeRoundTrip<SquadDetail>(
  'the GetSquad body',
  squadDetailArb,
  printSquadDetail,
  parseSquadDetail,
);

describeRoundTrip<FeatureFlag>(
  'Feature_Flag',
  featureFlagArb,
  printFeatureFlag,
  parseFeatureFlag,
);

describeRoundTrip<readonly FeatureFlag[]>(
  'the GetFeatureFlags body',
  featureFlagsArb,
  printFeatureFlags,
  parseFeatureFlags,
);

describeRoundTrip<InviteSummary>(
  'Invite_Summary',
  inviteSummaryArb,
  printInviteSummary,
  parseInviteSummary,
);

describeRoundTrip<readonly InviteSummary[]>(
  'the ListInvites body',
  fc.array(inviteSummaryArb, { maxLength: 8 }),
  printInviteSummaryList,
  parseInviteSummaryList,
);

describeRoundTrip<GeneratedInvite>(
  'Generated_Invite',
  generatedInviteArb,
  printGeneratedInvite,
  parseGeneratedInvite,
);

describeRoundTrip<InvitePreview>(
  'Invite_Preview',
  invitePreviewArb,
  printInvitePreview,
  parseInvitePreview,
);

describeRoundTrip<CreatedSquad>(
  'Created_Squad',
  createdSquadArb,
  printCreatedSquad,
  parseCreatedSquad,
);

describeRoundTrip<CreatedGuest>(
  'Created_Guest',
  createdGuestArb,
  printCreatedGuest,
  parseCreatedGuest,
);

describeRoundTrip<Redemption>(
  'Redemption, both wire forms',
  redemptionArb,
  printRedemption,
  parseRedemption,
);

describeRoundTrip<DisplayRatingEntry>(
  'a Display_Rating entry',
  displayRatingEntryArb,
  printDisplayRatingEntry,
  parseDisplayRatingEntry,
);

describeRoundTrip<DisplayRatingLeaderboard>(
  'the GetSquadLeaderboard body',
  leaderboardArb(0, 12),
  printDisplayRatingLeaderboard,
  parseDisplayRatingLeaderboard,
);

/* -------------------------------------------------------------------------- */
/* The wire form: enums as names, instants as ISO-8601 with an explicit Z       */
/* -------------------------------------------------------------------------- */

/**
 * The round trip above compares *parsed* values, which is what makes it exact.
 * That leaves one thing unstated, and it is the thing that would matter on a real
 * wire: a pair that agreed on some private spelling of an enum would satisfy the
 * identity and still be wrong. So the printed form is checked against each
 * union's declared member names and against `readInstantMs`, and each shape's
 * field set is asserted whole so a printer cannot emit a property its parser
 * never reads — or omit one it does.
 */
// Feature: web-squads-screens, Property 36: Printing then parsing a value is the identity
// Validates: Requirements 12.11, 16.5, 20.2
describe('round trip — the wire form carries enums as names and instants as instants', () => {
  it('prints a Squad_Summary as four properties, each enum as its name', () => {
    fc.assert(
      fc.property(squadSummaryArb, (summary) => {
        const wire = wireObject(printSquadSummary(summary));

        expect(wireKeys(wire)).toStrictEqual(['name', 'role', 'squadId', 'state']);
        expect(wire.squadId).toBe(summary.squadId);
        expect(wire.name).toBe(summary.name);
        // 12.11: a Wire_Enum_Name, emitted verbatim, and a member of the
        // generated vocabulary — not a number under another spelling.
        expect(wire.role).toBe(summary.role);
        expect(wire.state).toBe(summary.state);

        if (summary.role !== null) {
          expect(SQUAD_ROLE_NAMES).toContain(wire.role);
        }

        if (summary.state !== null) {
          expect(MEMBERSHIP_STATE_NAMES).toContain(wire.state);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('prints a Squad_Member with its enums as names and both standing fields', () => {
    fc.assert(
      fc.property(squadMemberArb, (member) => {
        const wire = wireObject(printSquadMember(member));

        expect(wireKeys(wire)).toStrictEqual([
          'appearances',
          'displayName',
          'isGuest',
          'membershipId',
          'ratingState',
          'role',
          'state',
        ]);
        expect(wire.membershipId).toBe(member.membershipId);
        expect(wire.displayName).toBe(member.displayName);
        expect(wire.role).toBe(member.role);
        // Required rather than nullable here: a membership always has a state.
        expect(wire.state).toBe(member.state);
        expect(MEMBERSHIP_STATE_NAMES).toContain(wire.state);
        expect(wire.isGuest).toBe(member.isGuest);
        // 12.9: the appearance count as a number and the rating state as a name
        // or an absence — the two fields the player list needs to tell
        // never-played from provisional.
        expect(wire.appearances).toBe(member.appearances);
        expect(typeof wire.appearances).toBe('number');
        expect(wire.ratingState).toBe(member.ratingState);

        if (member.ratingState !== null) {
          expect(RATING_STATE_NAMES).toContain(wire.ratingState);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('prints a Feature_Flag as its feature name and state', () => {
    fc.assert(
      fc.property(featureFlagArb, (flag) => {
        const wire = wireObject(printFeatureFlag(flag));

        expect(wireKeys(wire)).toStrictEqual(['feature', 'isEnabled']);
        // 12.11: a Wire_Enum_Name, and a member of the generated vocabulary —
        // not a number, and not the parsed value under another spelling.
        expect(wire.feature).toBe(flag.feature);
        expect(SQUAD_FEATURE_NAMES).toContain(wire.feature);
        expect(typeof wire.feature).toBe('string');
        expect(wire.isEnabled).toBe(flag.isEnabled);
      }),
      { numRuns: 200 },
    );
  });

  it('prints an Invite_Summary state as its name and both instants as ISO-8601 with a Z', () => {
    fc.assert(
      fc.property(inviteSummaryArb, (summary) => {
        const wire = wireObject(printInviteSummary(summary));

        expect(wireKeys(wire)).toStrictEqual([
          'createdAt',
          'createdBy',
          'expiresAt',
          'inviteId',
          'state',
        ]);
        // 12.11: the printer emits the Wire_Enum_Name verbatim.
        expect(wire.state).toBe(summary.state);
        expect(INVITE_STATE_NAMES).toContain(wire.state);
        // The same instant on the time line, not the same string: the reader is
        // what decides, so it is the reader that is asked.
        expect(typeof wire.createdAt).toBe('string');
        expect(String(wire.createdAt).endsWith('Z')).toBe(true);
        expect(mustParse(readInstantMs(wire.createdAt, 'createdAt'))).toBe(
          summary.createdAtMs,
        );

        if (summary.expiresAtMs === null) {
          expect(wire.expiresAt).toBeNull();
        } else {
          expect(String(wire.expiresAt).endsWith('Z')).toBe(true);
          expect(mustParse(readInstantMs(wire.expiresAt, 'expiresAt'))).toBe(
            summary.expiresAtMs,
          );
        }

        // A free-form actor string, printed as it stands — not an identity.
        expect(wire.createdBy).toBe(summary.createdBy);
      }),
      { numRuns: 400 },
    );
  });

  it('prints a Generated_Invite expiry as ISO-8601 with a Z, or as an absence', () => {
    fc.assert(
      fc.property(generatedInviteArb, (invite) => {
        const wire = wireObject(printGeneratedInvite(invite));

        expect(wireKeys(wire)).toStrictEqual([
          'code',
          'expiresAt',
          'inviteId',
          'redeemableLink',
        ]);
        // Both secret-bearing fields survive verbatim: this body carries the
        // Invite_Secret exactly once, so a printer that altered it would be
        // altering a value nothing can re-read.
        expect(wire.redeemableLink).toBe(invite.redeemableLink);
        expect(wire.code).toBe(invite.code);

        if (invite.expiresAtMs === null) {
          expect(wire.expiresAt).toBeNull();
        } else {
          expect(String(wire.expiresAt).endsWith('Z')).toBe(true);
          expect(mustParse(readInstantMs(wire.expiresAt, 'expiresAt'))).toBe(
            invite.expiresAtMs,
          );
        }
      }),
      { numRuns: 300 },
    );
  });

  it('prints a Redemption as three nullable properties in both forms', () => {
    fc.assert(
      fc.property(redemptionArb, (redemption) => {
        const wire = wireObject(printRedemption(redemption));

        // The no-op form prints as three nulls rather than as an absent body, so
        // that one code path serves both wire forms and the round trip stays exact.
        expect(wireKeys(wire)).toStrictEqual(['membershipId', 'outcome', 'squadId']);
        expect(wire.membershipId).toBe(redemption.membershipId);
        expect(wire.squadId).toBe(redemption.squadId);
        // 12.11: a present outcome is printed as its Wire_Enum_Name verbatim.
        expect(wire.outcome).toBe(redemption.outcome);

        if (redemption.outcome !== null) {
          expect(REDEEM_OUTCOME_NAMES).toContain(wire.outcome);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('prints a leaderboard as its entries alone, carrying no statistic', () => {
    fc.assert(
      fc.property(leaderboardArb(0, 8), (leaderboard) => {
        const wire = wireObject(printDisplayRatingLeaderboard(leaderboard));

        // `statistic` is not read and so is not printed: the caller already knows
        // which statistic it asked for, and it is a request enum this feature
        // deliberately does not name.
        expect(wireKeys(wire)).toStrictEqual(['entries']);
        expect(wireArray(wire.entries)).toHaveLength(leaderboard.entries.length);

        wireArray(wire.entries).forEach((printedEntry, index) => {
          const entry = leaderboard.entries[index];
          const entryWire = wireObject(printedEntry);

          expect(wireKeys(entryWire)).toStrictEqual([
            'displayName',
            'membershipId',
            'value',
          ]);
          expect(entryWire.membershipId).toBe(entry.membershipId);
          expect(entryWire.displayName).toBe(entry.displayName);
          // The value is printed as the number it is: no rounding, no scaling.
          expect(entryWire.value).toBe(entry.value);
        });
      }),
      { numRuns: 300 },
    );
  });

  it('prints a Squad_Detail with its members and features in order', () => {
    fc.assert(
      fc.property(squadDetailArb, (detail) => {
        const wire = wireObject(printSquadDetail(detail));

        expect(wireKeys(wire)).toStrictEqual([
          'features',
          'members',
          'name',
          'squadId',
        ]);
        // Order is part of the value: the Player_Order sorts the parsed members,
        // so a printer that reordered them would make the round trip inexact in a
        // way only a sorted comparison would hide.
        expect(wireArray(wire.members)).toStrictEqual(
          detail.members.map(printSquadMember),
        );
        expect(wireArray(wire.features)).toStrictEqual(
          detail.features.map(printFeatureFlag),
        );
      }),
      { numRuns: 300 },
    );
  });

  it('prints an Invite_Preview as exactly the two properties its parser reads', () => {
    fc.assert(
      fc.property(invitePreviewArb, (preview) => {
        const wire = wireObject(printInvitePreview(preview));

        // Nothing else: this is the one anonymous call, and its body must disclose
        // nothing about whether a squad exists.
        expect(wireKeys(wire)).toStrictEqual(['message', 'requiresAuthentication']);
        expect(wire.requiresAuthentication).toBe(preview.requiresAuthentication);
        expect(wire.message).toBe(preview.message);
      }),
      { numRuns: 200 },
    );
  });

  it('prints the two identity-only bodies as their identities', () => {
    fc.assert(
      fc.property(createdSquadArb, createdGuestArb, (created, guest) => {
        const squadWire = wireObject(printCreatedSquad(created));
        const guestWire = wireObject(printCreatedGuest(guest));

        expect(wireKeys(squadWire)).toStrictEqual(['ownerMembershipId', 'squadId']);
        expect(squadWire.squadId).toBe(created.squadId);
        expect(squadWire.ownerMembershipId).toBe(created.ownerMembershipId);

        expect(wireKeys(guestWire)).toStrictEqual(['guestMembershipId']);
        expect(guestWire.guestMembershipId).toBe(guest.guestMembershipId);
      }),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Redemption: both wire forms, including the empty body                      */
/* -------------------------------------------------------------------------- */

/**
 * `RedeemInvite` is the one operation with two valid wire forms, and the round
 * trip has to hold for both. The identity-bearing form is covered by the driver
 * above; the empty body needs stating, because its *input* is an absence while
 * its printed form is an object — so "print then parse" and "parse then print
 * then parse" are different journeys and both must land on the same value.
 */
// Feature: web-squads-screens, Property 36: Printing then parsing a value is the identity
// Validates: Requirements 16.5, 20.2
describe('round trip — Redemption in the identity-bearing and empty-body forms', () => {
  it('parses the empty body to three absences, whether absent or null', () => {
    const fromAbsent = mustParse(parseRedemption(undefined));
    const fromNull = mustParse(parseRedemption(null));

    expect(fromAbsent).toStrictEqual({
      membershipId: null,
      outcome: null,
      squadId: null,
    });
    expect(fromNull).toStrictEqual(fromAbsent);
  });

  it('round-trips the value the empty body parses to', () => {
    fc.assert(
      // A constant, run under `fc.assert` so this sits inside the property rather
      // than beside it: the empty-body form is one of the values Property 36
      // quantifies over, not a separate example.
      fc.property(fc.constantFrom(undefined, null), (emptyBody) => {
        const parsed = mustParse(parseRedemption(emptyBody));
        const reparsed = mustParse(parseRedemption(printRedemption(parsed)));

        // Failing the empty body would turn "you are already in this squad" into
        // the Generic_Squads_Failure, so this is the round trip that keeps the
        // no-op a success.
        expect(reparsed).toStrictEqual(parsed);
      }),
      { numRuns: 100 },
    );
  });

  it('round-trips the identity-bearing form with both fields present', () => {
    fc.assert(
      fc.property(identityBearingRedemptionArb, (redemption) => {
        expect(mustParse(parseRedemption(printRedemption(redemption)))).toStrictEqual(
          redemption,
        );
      }),
      { numRuns: 300 },
    );
  });

  it('keeps the two forms distinguishable through the round trip', () => {
    fc.assert(
      fc.property(identityBearingRedemptionArb, (redemption) => {
        const empty = mustParse(parseRedemption(undefined));
        const bearing = mustParse(parseRedemption(printRedemption(redemption)));

        // The round trip must not collapse a redemption that joined a squad into
        // the no-op value: the Squads_Home's direct-navigation branch reads these
        // fields to decide where to go next (4.6, 5.8).
        expect(bearing).not.toStrictEqual(empty);
        expect(bearing.membershipId).toBe(redemption.membershipId);
        expect(bearing.outcome).toBe(redemption.outcome);
      }),
      { numRuns: 300 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Collections at 0, 1, and 200                                               */
/* -------------------------------------------------------------------------- */

/**
 * The sizes the task names, stated for each collection the feature parses. A
 * mid-sized random array exercises the general fold; 0 and 1 are where an
 * off-by-one or an empty-case special path would show, and 200 is where a
 * quadratic duplicate check or a recursive fold would.
 */
// Feature: web-squads-screens, Property 36: Printing then parsing a value is the identity
// Validates: Requirements 16.5, 20.2
describe('round trip — collections of 0, 1, and 200 entries', () => {
  const sizes = [0, 1, 200] as const;

  for (const size of sizes) {
    it(`round-trips a leaderboard of ${size} entries with distinct identities`, () => {
      fc.assert(
        fc.property(leaderboardArb(size, size), (leaderboard) => {
          expect(leaderboard.entries).toHaveLength(size);
          expect(
            mustParse(
              parseDisplayRatingLeaderboard(
                printDisplayRatingLeaderboard(leaderboard),
              ),
            ),
          ).toStrictEqual(leaderboard);
        }),
        { numRuns: 100 },
      );
    });

    it(`round-trips a squad of ${size} members`, () => {
      fc.assert(
        fc.property(
          plainRecord(
            fc.record({
              squadId: identityArb,
              name: wireTextArb,
              members: fc.array(squadMemberArb, { minLength: size, maxLength: size }),
              features: featureFlagsArb,
            }),
          ),
          (detail: SquadDetail) => {
            expect(detail.members).toHaveLength(size);
            expect(
              mustParse(parseSquadDetail(printSquadDetail(detail))),
            ).toStrictEqual(detail);
          },
        ),
        { numRuns: 100 },
      );
    });

    it(`round-trips a squads listing of ${size} summaries`, () => {
      fc.assert(
        fc.property(
          fc.array(squadSummaryArb, { minLength: size, maxLength: size }),
          (summaries) => {
            expect(
              mustParse(parseSquadSummaryList(printSquadSummaryList(summaries))),
            ).toStrictEqual(summaries);
          },
        ),
        { numRuns: 100 },
      );
    });

    it(`round-trips an invite listing of ${size} summaries`, () => {
      fc.assert(
        fc.property(
          fc.array(inviteSummaryArb, { minLength: size, maxLength: size }),
          (summaries) => {
            expect(
              mustParse(parseInviteSummaryList(printInviteSummaryList(summaries))),
            ).toStrictEqual(summaries);
          },
        ),
        { numRuns: 100 },
      );
    });
  }
});

/* -------------------------------------------------------------------------- */
/* The two new Squad_Member fields                                            */
/* -------------------------------------------------------------------------- */

/**
 * Property 25 narrows the identity to a value the driver above generates only by
 * accident: a squad detail carrying an appearance count **and** a rating state on
 * **every** member. {@link squadMemberArb} reaches the rating-state absence a
 * third of the time, so a random squad of eight has a state on all eight about
 * once in forty — often enough to pass, rarely enough that a printer which
 * dropped the field only when every member had one could survive. Stating the
 * decorated squad by name removes the luck.
 *
 * The two fields are then exercised one at a time: the count across the whole
 * range its reader accepts, and the state across both members of its union and
 * the absence that means no rating is established.
 */
// Feature: api-response-contracts, Property 25: Parser and printer round-trip, including the new member fields
// Validates: Requirements 12.9, 12.11
describe('round trip — a squad detail decorated on every member', () => {
  it('round-trips a squad whose every member carries a count and a rating state', () => {
    fc.assert(
      fc.property(decoratedSquadDetailArb, (detail) => {
        const parsed = mustParse(parseSquadDetail(printSquadDetail(detail)));

        // The premise, restated so the test cannot pass by generating a squad that
        // did not actually carry the fields (an empty members array would satisfy
        // "every member" vacuously, which is why the generator has a minimum of 1).
        expect(detail.members.length).toBeGreaterThanOrEqual(1);
        detail.members.forEach((member) => {
          expect(typeof member.appearances).toBe('number');
          expect(member.ratingState).not.toBeNull();
        });

        // 12.9: both decorations survive the round trip, on every member, in order.
        expect(parsed).toStrictEqual(detail);
      }),
      { numRuns: 300 },
    );
  });

  it('keeps each decoration on the member it belongs to', () => {
    fc.assert(
      fc.property(decoratedSquadDetailArb, (detail) => {
        const parsed = mustParse(parseSquadDetail(printSquadDetail(detail)));

        // A printer or parser that built the member array by index from two
        // separate walks could round-trip the *multiset* of decorations and still
        // hand a provisional badge to the wrong player. Asserted pairwise, since
        // `toStrictEqual` on the whole body would also pass if the fields were
        // consistently swapped between two members with otherwise equal rows.
        parsed.members.forEach((member, index) => {
          const original = detail.members[index];

          expect(member.membershipId).toBe(original.membershipId);
          expect(Object.is(member.appearances, original.appearances)).toBe(true);
          expect(member.ratingState).toBe(original.ratingState);
        });
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: api-response-contracts, Property 25: Parser and printer round-trip, including the new member fields
// Validates: Requirement 12.9
describe('round trip — the appearance count across the range its reader accepts', () => {
  for (const count of EDGE_APPEARANCE_COUNTS) {
    // `-0` and `0` print the same JSON number and are different values, so the
    // titles are spelled with `Object.is` semantics in mind.
    const title = Object.is(count, -0) ? '-0' : String(count);

    it(`round-trips a member with ${title} appearances`, () => {
      fc.assert(
        fc.property(squadMemberArb, (member) => {
          const withCount: SquadMember = { ...member, appearances: count };
          const parsed = mustParse(parseSquadMember(printSquadMember(withCount)));

          // `toStrictEqual` already separates `-0` from `0`; `Object.is` is stated
          // as well so a regression names the field rather than the whole member.
          expect(Object.is(parsed.appearances, count)).toBe(true);
          expect(parsed).toStrictEqual(withCount);
        }),
        { numRuns: 120 },
      );
    });
  }

  it('round-trips zero, which is how a never-played membership arrives', () => {
    fc.assert(
      fc.property(decoratedSquadMemberArb, (member) => {
        // Singled out because zero is the value the Player_List renders as "no
        // appearances yet", and it is also what a membership the standing source
        // had no row for reports (10.5). A pair that treated it as "missing" would
        // round-trip every other count perfectly.
        const neverPlayed: SquadMember = { ...member, appearances: 0 };

        expect(
          mustParse(parseSquadMember(printSquadMember(neverPlayed))),
        ).toStrictEqual(neverPlayed);
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: api-response-contracts, Property 25: Parser and printer round-trip, including the new member fields
// Validates: Requirements 12.9, 12.11
describe('round trip — the rating state across its union and its absence', () => {
  it('round-trips every member of the union and the absence, as a name or null', () => {
    fc.assert(
      fc.property(squadMemberArb, ratingStateOrAbsenceArb, (member, ratingState) => {
        const withState: SquadMember = { ...member, ratingState };
        const wire = wireObject(printSquadMember(withState));
        const parsed = mustParse(parseSquadMember(wire));

        // 12.11: on the wire the signal is a Wire_Enum_Name or an explicit `null`
        // — never a number, and never a lower-case or kebab spelling of the name.
        if (ratingState === null) {
          expect(wire.ratingState).toBeNull();
        } else {
          expect(wire.ratingState).toBe(ratingState);
          expect(RATING_STATE_NAMES).toContain(wire.ratingState);
          expect(typeof wire.ratingState).toBe('string');
        }

        expect(parsed.ratingState).toBe(ratingState);
        expect(parsed).toStrictEqual(withState);
      }),
      { numRuns: 400 },
    );
  });

  it('distinguishes the absence from both names through the round trip', () => {
    fc.assert(
      fc.property(squadMemberArb, (member) => {
        const absent = mustParse(
          parseSquadMember(printSquadMember({ ...member, ratingState: null })),
        );
        const present = RATING_STATE_NAMES.map((name) =>
          mustParse(
            parseSquadMember(printSquadMember({ ...member, ratingState: name })),
          ),
        );

        // The absence means "no rating established" and each name means a rating
        // that is, so collapsing the three would mislabel a player either way
        // round. Stated here because the identity alone would be satisfied by a
        // pair that mapped all three onto one value *and* back out of it.
        present.forEach((parsed, index) => {
          expect(parsed.ratingState).toBe(RATING_STATE_NAMES[index]);
          expect(parsed).not.toStrictEqual(absent);
        });
        expect(new Set(present.map((parsed) => parsed.ratingState)).size).toBe(
          RATING_STATE_NAMES.length,
        );
      }),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The generators are themselves producible                                   */
/* -------------------------------------------------------------------------- */

/**
 * Property 36 is a claim about *producible* values, so a generator that strayed
 * outside what a parser can yield would report a printer defect that is not
 * there — a fractional instant, an unhyphenated identity, or a leaderboard with a
 * repeated membership would each fail the round trip for a reason the printer is
 * not responsible for. These assertions pin the generators to the bounds the
 * modules state, so a failure above is a failure of the pair rather than of this
 * file.
 */
// Feature: web-squads-screens, Property 36: Printing then parsing a value is the identity
// Validates: Requirements 16.5, 20.2
describe('round trip — the generators produce only producible values', () => {
  it('generates identities in the 36-character hyphenated form', () => {
    fc.assert(
      fc.property(identityArb, (identity) => {
        expect(isSquadIdentifier(identity)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('generates instants as whole milliseconds within the representable range', () => {
    fc.assert(
      fc.property(instantMsArb, (instantMs) => {
        // Exactly the bound `printInstant` enforces. Outside it the printer emits
        // a string the reader rejects, deliberately, so such values are not
        // producible and must not be generated.
        expect(Number.isInteger(instantMs)).toBe(true);
        expect(Math.abs(instantMs)).toBeLessThanOrEqual(MAX_INSTANT_MS);
        // And never negative zero, which no parse yields — see the note on
        // `instantMsArb`.
        expect(Object.is(instantMs, -0)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('generates leaderboard values including negative zero, which a parse does yield', () => {
    // The counterpart of the rule above, stated so the two are not confused: a
    // `value` of `-0` is read and preserved by `readNumber`, so it is producible
    // and the round trip is asserted over it.
    expect(mustParse(readInstantMs('1970-01-01T00:00:00.000Z', 'epoch'))).toBe(0);
    expect(
      mustParse(
        parseDisplayRatingEntry(
          printDisplayRatingEntry({
            membershipId: '00000000-0000-7000-8000-000000000000',
            displayName: 'Dave',
            value: -0,
          }),
        ),
      ).value,
    ).toBe(-0);
  });

  it('generates leaderboard values that are finite numbers', () => {
    fc.assert(
      fc.property(leaderboardValueArb, (value) => {
        expect(Number.isFinite(value)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('generates leaderboards whose membership identities are distinct', () => {
    fc.assert(
      fc.property(leaderboardArb(0, 12), (leaderboard) => {
        const identities = leaderboard.entries.map((entry) => entry.membershipId);

        // The one uniqueness rule in the parsers (8.11). Identities compare
        // exactly, so two differing only in case are distinct here as they are
        // there.
        expect(new Set(identities).size).toBe(identities.length);
      }),
      { numRuns: 300 },
    );
  });

  it('generates non-empty secret-bearing strings for a Generated_Invite', () => {
    fc.assert(
      fc.property(nonEmptyWireTextArb, (text) => {
        expect(text.length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 300 },
    );
  });

  it('generates only named enum values, drawn from the feature\'s own declarations', () => {
    fc.assert(
      fc.property(
        memberRoleArb,
        membershipStateArb,
        squadFeatureArb,
        inviteStateArb,
        redeemOutcomeArb,
        ratingStateArb,
        (role, state, feature, inviteState, outcome, ratingState) => {
          // Each must be a member of its generated vocabulary, since a value
          // outside it could never have been parsed in the first place (12.8).
          expect(SQUAD_ROLE_NAMES).toContain(role);
          expect(MEMBERSHIP_STATE_NAMES).toContain(state);
          expect(SQUAD_FEATURE_NAMES).toContain(feature);
          // The invite state and the redemption outcome are migrated too (12.8).
          expect(INVITE_STATE_NAMES).toContain(inviteState);
          expect(REDEEM_OUTCOME_NAMES).toContain(outcome);
          // And the rating state, which this contract adds (12.9).
          expect(RATING_STATE_NAMES).toContain(ratingState);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('generates enum values as member names — never a code, never a retired spelling', () => {
    // Every union this file generates from, read from `lib/wireEnums.ts`. The
    // vocabularies are not restated; only their *shape* is asserted, which is what
    // tells a Wire_Enum_Name from the two spellings this contract retired — a
    // numeric code (`0`, or `'0'`) and a lower-case or kebab name
    // (`'live-match-tracking'`). Either would be rejected by the readers, so a
    // generator that emitted one would turn Property 25 into a test of the
    // failure path (12.11).
    const vocabularies = [
      INVITE_STATE_NAMES,
      MEMBERSHIP_STATE_NAMES,
      RATING_STATE_NAMES,
      REDEEM_OUTCOME_NAMES,
      SQUAD_FEATURE_NAMES,
      SQUAD_ROLE_NAMES,
    ] as const;

    vocabularies.forEach((names) => {
      // A single-member union is legitimate (`SquadFeature` has one today), but an
      // empty one would satisfy every membership test below vacuously.
      expect(names.length).toBeGreaterThanOrEqual(1);

      names.forEach((name) => {
        expect(typeof name).toBe('string');
        // PascalCase, as the backend declares its members: an initial capital, and
        // nothing but letters and digits after it. This rejects `'active'`,
        // `'live-match-tracking'`, `'LIVE_MATCH_TRACKING'`, and `'0'` alike.
        expect(name).toMatch(/^[A-Z][A-Za-z0-9]*$/);
        expect(Number.isNaN(Number(name))).toBe(true);
      });
    });
  });

  it('generates members that reach zero appearances and all three rating cases', () => {
    // The counterpart of the producibility assertions: a generator can be within
    // bounds and still never reach the case the property is about. Sampled with a
    // fixed seed so this is a statement about the generator rather than a flake.
    const members = fc.sample(squadMemberArb, { numRuns: 600, seed: 20_251_118 });
    const counts = members.map((member) => member.appearances);
    const states = new Set(members.map((member) => member.ratingState));

    // Zero is in `EDGE_APPEARANCE_COUNTS` and `fc.nat` reaches it besides, so its
    // absence here would mean the generator had been changed out from under the
    // assertions above (12.9).
    expect(counts.some((count) => count === 0)).toBe(true);
    expect(counts.some((count) => count > 0)).toBe(true);
    expect(counts.every((count) => Number.isInteger(count) && count >= 0)).toBe(true);

    // Both members of the union and the absence, since the Player_List renders
    // all three differently and the round trip claims all three (12.9).
    RATING_STATE_NAMES.forEach((name) => {
      expect(states).toContain(name);
    });
    expect(states).toContain(null);
    expect(states.size).toBe(RATING_STATE_NAMES.length + 1);
  });

  it('generates decorated members that always carry a present rating state', () => {
    fc.assert(
      fc.property(decoratedSquadMemberArb, (member) => {
        // The premise of the decorated-squad property: if this generator ever
        // produced an absence, that property would silently become the weaker one
        // the driver already states.
        expect(member.ratingState).not.toBeNull();
        expect(RATING_STATE_NAMES).toContain(member.ratingState);
        expect(Number.isInteger(member.appearances)).toBe(true);
        expect(member.appearances).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 300 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The coverage floor: every pair in `lib/parse/` is actually stated          */
/* -------------------------------------------------------------------------- */

/**
 * Everything above is a conjunction of arms, and a conjunction with a missing arm
 * still passes. That is the one failure mode a round-trip file cannot detect from
 * the inside: delete the `describeRoundTrip` call for `Squad_Member` and the
 * suite stays green while the property it claims quietly shrinks.
 *
 * So the file closes by comparing what it covers against what the directory
 * exports. The comparison is by **function reference**, which is what makes it a
 * floor rather than a second checklist: a parser renamed, moved, or added shows
 * up here, and no list of names in this file has to be remembered.
 */
// Feature: api-response-contracts, Property 25: Parser and printer round-trip, including the new member fields
// Validates: Requirement 12.11
describe('round trip — the covered pairs are every pair the modules export', () => {
  /**
   * The modules under `lib/parse/` that publish a Response_Parser, spread into
   * ordinary records so their exports can be enumerated.
   *
   * `primitives.ts` is excluded by design — see the note beside the namespace
   * imports at the top of the file.
   */
  const parseModules: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
    createdGuest: { ...createdGuestModule },
    createdSquad: { ...createdSquadModule },
    featureFlags: { ...featureFlagsModule },
    generatedInvite: { ...generatedInviteModule },
    invitePreview: { ...invitePreviewModule },
    inviteSummary: { ...inviteSummaryModule },
    leaderboard: { ...leaderboardModule },
    redemption: { ...redemptionModule },
    squadDetail: { ...squadDetailModule },
    squadSummary: { ...squadSummaryModule },
  };

  /** The exported functions of those modules whose names begin with `prefix`. */
  function exportedFunctions(
    prefix: string,
  ): readonly { readonly qualifiedName: string; readonly fn: unknown }[] {
    return Object.entries(parseModules).flatMap(([moduleName, moduleExports]) =>
      Object.entries(moduleExports)
        .filter(
          ([exportName, value]) =>
            exportName.startsWith(prefix) && typeof value === 'function',
        )
        .map(([exportName, value]) => ({
          qualifiedName: `${moduleName}.${exportName}`,
          fn: value,
        })),
    );
  }

  it('states the round trip for every exported Response_Parser', () => {
    const exported = exportedFunctions('parse');
    const covered = new Set(COVERED_PAIRS.map((pair) => pair.parse as unknown));
    const uncovered = exported
      .filter((parser) => !covered.has(parser.fn))
      .map((parser) => parser.qualifiedName);

    // Named in the failure rather than counted, so a lost arm says which one.
    expect(uncovered).toStrictEqual([]);
  });

  it('states the round trip for every exported Response_Printer', () => {
    const exported = exportedFunctions('print');
    const covered = new Set(COVERED_PAIRS.map((pair) => pair.print as unknown));
    const uncovered = exported
      .filter((printer) => !covered.has(printer.fn))
      .map((printer) => printer.qualifiedName);

    // 12.11 asks for a printer *and* a round-trip property per retained parser, so
    // an exported printer nothing round-trips is as much a gap as a missing arm.
    expect(uncovered).toStrictEqual([]);
  });

  it('covers at least the fifteen pairs the feature has, each exactly once', () => {
    // Fifteen: the eleven response bodies plus the four element shapes their
    // collections are built from. A hard floor as well as the reference check
    // above, because a module deleted *along with* its arm would satisfy the
    // comparison while leaving the feature's contract half-stated.
    expect(COVERED_PAIRS.length).toBeGreaterThanOrEqual(15);
    expect(exportedFunctions('parse').length).toBeGreaterThanOrEqual(15);

    // And no arm registered twice: a duplicate would inflate the count above while
    // masking a pair that had gone missing.
    const parsers = COVERED_PAIRS.map((pair) => pair.parse as unknown);
    const labels = COVERED_PAIRS.map((pair) => pair.label);

    expect(new Set(parsers).size).toBe(parsers.length);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
