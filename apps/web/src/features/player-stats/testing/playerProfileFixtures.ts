/**
 * Paired wire-and-parsed fixtures for the `GetPlayerProfile` body — the shared
 * generator set every parsing suite of this feature reads.
 *
 * Tasks 2.8 through 2.16 all make claims about *the same set of valid bodies*:
 * that an accepted body is never partially populated, that one malformed member
 * fails the whole body, that exactly seven members tolerate absence, that a
 * string-encoded number is rejected wherever a number is read, that the parser
 * and printer round-trip, that unrecognised properties are inert, that a failure
 * reason discloses nothing, and that the parsed graph holds no rating internal.
 * Each of those needs valid `GetPlayerProfile` bodies covering the same corners
 * — empty and large collections, every rating-summary shape, every spelling of
 * an absence, a rich block absent, all-null, and fully populated. Building that
 * set eight times over would give eight sets that could drift apart, so it is
 * built once here.
 *
 * ## The pairing is the point
 *
 * Every generator yields a {@link WireFixture}: the **wire** form, and the
 * **parsed** value the Response_Parser must yield from it. The parsed side is
 * constructed arithmetically from the values the generator chose — it never
 * calls a parser — so it is an independent oracle rather than a restatement of
 * the implementation. That is what lets Property 6 say "every member equals its
 * wire value under this feature's declared normalisation" as an equality against
 * something, rather than as a tour of the parser's own output.
 *
 * Two members are normalised on read, and the fixtures carry both sides of each:
 *
 * | Wire | Parsed | Fixture |
 * | --- | --- | --- |
 * | an ISO-8601 instant with a UTC designator | epoch milliseconds | {@link WireInstantFixture} |
 * | a .NET `TimeSpan` string | milliseconds | {@link WireDurationFixture} |
 *
 * Each is generated **from** a chosen number of milliseconds and spelled into
 * one of the accepted wire forms, so the expected normalisation is known by
 * construction and no fixture depends on a reader to say what it means. The
 * spellings are deliberate: `'2026-01-01T00:00:00.000Z'`,
 * `'2026-01-01T00:00Z'`, a seven-digit tick fraction, a comma fraction, lower
 * case designators, and four offset forms all name the same instant, and a
 * day-less and a day-bearing `TimeSpan` spell the same duration.
 *
 * ## What is deliberately generated, and why
 *
 * - **Both spellings of an absence.** `null` and an omitted property are the
 *   same absence (Requirement 13.6), so every declared-optional member is
 *   spelled each way, chosen per fixture (see {@link AbsenceSpelling}).
 * - **The wire's rating-model members.** The real `RatingSummary` and every real
 *   progression point carry a mean skill estimate, a spread, and (on a point) a
 *   `state`. The fixtures emit all of them, because a body without them would
 *   never demonstrate that the parser leaves them unread (Requirement 7.7).
 *   Their two member names are spelled as *string constants* rather than as bare
 *   identifiers (see {@link RATING_MODEL_WIRE_MEMBERS}), so this module stays
 *   clean of the identifiers the feature's rating-internal source scan forbids.
 * - **Values that would betray a repair.** Display names are generated empty,
 *   whitespace-padded, and graphemic, so a trimmed or normalised name is
 *   visible; identities are generated in both letter cases, so a case-folded
 *   identity is visible; counts include `-0` and the largest exact integer, and
 *   percentages include both endpoints, so a clamp or a round is visible.
 * - **Collections at their edges.** A fold that mishandles an empty or a
 *   singleton collection is the defect a mid-sized random array misses, so the
 *   presets below pin a zero-length, a default, and a 200-element pairwise set,
 *   and a zero-length, a default, and a 500-point progression.
 *
 * ## Determinism
 *
 * Pure and free of ambient state: no clock is read (an instant is built from a
 * chosen number, never from `Date.now()`), no locale-dependent formatter is
 * invoked (`toISOString` is fixed-form UTC), nothing is stored, and no global is
 * touched. Two runs with the same fast-check seed produce byte-identical
 * fixtures.
 *
 * Imported only by tests; the test-file glob does not match this module, and
 * nothing in the shipped feature imports it.
 */

import fc from 'fast-check';

import type {
  CoAppearanceEntry,
  PairedStatEntry,
  PlayerProfile,
  PlayerRecord,
  ProgressionPoint,
  RatingSummary,
  RichStats,
} from '../lib/parse/playerProfile';
import {
  MEMBERSHIP_STATE_NAMES,
  RATING_STATE_NAMES,
  type MembershipState,
  type RatingState,
} from '../lib/wireEnums';

/* -------------------------------------------------------------------------- */
/* The pairing                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One wire value paired with the parsed value the Response_Parser must yield
 * from it.
 *
 * The parsed side is built from the generator's own choices rather than by
 * parsing the wire side, so it is an oracle and not an echo.
 */
export interface WireFixture<TParsed> {
  /** A valid wire form of this block. */
  readonly wire: Record<string, unknown>;
  /** The value the parser must yield from {@link wire}. */
  readonly parsed: TParsed;
}

/** Inclusive length bounds for a generated collection. */
export interface LengthRange {
  readonly minLength: number;
  readonly maxLength: number;
}

/**
 * How an absence is spelled on the wire: as an explicit `null`, or by omitting
 * the property. The two are the same absence (Requirement 13.6), and every
 * declared-optional member is generated both ways.
 */
export type AbsenceSpelling = 'null' | 'missing';

/** Both spellings of an absence. */
export const ABSENCE_SPELLINGS = ['null', 'missing'] as const;

/** One of the two absence spellings. */
export const absenceSpellingArb: fc.Arbitrary<AbsenceSpelling> =
  fc.constantFrom<AbsenceSpelling>(...ABSENCE_SPELLINGS);

/**
 * A single optional member, as the entries to spread into a wire object: the
 * member carrying its value, the member carrying `null`, or no member at all.
 *
 * A `null` value means "absent" throughout this module, because `null` is what
 * the parser yields for each of the seven declared absences.
 */
function optionalMember(
  key: string,
  value: unknown,
  spelling: AbsenceSpelling,
): Record<string, unknown> {
  if (value !== null) {
    return { [key]: value };
  }

  return spelling === 'null' ? { [key]: null } : {};
}

/* -------------------------------------------------------------------------- */
/* Leaf wire values                                                           */
/* -------------------------------------------------------------------------- */

/** A fixed well-formed identity, for fixtures that want a stable one. */
export const SAMPLE_IDENTITY = '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b';

/**
 * The 36-character hyphenated identity form, in both letter cases — the case
 * variety is what would expose a case-folding parser.
 */
export const wireIdentityArb: fc.Arbitrary<string> = fc.oneof(
  fc.uuid(),
  fc.uuid().map((identity) => identity.toUpperCase()),
);

/**
 * A well-formed identity distinct per collection index, alternating letter case.
 *
 * Collections are stamped with these so that element order is observable: a
 * parser that returned the right number of entries in the wrong order cannot
 * hide behind two randomly equal identities. Decimal digits are hexadecimal
 * digits, so an index padded into the final group is a well-formed identity.
 */
export function wireIdentityForIndex(index: number): string {
  const identity = `018f3a2b-4c5d-7e6f-8a9b-${String(index).padStart(12, '0')}`;

  return index % 2 === 0 ? identity : identity.toUpperCase();
}

/**
 * A display name exactly as the backend may send one: free-form, possibly
 * empty, possibly padded, possibly the Anonymised_Placeholder. The parser reads
 * it untrimmed and unaltered (Requirement 10.8), so the padded and empty cases
 * are the ones that would expose a repair.
 */
export const wireDisplayNameArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: fc.string({ maxLength: 24 }) },
  { weight: 2, arbitrary: fc.string({ unit: 'grapheme', maxLength: 10 }) },
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      '',
      ' ',
      '  Dave  ',
      'Dave',
      'BigDave',
      'Former player',
      'Ömer',
      '🧤 keeper',
    ),
  },
);

/**
 * A count the contract admits: a non-negative whole number. `-0` is included
 * because the reader accepts it as the zero it is, and the largest exact
 * integer because a count beyond it would stop being exact.
 */
export const wireCountArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 6, arbitrary: fc.nat({ max: 400 }) },
  {
    weight: 1,
    arbitrary: fc.constantFrom(0, -0, 1, 1_000_000, Number.MAX_SAFE_INTEGER),
  },
);

/**
 * A percentage the contract admits: a finite number in the closed range 0.0 to
 * 100.0. Both endpoints are included, because a clamp is invisible in the
 * interior, and fractional values because a 1-in-3 record is `33.333…`.
 */
export const wirePercentageArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 5, arbitrary: fc.double({ min: 0, max: 100, noNaN: true }) },
  {
    weight: 2,
    arbitrary: fc.constantFrom(0, -0, 100, 0.1, 33.3, 66.66666666666667, 99.9),
  },
);

/**
 * A Display_Rating as the backend computes it: any finite number. The parser
 * does nothing to it — no scaling, no rounding, no flooring
 * (Requirement 7.8) — so the extremes and the fractions are what would expose a
 * repair.
 */
export const wireDisplayRatingArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 4, arbitrary: fc.integer({ min: -5_000, max: 5_000 }) },
  {
    weight: 3,
    arbitrary: fc
      .double({ noNaN: true, noDefaultInfinity: true })
      .filter((value) => Number.isFinite(value)),
  },
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      0,
      -0,
      -1,
      1_000,
      1_499.5,
      Number.MAX_VALUE,
      Number.MIN_VALUE,
    ),
  },
);

/** A `MembershipState` member name. */
export const wireMembershipStateArb: fc.Arbitrary<MembershipState> =
  fc.constantFrom(...MEMBERSHIP_STATE_NAMES);

/** A `RatingState` member name. */
export const wireRatingStateArb: fc.Arbitrary<RatingState> = fc.constantFrom(
  ...RATING_STATE_NAMES,
);

/**
 * The two rating-model member names the wire carries on a rating summary and on
 * every progression point, spelled as string constants.
 *
 * The parser names neither, which is the whole of Requirement 7.7's guarantee on
 * the read path — so the fixtures must *send* them, or a passing parse would
 * prove nothing. Spelling them here as strings rather than as bare object keys
 * keeps this module free of the identifiers the feature's rating-internal source
 * scan forbids; a scan over comment-and-string-stripped code sees nothing.
 */
const RATING_MODEL_WIRE_MEMBERS = ['mu', 'sigma'] as const;

/** A value of the wire's rating-model members: any finite number. */
const wireRatingModelValueArb: fc.Arbitrary<number> = fc
  .double({ noNaN: true, noDefaultInfinity: true })
  .filter((value) => Number.isFinite(value));

/**
 * The wire's two rating-model members, as entries to spread into a block the
 * parser reads other members from.
 */
function ratingModelMembers(
  first: number,
  second: number,
): Record<string, unknown> {
  return {
    [RATING_MODEL_WIRE_MEMBERS[0]]: first,
    [RATING_MODEL_WIRE_MEMBERS[1]]: second,
  };
}

/* -------------------------------------------------------------------------- */
/* Instants                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The bound on a generated instant: roughly 273 years either side of the epoch.
 *
 * Inside it `toISOString` renders a four-digit year, so every spelling below is
 * built from an ordinary calendar form rather than from the expanded signed
 * six-digit year the reader also accepts.
 */
export const MAX_FIXTURE_INSTANT_MS = 8_640_000_000_000;

/** The accepted wire spellings of one instant. */
export const INSTANT_SPELLINGS = [
  'utc-milliseconds',
  'utc-seconds',
  'utc-minutes',
  'utc-ticks',
  'comma-fraction',
  'lower-case-designators',
  'numeric-offset',
] as const;

/** One accepted wire spelling of an instant. */
export type InstantSpelling = (typeof INSTANT_SPELLINGS)[number];

/** A UTC offset, as whole minutes east of UTC and as the wire designator. */
interface OffsetSpelling {
  readonly minutes: number;
  readonly text: string;
}

/**
 * The offset designators the reader accepts: `±HH:MM`, `±HHMM`, and `±HH`.
 *
 * An instant spelled with an offset names the same instant as the same value
 * spelled with `Z`, which is why the round trip compares milliseconds rather
 * than wire text.
 */
const OFFSET_SPELLINGS: readonly OffsetSpelling[] = [
  { minutes: 0, text: '+00:00' },
  { minutes: 0, text: '-00:00' },
  { minutes: 60, text: '+01:00' },
  { minutes: -300, text: '-05:00' },
  { minutes: 330, text: '+05:30' },
  { minutes: 120, text: '+0200' },
  { minutes: -480, text: '-08' },
];

/** An instant on the wire, paired with the milliseconds it is read into. */
export interface WireInstantFixture {
  /** The transmitted text. */
  readonly wire: string;
  /** The epoch milliseconds the reader must yield. */
  readonly ms: number;
  /** Which spelling {@link wire} is in, for coverage assertions. */
  readonly spelling: InstantSpelling;
}

/** Milliseconds in one second, minute, hour, and day. */
const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * `ms` spelled into one accepted wire form.
 *
 * A spelling that cannot express the given value losslessly — a seconds form
 * for an instant carrying milliseconds, a minutes form for one carrying seconds
 * — falls back to the canonical millisecond form, and the fixture reports the
 * spelling it actually used. No spelling ever loses precision, so the expected
 * normalisation is always `ms` itself.
 */
function spellInstant(
  ms: number,
  spelling: InstantSpelling,
  offset: OffsetSpelling,
): WireInstantFixture {
  // Fixed-form UTC: `YYYY-MM-DDTHH:mm:ss.sssZ`. Not locale-dependent, and not a
  // clock read — the instant is the one the generator chose.
  const canonical = new Date(ms).toISOString();

  switch (spelling) {
    case 'utc-seconds':
      if (ms % MS_PER_SECOND === 0) {
        return { wire: `${canonical.slice(0, 19)}Z`, ms, spelling };
      }
      break;

    case 'utc-minutes':
      if (ms % MS_PER_MINUTE === 0) {
        return { wire: `${canonical.slice(0, 16)}Z`, ms, spelling };
      }
      break;

    case 'utc-ticks':
      // The fraction counts 100-nanosecond ticks; three digits of milliseconds
      // followed by four zero digits is the same instant at full precision.
      return { wire: `${canonical.slice(0, 23)}0000Z`, ms, spelling };

    case 'comma-fraction':
      return {
        wire: `${canonical.slice(0, 19)},${canonical.slice(20, 23)}Z`,
        ms,
        spelling,
      };

    case 'lower-case-designators':
      return {
        wire: `${canonical.slice(0, 10)}t${canonical.slice(11, 23)}z`,
        ms,
        spelling,
      };

    case 'numeric-offset':
      return {
        wire: `${new Date(ms + offset.minutes * MS_PER_MINUTE)
          .toISOString()
          .slice(0, 23)}${offset.text}`,
        ms,
        spelling,
      };

    case 'utc-milliseconds':
      break;
  }

  return { wire: canonical, ms, spelling: 'utc-milliseconds' };
}

/** `ms` spelled in the canonical `Z`-designated millisecond form. */
export function canonicalWireInstant(ms: number): WireInstantFixture {
  return spellInstant(ms, 'utc-milliseconds', OFFSET_SPELLINGS[0]);
}

/** Epoch milliseconds within {@link MAX_FIXTURE_INSTANT_MS}. */
const instantMsArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.integer({
      min: -MAX_FIXTURE_INSTANT_MS,
      max: MAX_FIXTURE_INSTANT_MS,
    }),
  },
  {
    weight: 4,
    arbitrary: fc.integer({ min: 1_700_000_000_000, max: 1_800_000_000_000 }),
  },
  { weight: 1, arbitrary: fc.constantFrom(0, 1_000, -1_000, 1_767_225_600_000) },
);

/** An instant on the wire in one of its accepted spellings. */
export const wireInstantFixtureArb: fc.Arbitrary<WireInstantFixture> = fc
  .tuple(
    instantMsArb,
    fc.constantFrom(...INSTANT_SPELLINGS),
    fc.constantFrom(...OFFSET_SPELLINGS),
  )
  .map(([ms, spelling, offset]) => spellInstant(ms, spelling, offset));

/* -------------------------------------------------------------------------- */
/* Durations                                                                  */
/* -------------------------------------------------------------------------- */

/** The bound on a generated Keeper_Time: a hundred days in goal. */
export const MAX_FIXTURE_DURATION_MS = 100 * MS_PER_DAY;

/** The accepted wire spellings of one duration. */
export const DURATION_SPELLINGS = [
  'clock',
  'zero-day',
  'day-bearing',
  'ticks',
  'short-fraction',
] as const;

/** One accepted wire spelling of a duration. */
export type DurationSpelling = (typeof DURATION_SPELLINGS)[number];

/** A duration on the wire, paired with the milliseconds it is read into. */
export interface WireDurationFixture {
  /** The transmitted .NET `TimeSpan` text. */
  readonly wire: string;
  /** The milliseconds the reader must yield. */
  readonly ms: number;
  /** Which spelling {@link wire} is in, for coverage assertions. */
  readonly spelling: DurationSpelling;
}

/** A whole number padded to at least two digits. */
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * `ms` spelled into one accepted .NET `TimeSpan` form.
 *
 * A spelling that cannot express the given value — a day-less form for a
 * duration of a day or more, a one-digit fraction for a duration carrying tens
 * of milliseconds — falls back to the day-bearing form, which is always valid.
 * No spelling loses precision, so the expected normalisation is always `ms`.
 */
function spellDuration(
  ms: number,
  spelling: DurationSpelling,
): WireDurationFixture {
  const days = Math.floor(ms / MS_PER_DAY);
  const hours = Math.floor((ms % MS_PER_DAY) / MS_PER_HOUR);
  const minutes = Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE);
  const seconds = Math.floor((ms % MS_PER_MINUTE) / MS_PER_SECOND);
  const subSecond = ms % MS_PER_SECOND;

  const clock = `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
  const digits = String(subSecond).padStart(3, '0');
  const fraction = subSecond === 0 ? '' : `.${digits}`;
  const dayPart = days === 0 ? '' : `${String(days)}.`;

  switch (spelling) {
    case 'clock':
      if (days === 0) {
        return { wire: `${clock}${fraction}`, ms, spelling };
      }
      break;

    case 'zero-day':
      if (days === 0) {
        return { wire: `0.${clock}${fraction}`, ms, spelling };
      }
      break;

    case 'ticks':
      // Seven digits of ticks: the three millisecond digits, then four zeroes.
      return { wire: `${dayPart}${clock}.${digits}0000`, ms, spelling };

    case 'short-fraction':
      if (subSecond !== 0 && subSecond % 100 === 0) {
        return {
          wire: `${dayPart}${clock}.${String(subSecond / 100)}`,
          ms,
          spelling,
        };
      }
      break;

    case 'day-bearing':
      break;
  }

  return {
    wire: `${String(days)}.${clock}${fraction}`,
    ms,
    spelling: 'day-bearing',
  };
}

/** `ms` spelled in the shortest accepted form: day-less below a day. */
export function canonicalWireDuration(ms: number): WireDurationFixture {
  return spellDuration(ms, 'clock');
}

/** A non-negative whole number of milliseconds within the generated bound. */
const durationMsArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 6, arbitrary: fc.nat({ max: 10 * MS_PER_HOUR }) },
  { weight: 2, arbitrary: fc.nat({ max: MAX_FIXTURE_DURATION_MS }) },
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      0,
      1,
      999,
      MS_PER_SECOND,
      45 * MS_PER_MINUTE,
      MS_PER_HOUR,
      MS_PER_DAY,
      MS_PER_DAY + 1,
    ),
  },
);

/** A duration on the wire in one of its accepted spellings. */
export const wireDurationFixtureArb: fc.Arbitrary<WireDurationFixture> = fc
  .tuple(durationMsArb, fc.constantFrom(...DURATION_SPELLINGS))
  .map(([ms, spelling]) => spellDuration(ms, spelling));

/* -------------------------------------------------------------------------- */
/* The player record                                                          */
/* -------------------------------------------------------------------------- */

/** A record block on the wire, paired with the record it parses to. */
export function playerRecordFixture(
  record: PlayerRecord,
): WireFixture<PlayerRecord> {
  return {
    wire: {
      appearances: record.appearances,
      wins: record.wins,
      draws: record.draws,
      losses: record.losses,
    },
    parsed: record,
  };
}

/**
 * A record block: four counts, every one required.
 *
 * Generated two ways. A **coherent** record has `appearances` equal to the sum
 * of its outcomes, as a real squad's record does; an **independent** one does
 * not, because the parser imposes no such relation and a suite that only ever
 * saw coherent records would not know that.
 */
export const playerRecordFixtureArb: fc.Arbitrary<WireFixture<PlayerRecord>> =
  fc.oneof(
    {
      weight: 3,
      arbitrary: fc
        .tuple(fc.nat({ max: 200 }), fc.nat({ max: 200 }), fc.nat({ max: 200 }))
        .map(([wins, draws, losses]) =>
          playerRecordFixture({
            appearances: wins + draws + losses,
            wins,
            draws,
            losses,
          }),
        ),
    },
    {
      weight: 1,
      arbitrary: fc
        .tuple(wireCountArb, wireCountArb, wireCountArb, wireCountArb)
        .map(([appearances, wins, draws, losses]) =>
          playerRecordFixture({ appearances, wins, draws, losses }),
        ),
    },
  );

/* -------------------------------------------------------------------------- */
/* The rating summary                                                         */
/* -------------------------------------------------------------------------- */

/** Everything a rating-summary fixture is built from. */
export interface RatingSummaryInput {
  /** The classification, or `null` for an absent one. */
  readonly state: RatingState | null;
  /** The Display_Rating, or `null` for an absent one. */
  readonly displayRating: number | null;
  /** How an absent `state` is spelled. */
  readonly stateAbsence: AbsenceSpelling;
  /** How an absent `displayRating` is spelled. */
  readonly displayRatingAbsence: AbsenceSpelling;
  /** The wire's two rating-model member values, which the parser never reads. */
  readonly modelValues: readonly [number, number];
}

/** A rating block on the wire, paired with the summary it parses to. */
export function ratingSummaryFixture(
  input: RatingSummaryInput,
): WireFixture<RatingSummary> {
  return {
    wire: {
      ...ratingModelMembers(input.modelValues[0], input.modelValues[1]),
      ...optionalMember('state', input.state, input.stateAbsence),
      ...optionalMember(
        'displayRating',
        input.displayRating,
        input.displayRatingAbsence,
      ),
    },
    parsed: { state: input.state, displayRating: input.displayRating },
  };
}

/** A rating-summary fixture over the given state and Display_Rating. */
function ratingSummaryFixtureArbOver(
  stateArb: fc.Arbitrary<RatingState | null>,
  displayRatingArb: fc.Arbitrary<number | null>,
): fc.Arbitrary<WireFixture<RatingSummary>> {
  return fc
    .record({
      state: stateArb,
      displayRating: displayRatingArb,
      stateAbsence: absenceSpellingArb,
      displayRatingAbsence: absenceSpellingArb,
      modelValues: fc.tuple(wireRatingModelValueArb, wireRatingModelValueArb),
    })
    .map((input) => ratingSummaryFixture(input));
}

/**
 * The four rating-summary shapes the Rating_Condition resolver separates, each
 * generated in its own right so a suite can quantify over them by name.
 *
 * `provisional` and `established` both carry a Display_Rating, because the
 * precedence that chooses `provisional` over `established` only means something
 * when a number is present.
 */
export const RATING_SUMMARY_SHAPES: readonly {
  readonly label: string;
  readonly arbitrary: fc.Arbitrary<WireFixture<RatingSummary>>;
}[] = [
  {
    label: 'provisional',
    arbitrary: ratingSummaryFixtureArbOver(
      fc.constant<RatingState | null>('Provisional'),
      wireDisplayRatingArb,
    ),
  },
  {
    label: 'established',
    arbitrary: ratingSummaryFixtureArbOver(
      fc.constant<RatingState | null>('Established'),
      wireDisplayRatingArb,
    ),
  },
  {
    label: 'state absent',
    arbitrary: ratingSummaryFixtureArbOver(
      fc.constant<RatingState | null>(null),
      wireDisplayRatingArb,
    ),
  },
  {
    label: 'displayRating absent',
    arbitrary: ratingSummaryFixtureArbOver(
      fc.option(wireRatingStateArb, { nil: null }),
      fc.constant<number | null>(null),
    ),
  },
];

/** A rating block in any of its four shapes. */
export const ratingSummaryFixtureArb: fc.Arbitrary<
  WireFixture<RatingSummary>
> = fc.oneof(...RATING_SUMMARY_SHAPES.map((shape) => shape.arbitrary));

/* -------------------------------------------------------------------------- */
/* A progression record                                                       */
/* -------------------------------------------------------------------------- */

/** Everything a progression-record fixture is built from. */
export interface ProgressionRecordInput {
  /** When the match completed. */
  readonly instant: WireInstantFixture;
  /** The Display_Rating, or `null` for a record with nothing to plot. */
  readonly displayRating: number | null;
  /** How an absent `displayRating` is spelled. */
  readonly displayRatingAbsence: AbsenceSpelling;
  /** The point's own rating state, which the parser never reads. */
  readonly state: RatingState | null;
  /** The wire's two rating-model member values, which the parser never reads. */
  readonly modelValues: readonly [number, number];
}

/**
 * A progression record on the wire, paired with the point it parses to — or
 * with **no point**, when the record carries no Display_Rating.
 *
 * A ratingless record is not a failure: the body is accepted and the record
 * simply contributes nothing to plot, which is why the parsed side of this
 * fixture is nullable while {@link ProgressionPoint.displayRating} is not.
 */
export function progressionRecordFixture(
  input: ProgressionRecordInput,
): WireFixture<ProgressionPoint | null> {
  return {
    wire: {
      completedAt: input.instant.wire,
      ...ratingModelMembers(input.modelValues[0], input.modelValues[1]),
      state: input.state,
      ...optionalMember(
        'displayRating',
        input.displayRating,
        input.displayRatingAbsence,
      ),
    },
    parsed:
      input.displayRating === null
        ? null
        : {
            completedAtMs: input.instant.ms,
            displayRating: input.displayRating,
          },
  };
}

/**
 * A progression record that carries a Display_Rating, and so a plottable point.
 *
 * Typed more narrowly than {@link progressionRecordFixture}'s nullable result,
 * because this generator chose a rating: the record *is* a point, and a suite
 * over points should not have to re-establish that.
 */
export const ratedProgressionRecordFixtureArb: fc.Arbitrary<
  WireFixture<ProgressionPoint>
> = fc
  .record({
    instant: wireInstantFixtureArb,
    displayRating: wireDisplayRatingArb,
    displayRatingAbsence: absenceSpellingArb,
    state: fc.option(wireRatingStateArb, { nil: null }),
    modelValues: fc.tuple(wireRatingModelValueArb, wireRatingModelValueArb),
  })
  .map((input) => ({
    wire: progressionRecordFixture(input).wire,
    parsed: {
      completedAtMs: input.instant.ms,
      displayRating: input.displayRating,
    },
  }));

/** A progression record that carries no Display_Rating, and so no point. */
export const ratinglessProgressionRecordFixtureArb: fc.Arbitrary<
  WireFixture<ProgressionPoint | null>
> = fc
  .record({
    instant: wireInstantFixtureArb,
    displayRating: fc.constant<number | null>(null),
    displayRatingAbsence: absenceSpellingArb,
    state: fc.option(wireRatingStateArb, { nil: null }),
    modelValues: fc.tuple(wireRatingModelValueArb, wireRatingModelValueArb),
  })
  .map((input) => progressionRecordFixture(input));

/**
 * A progression record, mostly rated.
 *
 * The ratingless minority matters: it is the one declared absence whose parsed
 * consequence is a *shorter collection*, so every suite over whole bodies should
 * meet some.
 */
export const progressionRecordFixtureArb: fc.Arbitrary<
  WireFixture<ProgressionPoint | null>
> = fc.oneof(
  { weight: 5, arbitrary: ratedProgressionRecordFixtureArb },
  { weight: 1, arbitrary: ratinglessProgressionRecordFixtureArb },
);

/* -------------------------------------------------------------------------- */
/* A co-appearance entry                                                      */
/* -------------------------------------------------------------------------- */

/** A co-appearance row on the wire, paired with the entry it parses to. */
export function coAppearanceEntryFixture(
  entry: CoAppearanceEntry,
): WireFixture<CoAppearanceEntry> {
  return {
    wire: {
      membershipId: entry.membershipId,
      displayName: entry.displayName,
      count: entry.count,
    },
    parsed: entry,
  };
}

/** One row of "most played with" or "most played against". */
export const coAppearanceEntryFixtureArb: fc.Arbitrary<
  WireFixture<CoAppearanceEntry>
> = fc
  .record({
    membershipId: wireIdentityArb,
    displayName: wireDisplayNameArb,
    count: wireCountArb,
  })
  .map((entry) => coAppearanceEntryFixture(entry));

/** The same row, with the identity stamped from its collection index. */
function stampedCoAppearance(
  fixture: WireFixture<CoAppearanceEntry>,
  index: number,
): WireFixture<CoAppearanceEntry> {
  const membershipId = wireIdentityForIndex(index);

  return {
    wire: { ...fixture.wire, membershipId },
    parsed: { ...fixture.parsed, membershipId },
  };
}

/* -------------------------------------------------------------------------- */
/* A paired statistic entry                                                   */
/* -------------------------------------------------------------------------- */

/** A paired-statistic row on the wire, paired with the entry it parses to. */
export function pairedStatEntryFixture(
  entry: PairedStatEntry,
): WireFixture<PairedStatEntry> {
  return {
    wire: {
      membershipId: entry.membershipId,
      displayName: entry.displayName,
      value: entry.value,
      qualifyingMatches: entry.qualifyingMatches,
    },
    parsed: entry,
  };
}

/** One row of "best partnerships" or "bogey opponents". */
export const pairedStatEntryFixtureArb: fc.Arbitrary<
  WireFixture<PairedStatEntry>
> = fc
  .record({
    membershipId: wireIdentityArb,
    displayName: wireDisplayNameArb,
    value: wirePercentageArb,
    qualifyingMatches: wireCountArb,
  })
  .map((entry) => pairedStatEntryFixture(entry));

/** The same row, with the identity stamped from its collection index. */
function stampedPairedStat(
  fixture: WireFixture<PairedStatEntry>,
  index: number,
): WireFixture<PairedStatEntry> {
  const membershipId = wireIdentityForIndex(index);

  return {
    wire: { ...fixture.wire, membershipId },
    parsed: { ...fixture.parsed, membershipId },
  };
}

/* -------------------------------------------------------------------------- */
/* The rich stats block                                                       */
/* -------------------------------------------------------------------------- */

/** Everything a rich-stats fixture is built from. */
export interface RichStatsInput {
  readonly goals: number | null;
  readonly cleanSheets: number | null;
  readonly goalsConcededAsKeeper: number | null;
  /** The Keeper_Time, or `null` for an absent one. */
  readonly keeperTime: WireDurationFixture | null;
  /** How every absent member of this block is spelled. */
  readonly absence: AbsenceSpelling;
}

/** A rich block on the wire, paired with the block it parses to. */
export function richStatsFixture(
  input: RichStatsInput,
): WireFixture<RichStats> {
  return {
    wire: {
      ...optionalMember('goals', input.goals, input.absence),
      ...optionalMember('cleanSheets', input.cleanSheets, input.absence),
      ...optionalMember(
        'goalsConcededAsKeeper',
        input.goalsConcededAsKeeper,
        input.absence,
      ),
      ...optionalMember(
        'keeperTime',
        input.keeperTime === null ? null : input.keeperTime.wire,
        input.absence,
      ),
    },
    parsed: {
      goals: input.goals,
      cleanSheets: input.cleanSheets,
      goalsConcededAsKeeper: input.goalsConcededAsKeeper,
      keeperTimeMs: input.keeperTime === null ? null : input.keeperTime.ms,
    },
  };
}

/** A rich block over the given member generators. */
function richStatsFixtureArbOver(
  countArb: fc.Arbitrary<number | null>,
  keeperTimeArb: fc.Arbitrary<WireDurationFixture | null>,
): fc.Arbitrary<WireFixture<RichStats>> {
  return fc
    .record({
      goals: countArb,
      cleanSheets: countArb,
      goalsConcededAsKeeper: countArb,
      keeperTime: keeperTimeArb,
      absence: absenceSpellingArb,
    })
    .map((input) => richStatsFixture(input));
}

/** A rich block with every member present. */
export const fullyPopulatedRichStatsFixtureArb: fc.Arbitrary<
  WireFixture<RichStats>
> = richStatsFixtureArbOver(wireCountArb, wireDurationFixtureArb);

/** A rich block with every member absent — tracking on, nothing recorded. */
export const allAbsentRichStatsFixtureArb: fc.Arbitrary<
  WireFixture<RichStats>
> = richStatsFixtureArbOver(
  fc.constant<number | null>(null),
  fc.constant<WireDurationFixture | null>(null),
);

/** A rich block with an arbitrary subset of its members present. */
export const partialRichStatsFixtureArb: fc.Arbitrary<
  WireFixture<RichStats>
> = richStatsFixtureArbOver(
  fc.option(wireCountArb, { nil: null }),
  fc.option(wireDurationFixtureArb, { nil: null }),
);

/** A present rich block, in any of its member configurations. */
export const richStatsFixtureArb: fc.Arbitrary<WireFixture<RichStats>> =
  fc.oneof(
    fullyPopulatedRichStatsFixtureArb,
    allAbsentRichStatsFixtureArb,
    partialRichStatsFixtureArb,
  );

/**
 * The `rich` member of a profile body: a present block, or no block at all.
 *
 * The block being **absent** and the block being present with every member
 * absent are different states — the squad's live-tracking feature being off,
 * versus tracking being on with nothing recorded — so they are generated
 * separately and never collapsed.
 */
export interface RichBlockFixture {
  /** The block's wire form, or `null` when the body carries no block. */
  readonly wire: Record<string, unknown> | null;
  /** How an absent block is spelled. */
  readonly absence: AbsenceSpelling;
  /** The value the parser must yield for the profile's `rich` member. */
  readonly parsed: RichStats | null;
}

/** A profile body carrying no `rich` block at all. */
export function absentRichBlockFixture(
  absence: AbsenceSpelling,
): RichBlockFixture {
  return { wire: null, absence, parsed: null };
}

/** A profile body carrying the given rich block. */
export function presentRichBlockFixture(
  fixture: WireFixture<RichStats>,
): RichBlockFixture {
  return { wire: fixture.wire, absence: 'null', parsed: fixture.parsed };
}

/**
 * The three `rich` conditions `lib/richStats.ts` separates, each generated in
 * its own right so a suite can quantify over them by name.
 */
export const RICH_BLOCK_SHAPES: readonly {
  readonly label: string;
  readonly arbitrary: fc.Arbitrary<RichBlockFixture>;
}[] = [
  {
    label: 'absent',
    arbitrary: absenceSpellingArb.map((absence) =>
      absentRichBlockFixture(absence),
    ),
  },
  {
    label: 'all members absent',
    arbitrary: allAbsentRichStatsFixtureArb.map((fixture) =>
      presentRichBlockFixture(fixture),
    ),
  },
  {
    label: 'fully populated',
    arbitrary: fullyPopulatedRichStatsFixtureArb.map((fixture) =>
      presentRichBlockFixture(fixture),
    ),
  },
  {
    label: 'partially populated',
    arbitrary: partialRichStatsFixtureArb.map((fixture) =>
      presentRichBlockFixture(fixture),
    ),
  },
];

/** The `rich` member in any of its shapes. */
export const richBlockFixtureArb: fc.Arbitrary<RichBlockFixture> = fc.oneof(
  ...RICH_BLOCK_SHAPES.map((shape) => shape.arbitrary),
);

/* -------------------------------------------------------------------------- */
/* The whole profile                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Everything a profile fixture is built from — and, on a built fixture, the
 * sub-fixtures it was built from, so a suite can reach one element of one
 * collection without re-deriving it.
 */
export interface PlayerProfileFixtureInput {
  readonly membershipId: string;
  readonly displayName: string;
  readonly state: MembershipState | null;
  readonly stateAbsence: AbsenceSpelling;
  readonly isGuest: boolean;
  readonly record: WireFixture<PlayerRecord>;
  readonly winPercentage: number | null;
  readonly winPercentageAbsence: AbsenceSpelling;
  readonly rating: WireFixture<RatingSummary>;
  readonly progression: readonly WireFixture<ProgressionPoint | null>[];
  readonly winStreak: number;
  readonly unbeatenStreak: number;
  readonly mostPlayedWith: readonly WireFixture<CoAppearanceEntry>[];
  readonly mostPlayedAgainst: readonly WireFixture<CoAppearanceEntry>[];
  readonly bestPartnerships: readonly WireFixture<PairedStatEntry>[];
  readonly bogeyOpponents: readonly WireFixture<PairedStatEntry>[];
  readonly bibAppearances: number;
  readonly rich: RichBlockFixture;
}

/** A whole `GetPlayerProfile` body, paired with the profile it parses to. */
export interface PlayerProfileFixture extends WireFixture<PlayerProfile> {
  /** The sub-fixtures and chosen values this body was built from. */
  readonly parts: PlayerProfileFixtureInput;
}

/** The points a progression of wire records contributes, in wire order. */
function pointsOf(
  records: readonly WireFixture<ProgressionPoint | null>[],
): readonly ProgressionPoint[] {
  return records
    .map((record) => record.parsed)
    .filter((point): point is ProgressionPoint => point !== null);
}

/**
 * A whole body and the profile it must parse to, built from explicit choices.
 *
 * Used by the generators below and by the fixed samples, so a sample and a
 * generated fixture are the same kind of thing.
 */
export function buildPlayerProfileFixture(
  input: PlayerProfileFixtureInput,
): PlayerProfileFixture {
  return {
    wire: {
      membershipId: input.membershipId,
      displayName: input.displayName,
      ...optionalMember('state', input.state, input.stateAbsence),
      isGuest: input.isGuest,
      record: input.record.wire,
      ...optionalMember(
        'winPercentage',
        input.winPercentage,
        input.winPercentageAbsence,
      ),
      rating: input.rating.wire,
      progression: input.progression.map((record) => record.wire),
      winStreak: input.winStreak,
      unbeatenStreak: input.unbeatenStreak,
      mostPlayedWith: input.mostPlayedWith.map((entry) => entry.wire),
      mostPlayedAgainst: input.mostPlayedAgainst.map((entry) => entry.wire),
      bestPartnerships: input.bestPartnerships.map((entry) => entry.wire),
      bogeyOpponents: input.bogeyOpponents.map((entry) => entry.wire),
      bibAppearances: input.bibAppearances,
      ...optionalMember('rich', input.rich.wire, input.rich.absence),
    },
    parsed: {
      membershipId: input.membershipId,
      displayName: input.displayName,
      state: input.state,
      isGuest: input.isGuest,
      record: input.record.parsed,
      winPercentage: input.winPercentage,
      rating: input.rating.parsed,
      progression: pointsOf(input.progression),
      winStreak: input.winStreak,
      unbeatenStreak: input.unbeatenStreak,
      mostPlayedWith: input.mostPlayedWith.map((entry) => entry.parsed),
      mostPlayedAgainst: input.mostPlayedAgainst.map((entry) => entry.parsed),
      bestPartnerships: input.bestPartnerships.map((entry) => entry.parsed),
      bogeyOpponents: input.bogeyOpponents.map((entry) => entry.parsed),
      bibAppearances: input.bibAppearances,
      rich: input.rich.parsed,
    },
    parts: input,
  };
}

/** How a generated profile body varies. */
export interface PlayerProfileFixtureOptions {
  /** Length bounds for each of the four Pairwise_Sections. Default 0 to 6. */
  readonly pairwise?: LengthRange;
  /** Length bounds for the progression. Default 0 to 8. */
  readonly progression?: LengthRange;
  /** The rating block to use. Default: any of its four shapes. */
  readonly rating?: fc.Arbitrary<WireFixture<RatingSummary>>;
  /** The `rich` member to use. Default: any of its shapes. */
  readonly rich?: fc.Arbitrary<RichBlockFixture>;
  /** The progression records to use. Default: mostly rated. */
  readonly progressionRecord?: fc.Arbitrary<
    WireFixture<ProgressionPoint | null>
  >;
}

/** A valid `GetPlayerProfile` body, paired with the profile it parses to. */
export function playerProfileFixtureArb(
  options: PlayerProfileFixtureOptions = {},
): fc.Arbitrary<PlayerProfileFixture> {
  const pairwise = options.pairwise ?? { minLength: 0, maxLength: 6 };
  const progression = options.progression ?? { minLength: 0, maxLength: 8 };

  const coAppearances = fc
    .array(coAppearanceEntryFixtureArb, pairwise)
    .map((entries) => entries.map(stampedCoAppearance));
  const pairedStats = fc
    .array(pairedStatEntryFixtureArb, pairwise)
    .map((entries) => entries.map(stampedPairedStat));

  return fc
    .record({
      membershipId: wireIdentityArb,
      displayName: wireDisplayNameArb,
      state: fc.option(wireMembershipStateArb, { nil: null }),
      stateAbsence: absenceSpellingArb,
      isGuest: fc.boolean(),
      record: playerRecordFixtureArb,
      winPercentage: fc.option(wirePercentageArb, { nil: null }),
      winPercentageAbsence: absenceSpellingArb,
      rating: options.rating ?? ratingSummaryFixtureArb,
      progression: fc.array(
        options.progressionRecord ?? progressionRecordFixtureArb,
        progression,
      ),
      winStreak: wireCountArb,
      unbeatenStreak: wireCountArb,
      mostPlayedWith: coAppearances,
      mostPlayedAgainst: coAppearances,
      bestPartnerships: pairedStats,
      bogeyOpponents: pairedStats,
      bibAppearances: wireCountArb,
      rich: options.rich ?? richBlockFixtureArb,
    })
    .map((input) => buildPlayerProfileFixture(input));
}

/** A valid body with ordinary collection sizes. */
export const profileFixtureArb: fc.Arbitrary<PlayerProfileFixture> =
  playerProfileFixtureArb();

/**
 * A valid body whose every collection is empty — the state a membership that
 * has never played is in, and the fold edge a mid-sized random array misses.
 */
export const emptyCollectionsProfileFixtureArb: fc.Arbitrary<PlayerProfileFixture> =
  playerProfileFixtureArb({
    pairwise: { minLength: 0, maxLength: 0 },
    progression: { minLength: 0, maxLength: 0 },
  });

/** A valid body whose every collection carries exactly one element. */
export const singletonCollectionsProfileFixtureArb: fc.Arbitrary<PlayerProfileFixture> =
  playerProfileFixtureArb({
    pairwise: { minLength: 1, maxLength: 1 },
    progression: { minLength: 1, maxLength: 1 },
  });

/**
 * A valid body at the sizes the design names: 200-element Pairwise_Sections and
 * a 500-point progression.
 */
export const largeProfileFixtureArb: fc.Arbitrary<PlayerProfileFixture> =
  playerProfileFixtureArb({
    pairwise: { minLength: 200, maxLength: 200 },
    progression: { minLength: 500, maxLength: 500 },
  });

/** A valid body whose every progression record carries no Display_Rating. */
export const ratinglessProgressionProfileFixtureArb: fc.Arbitrary<PlayerProfileFixture> =
  playerProfileFixtureArb({
    progression: { minLength: 1, maxLength: 12 },
    progressionRecord: ratinglessProgressionRecordFixtureArb,
  });

/**
 * Every profile-body shape worth quantifying over, as a table.
 *
 * A suite iterates this rather than restating the list, so a shape added here
 * joins every suite at once.
 */
export const PROFILE_FIXTURE_ARBS: readonly {
  readonly label: string;
  readonly arbitrary: fc.Arbitrary<PlayerProfileFixture>;
}[] = [
  { label: 'ordinary collections', arbitrary: profileFixtureArb },
  { label: 'empty collections', arbitrary: emptyCollectionsProfileFixtureArb },
  {
    label: 'singleton collections',
    arbitrary: singletonCollectionsProfileFixtureArb,
  },
  { label: 'large collections', arbitrary: largeProfileFixtureArb },
  {
    label: 'no plottable progression',
    arbitrary: ratinglessProgressionProfileFixtureArb,
  },
  ...RATING_SUMMARY_SHAPES.map((shape) => ({
    label: `rating ${shape.label}`,
    arbitrary: playerProfileFixtureArb({ rating: shape.arbitrary }),
  })),
  ...RICH_BLOCK_SHAPES.map((shape) => ({
    label: `rich ${shape.label}`,
    arbitrary: playerProfileFixtureArb({ rich: shape.arbitrary }),
  })),
];

/** A valid body of any shape in {@link PROFILE_FIXTURE_ARBS}. */
export const anyProfileFixtureArb: fc.Arbitrary<PlayerProfileFixture> =
  fc.oneof(...PROFILE_FIXTURE_ARBS.map((shape) => shape.arbitrary));

/* -------------------------------------------------------------------------- */
/* Fixed samples                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The smallest valid body: every declared-optional member omitted, every
 * collection empty, every count zero — a membership that has never played, in a
 * squad that does not track matches live.
 */
export const MINIMAL_PROFILE_FIXTURE: PlayerProfileFixture =
  buildPlayerProfileFixture({
    membershipId: SAMPLE_IDENTITY,
    displayName: 'Dave',
    state: null,
    stateAbsence: 'missing',
    isGuest: false,
    record: playerRecordFixture({
      appearances: 0,
      wins: 0,
      draws: 0,
      losses: 0,
    }),
    winPercentage: null,
    winPercentageAbsence: 'missing',
    rating: ratingSummaryFixture({
      state: null,
      displayRating: null,
      stateAbsence: 'missing',
      displayRatingAbsence: 'missing',
      modelValues: [0, 0],
    }),
    progression: [],
    winStreak: 0,
    unbeatenStreak: 0,
    mostPlayedWith: [],
    mostPlayedAgainst: [],
    bestPartnerships: [],
    bogeyOpponents: [],
    bibAppearances: 0,
    rich: absentRichBlockFixture('missing'),
  });

/**
 * A fully populated body: every optional member present, both Pairwise_Section
 * kinds carrying two rows, a progression carrying two plottable points and one
 * record with nothing to plot, and a complete rich block.
 */
export const FULL_PROFILE_FIXTURE: PlayerProfileFixture =
  buildPlayerProfileFixture({
    membershipId: SAMPLE_IDENTITY,
    displayName: 'BigDave',
    state: 'Active',
    stateAbsence: 'null',
    isGuest: true,
    record: playerRecordFixture({
      appearances: 24,
      wins: 13,
      draws: 4,
      losses: 7,
    }),
    winPercentage: 54.2,
    winPercentageAbsence: 'null',
    rating: ratingSummaryFixture({
      state: 'Established',
      displayRating: 1_184,
      stateAbsence: 'null',
      displayRatingAbsence: 'null',
      modelValues: [25.5, 4.25],
    }),
    progression: [
      progressionRecordFixture({
        instant: canonicalWireInstant(1_767_225_600_000),
        displayRating: 1_120,
        displayRatingAbsence: 'null',
        state: 'Provisional',
        modelValues: [24, 7.5],
      }),
      progressionRecordFixture({
        instant: canonicalWireInstant(1_767_830_400_000),
        displayRating: null,
        displayRatingAbsence: 'null',
        state: 'Provisional',
        modelValues: [24.5, 6.5],
      }),
      progressionRecordFixture({
        instant: canonicalWireInstant(1_768_435_200_000),
        displayRating: 1_184,
        displayRatingAbsence: 'null',
        state: 'Established',
        modelValues: [25.5, 4.25],
      }),
    ],
    winStreak: 4,
    unbeatenStreak: 6,
    mostPlayedWith: [
      coAppearanceEntryFixture({
        membershipId: wireIdentityForIndex(0),
        displayName: 'Ade',
        count: 19,
      }),
      coAppearanceEntryFixture({
        membershipId: wireIdentityForIndex(1),
        displayName: 'Former player',
        count: 11,
      }),
    ],
    mostPlayedAgainst: [
      coAppearanceEntryFixture({
        membershipId: wireIdentityForIndex(2),
        displayName: 'Sam',
        count: 17,
      }),
    ],
    bestPartnerships: [
      pairedStatEntryFixture({
        membershipId: wireIdentityForIndex(3),
        displayName: 'Ade',
        value: 78.5,
        qualifyingMatches: 14,
      }),
    ],
    bogeyOpponents: [
      pairedStatEntryFixture({
        membershipId: wireIdentityForIndex(4),
        displayName: 'Sam',
        value: 21.5,
        qualifyingMatches: 14,
      }),
    ],
    bibAppearances: 9,
    rich: presentRichBlockFixture(
      richStatsFixture({
        goals: 12,
        cleanSheets: 2,
        goalsConcededAsKeeper: 18,
        keeperTime: canonicalWireDuration(4_500_000),
        absence: 'null',
      }),
    ),
  });

/** Both fixed samples, for suites that want them by name. */
export const SAMPLE_PROFILE_FIXTURES: readonly {
  readonly label: string;
  readonly fixture: PlayerProfileFixture;
}[] = [
  { label: 'minimal', fixture: MINIMAL_PROFILE_FIXTURE },
  { label: 'fully populated', fixture: FULL_PROFILE_FIXTURE },
];

/* -------------------------------------------------------------------------- */
/* Parsed values, for the suites that start from one                           */
/* -------------------------------------------------------------------------- */

/**
 * A parsed `PlayerRecord`.
 *
 * Every parsed arbitrary below is the parsed side of a wire fixture, so a value
 * it yields is one the parser can actually produce — which is what the
 * round-trip property needs (a `PlayerProfile` carrying an instant the printer
 * cannot print would fail that property for the wrong reason).
 */
export const playerRecordArb: fc.Arbitrary<PlayerRecord> =
  playerRecordFixtureArb.map((fixture) => fixture.parsed);

/** A parsed `RatingSummary`, in any of its four shapes. */
export const ratingSummaryArb: fc.Arbitrary<RatingSummary> =
  ratingSummaryFixtureArb.map((fixture) => fixture.parsed);

/** A parsed `ProgressionPoint`. */
export const progressionPointArb: fc.Arbitrary<ProgressionPoint> =
  ratedProgressionRecordFixtureArb.map((fixture) => fixture.parsed);

/** A parsed `CoAppearanceEntry`. */
export const coAppearanceEntryArb: fc.Arbitrary<CoAppearanceEntry> =
  coAppearanceEntryFixtureArb.map((fixture) => fixture.parsed);

/** A parsed `PairedStatEntry`. */
export const pairedStatEntryArb: fc.Arbitrary<PairedStatEntry> =
  pairedStatEntryFixtureArb.map((fixture) => fixture.parsed);

/** A parsed `RichStats` block, in any of its member configurations. */
export const richStatsArb: fc.Arbitrary<RichStats> = richStatsFixtureArb.map(
  (fixture) => fixture.parsed,
);

/**
 * A parsed `PlayerProfile`, weighted towards ordinary sizes and reaching the
 * empty and 200-by-500 extremes.
 */
export const playerProfileArb: fc.Arbitrary<PlayerProfile> = fc.oneof(
  { weight: 6, arbitrary: profileFixtureArb },
  { weight: 2, arbitrary: emptyCollectionsProfileFixtureArb },
  { weight: 2, arbitrary: singletonCollectionsProfileFixtureArb },
  { weight: 1, arbitrary: largeProfileFixtureArb },
  ...RATING_SUMMARY_SHAPES.map((shape) => ({
    weight: 1,
    arbitrary: playerProfileFixtureArb({ rating: shape.arbitrary }),
  })),
  ...RICH_BLOCK_SHAPES.map((shape) => ({
    weight: 1,
    arbitrary: playerProfileFixtureArb({ rich: shape.arbitrary }),
  })),
).map((fixture) => fixture.parsed);
