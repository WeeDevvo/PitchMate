/**
 * The Response_Parser and Response_Printer for the `GetPlayerProfile` body.
 *
 * This is the one module that turns the unknown body of the feature's single
 * call into the typed `PlayerProfile` every screen, panel, and pure function
 * downstream consumes. Everything it reads goes through a reader of
 * `./primitives`, so the four rules of Requirement 13 hold uniformly rather than
 * field by field: total and exception-free (13.1), all-or-nothing (13.2), one bad
 * member fails the body carrying it (13.3), and a property no parser names is
 * never read at all (13.9).
 *
 * ## Built last, from readings already checked
 *
 * Every parser here reads each member it names into a `ParseResult`, returns the
 * first failure it meets, and constructs its value **last** from readings that
 * have all already succeeded (Requirement 13.2). That ordering is the mechanism,
 * not a style: a parser that built its object first and filled fields as it went
 * could yield a value with one member defaulted, and a defaulted statistic is
 * indistinguishable, once rendered, from one the backend sent. There is no
 * assignment to a partially built profile anywhere in this module.
 *
 * The same rule extends to collections. One bad element of any of the four
 * Pairwise_Sections, and one bad Progression_Point, fails the **whole body**
 * (Requirement 13.3) rather than being skipped: a dropped element would silently
 * remove a player from a ranked list — "most played with" missing the person you
 * have played with most — which is worse than showing nothing and saying so.
 *
 * ## The seven declared absences, and nothing else
 *
 * Exactly these members accept null-or-absent, and `null` and an absent property
 * are the same absence (Requirement 13.6):
 *
 * | Member | Why it can be absent |
 * | --- | --- |
 * | `winPercentage` | nobody has played, so there is no ratio to state |
 * | `state` | the membership has no recorded lifecycle state |
 * | `rating.state` | the rating has not been classified |
 * | `rating.displayRating` | there is no settled number to show |
 * | a progression point's `displayRating` | that match produced nothing to plot |
 * | `rich` | the squad's live-tracking feature is off |
 * | each member of `rich` | tracking is on but that figure was never recorded |
 *
 * Every other member this module names rejects null-or-absent. A present but
 * malformed optional member fails too — `readOptional` hands a present value to
 * its reader — because an optional member is optional, not unvalidated: reading
 * a `displayRating` of `'1200'` as an absence would state "no rating recorded"
 * for a membership that has one.
 *
 * ## Why `mu` and `sigma` are absent from this file's readings
 *
 * The wire `RatingSummary` carries `mu` and `sigma`, and every wire progression
 * point carries `mu`, `sigma`, and a `state`. **No parser here names any of
 * them.** That is the whole of Requirement 7.7's guarantee on the read path: a
 * member that is never named is never read, so the parsed type graph contains no
 * field in which a Rating_Internal could sit, and no component, formatter, or
 * chart downstream has one available to plot or to recompute a display number
 * from. It is a stronger guarantee than discarding them after reading, which
 * would leave the fields in reach of the next change.
 *
 * The **printer** does name `mu` and `sigma`, once each, as fixed placeholder
 * zeros (see {@link RATING_MODEL_PLACEHOLDER}). The printer's contract is "emit a
 * body this parser accepts" (Requirement 13.7), not "reproduce the body the
 * backend sent", and the round-trip property compares *parsed values*: a member
 * the parser never reads cannot survive a round trip through it, so there is no
 * value to carry and nothing to emit but a constant. Emitting the names keeps the
 * printer's output shaped like the contract's; emitting zeros keeps the printer
 * free of any rating quantity.
 *
 * ## A progression record with nothing to plot
 *
 * `ProgressionPoint.displayRating` is non-nullable by design, because a point is
 * a thing the chart and the Progression_Table can show. A wire record whose
 * `displayRating` is absent is therefore **not a parse failure** — the absence is
 * one of the seven declared above — and {@link parseProgressionPoint} reports it
 * as an accepted reading carrying **no point** (`ok(null)`). The body parses; the
 * record simply contributes no plottable point, and `lib/progression.ts` derives
 * the series from exactly the points that carry a rating (Requirement 8.1).
 *
 * Pure, React-free, and DOM-free: this module reads no clock, locale, storage, or
 * global, imports no `@pitchmate/api-client`, and resolves every import inside
 * `lib/` (Requirement 14.3).
 *
 * Requirements: 7.7, 13.2, 13.3, 13.6, 13.7, 13.9
 */

import { printDuration } from '../duration';
import {
  isMembershipState,
  isRatingState,
  type MembershipState,
  type RatingState,
} from '../wireEnums';
import {
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
} from './primitives';

/* -------------------------------------------------------------------------- */
/* The parsed value types                                                     */
/* -------------------------------------------------------------------------- */

/** A membership's match record: the four tallies the screen presents. */
export interface PlayerRecord {
  readonly appearances: number;
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
}

/**
 * The rating as this feature is allowed to know it: the backend's
 * classification, and the number it has already computed for display.
 *
 * Carries no mean skill and no uncertainty, because the parser names neither
 * (Requirement 7.7).
 */
export interface RatingSummary {
  readonly state: RatingState | null;
  readonly displayRating: number | null;
}

/**
 * One plottable point of the rating progression: when a match completed, and the
 * Display_Rating recorded for it.
 *
 * `displayRating` is non-nullable — a record that carries none is no point at all
 * (see the module note) — and there is no `state`, no mean, and no uncertainty.
 */
export interface ProgressionPoint {
  readonly completedAtMs: number;
  readonly displayRating: number;
}

/** One row of "most played with" or "most played against". */
export interface CoAppearanceEntry {
  readonly membershipId: string;
  readonly displayName: string;
  readonly count: number;
}

/**
 * One row of "best partnerships" or "bogey opponents": a win percentage over the
 * matches that qualified it.
 */
export interface PairedStatEntry {
  readonly membershipId: string;
  readonly displayName: string;
  readonly value: number;
  readonly qualifyingMatches: number;
}

/**
 * The statistics only a squad that tracks matches live can produce. Each member
 * is independently absent, because tracking may be on while a given figure was
 * never recorded.
 */
export interface RichStats {
  readonly goals: number | null;
  readonly cleanSheets: number | null;
  readonly goalsConcededAsKeeper: number | null;
  readonly keeperTimeMs: number | null;
}

/** One membership's whole squad-scoped profile. */
export interface PlayerProfile {
  readonly membershipId: string;
  readonly displayName: string;
  readonly state: MembershipState | null;
  readonly isGuest: boolean;
  readonly record: PlayerRecord;
  readonly winPercentage: number | null;
  readonly rating: RatingSummary;
  readonly progression: readonly ProgressionPoint[];
  readonly winStreak: number;
  readonly unbeatenStreak: number;
  readonly mostPlayedWith: readonly CoAppearanceEntry[];
  readonly mostPlayedAgainst: readonly CoAppearanceEntry[];
  readonly bestPartnerships: readonly PairedStatEntry[];
  readonly bogeyOpponents: readonly PairedStatEntry[];
  readonly bibAppearances: number;
  readonly rich: RichStats | null;
}

/* -------------------------------------------------------------------------- */
/* Shared machinery                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The value the printer emits for each of the wire's rating-model members.
 *
 * A fixed zero, because the parser reads no such member and so a parsed profile
 * carries no value to print back. See the module note on why the printer names
 * them at all.
 */
const RATING_MODEL_PLACEHOLDER = 0;

/** A parser of one whole value, as every sub-parser in this module is shaped. */
type BodyParser<T> = (body: unknown) => ParseResult<T>;

/**
 * Every element of a wire array, read by `parseElement`, in the order the backend
 * ranked them.
 *
 * The first element failure fails the collection, and therefore the body carrying
 * it (Requirement 13.3). An empty array is an ordinary reading: an empty
 * Pairwise_Section and an empty progression are states the screen states in
 * words.
 *
 * One pass, no recursion: the depth this module descends is fixed by the
 * contract, not by the body.
 */
function readCollection<T>(
  value: unknown,
  label: string,
  parseElement: BodyParser<T>,
): ParseResult<readonly T[]> {
  const elements = readArray(value, label);

  if (!elements.ok) {
    return elements;
  }

  const parsed: T[] = [];

  for (const element of elements.value) {
    const entry = parseElement(element);

    if (!entry.ok) {
      return entry;
    }

    parsed.push(entry.value);
  }

  return ok(parsed);
}

/* -------------------------------------------------------------------------- */
/* The player record                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The `record` block: four counts, every one of them required.
 *
 * Each is read through `readCount`, so a fraction, a negative, or a
 * string-encoded tally fails the body rather than being rounded or clamped into a
 * figure a person would believe (Requirements 13.2, 13.5, 13.10). Zero is an
 * ordinary reading — it is the Never_Played case the screen states in words.
 *
 * Requirements: 13.2, 13.3, 13.10
 */
export function parsePlayerRecord(body: unknown): ParseResult<PlayerRecord> {
  const source = readObject(body, 'profile record');

  if (!source.ok) {
    return source;
  }

  const appearances = readCount(
    readProperty(source.value, 'appearances'),
    'profile record appearances',
  );

  if (!appearances.ok) {
    return appearances;
  }

  const wins = readCount(readProperty(source.value, 'wins'), 'profile record wins');

  if (!wins.ok) {
    return wins;
  }

  const draws = readCount(
    readProperty(source.value, 'draws'),
    'profile record draws',
  );

  if (!draws.ok) {
    return draws;
  }

  const losses = readCount(
    readProperty(source.value, 'losses'),
    'profile record losses',
  );

  if (!losses.ok) {
    return losses;
  }

  return ok({
    appearances: appearances.value,
    wins: wins.value,
    draws: draws.value,
    losses: losses.value,
  });
}

/**
 * A player record rendered back into the wire shape
 * {@link parsePlayerRecord} accepts.
 *
 * Requirements: 13.7
 */
export function printPlayerRecord(record: PlayerRecord): unknown {
  return {
    appearances: record.appearances,
    wins: record.wins,
    draws: record.draws,
    losses: record.losses,
  };
}

/* -------------------------------------------------------------------------- */
/* The rating summary                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The `rating` block, read as the two members this feature is allowed to know:
 * the classification and the Display_Rating.
 *
 * Both are declared-optional (Requirement 13.6) and each absence is meaningful
 * rather than defaulted — together with the Appearance_Count they are exactly
 * what `lib/ratingCondition.ts` needs to tell an established rating from a
 * provisional one, from a player who has never played, from a rating that is
 * simply not recorded.
 *
 * The state is read **by name** against the generated vocabulary
 * (Requirement 13.4), so a value outside the union cannot reach the condition
 * resolver. The Display_Rating is read as a finite number and nothing is done to
 * it — no scaling, no rounding, no flooring (Requirement 7.8); its presentation
 * belongs to `lib/numberFormat.ts` and its scale to the backend.
 *
 * Neither the mean skill nor the uncertainty is named here. See the module note.
 *
 * Requirements: 7.7, 7.8, 13.2, 13.6
 */
export function parseRatingSummary(body: unknown): ParseResult<RatingSummary> {
  const source = readObject(body, 'profile rating');

  if (!source.ok) {
    return source;
  }

  const state = readOptional(
    readProperty(source.value, 'state'),
    'profile rating state',
    (value, label) => readWireEnumName(value, label, isRatingState),
  );

  if (!state.ok) {
    return state;
  }

  const displayRating = readOptional(
    readProperty(source.value, 'displayRating'),
    'profile rating displayRating',
    readNumber,
  );

  if (!displayRating.ok) {
    return displayRating;
  }

  return ok({ state: state.value, displayRating: displayRating.value });
}

/**
 * A rating summary rendered back into the wire shape
 * {@link parseRatingSummary} accepts, with the rating-model members emitted as
 * placeholder zeros (see the module note).
 *
 * Requirements: 13.7
 */
export function printRatingSummary(rating: RatingSummary): unknown {
  return {
    mu: RATING_MODEL_PLACEHOLDER,
    sigma: RATING_MODEL_PLACEHOLDER,
    state: rating.state,
    displayRating: rating.displayRating,
  };
}

/* -------------------------------------------------------------------------- */
/* A progression point                                                        */
/* -------------------------------------------------------------------------- */

/**
 * One element of `progression`: an accepted reading of a plottable point, an
 * accepted reading of **no point**, or a failure.
 *
 * The completion instant is required and is normalised to epoch milliseconds on
 * read, which is what lets the round-trip property compare instants rather than
 * wire strings. The `displayRating` is declared-optional, and its absence yields
 * `ok(null)`: the record parses, and contributes nothing to plot. Deriving the
 * series from exactly the points that carry a rating is the business of
 * `lib/progression.ts` (Requirement 8.1), which is handed only points.
 *
 * A record whose instant is malformed fails — and so fails the whole body
 * (Requirement 13.3) — whether or not it carries a rating: a progression the
 * chart cannot order is not a progression.
 *
 * The wire record's `mu`, `sigma`, and `state` are not named (Requirement 7.7).
 *
 * Requirements: 7.7, 13.3, 13.6
 */
export function parseProgressionPoint(
  body: unknown,
): ParseResult<ProgressionPoint | null> {
  const source = readObject(body, 'progression point');

  if (!source.ok) {
    return source;
  }

  const completedAtMs = readInstantMs(
    readProperty(source.value, 'completedAt'),
    'progression point completedAt',
  );

  if (!completedAtMs.ok) {
    return completedAtMs;
  }

  const displayRating = readOptional(
    readProperty(source.value, 'displayRating'),
    'progression point displayRating',
    readNumber,
  );

  if (!displayRating.ok) {
    return displayRating;
  }

  if (displayRating.value === null) {
    return ok(null);
  }

  return ok({
    completedAtMs: completedAtMs.value,
    displayRating: displayRating.value,
  });
}

/**
 * A progression point rendered back into the wire shape
 * {@link parseProgressionPoint} accepts, with the rating-model members emitted as
 * placeholder zeros (see the module note). No `state` is emitted, because none is
 * read.
 *
 * Requirements: 13.7
 */
export function printProgressionPoint(point: ProgressionPoint): unknown {
  return {
    completedAt: printInstant(point.completedAtMs),
    mu: RATING_MODEL_PLACEHOLDER,
    sigma: RATING_MODEL_PLACEHOLDER,
    displayRating: point.displayRating,
  };
}

/* -------------------------------------------------------------------------- */
/* A co-appearance entry                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One element of `mostPlayedWith` or `mostPlayedAgainst`. Every member is
 * required: a row without an identity cannot be linked, a row without a name
 * cannot be read, and a row without a count ranks nothing.
 *
 * The display name is taken exactly as supplied — untrimmed and unaltered —
 * because it may be the Anonymised_Placeholder, which the screen recognises by
 * its text (Requirement 10.8).
 *
 * Requirements: 13.2, 13.3
 */
export function parseCoAppearanceEntry(
  body: unknown,
): ParseResult<CoAppearanceEntry> {
  const source = readObject(body, 'co-appearance entry');

  if (!source.ok) {
    return source;
  }

  const membershipId = readUuid(
    readProperty(source.value, 'membershipId'),
    'co-appearance entry membershipId',
  );

  if (!membershipId.ok) {
    return membershipId;
  }

  const displayName = readString(
    readProperty(source.value, 'displayName'),
    'co-appearance entry displayName',
  );

  if (!displayName.ok) {
    return displayName;
  }

  const count = readCount(
    readProperty(source.value, 'count'),
    'co-appearance entry count',
  );

  if (!count.ok) {
    return count;
  }

  return ok({
    membershipId: membershipId.value,
    displayName: displayName.value,
    count: count.value,
  });
}

/**
 * A co-appearance entry rendered back into the wire shape
 * {@link parseCoAppearanceEntry} accepts.
 *
 * Requirements: 13.7
 */
export function printCoAppearanceEntry(entry: CoAppearanceEntry): unknown {
  return {
    membershipId: entry.membershipId,
    displayName: entry.displayName,
    count: entry.count,
  };
}

/* -------------------------------------------------------------------------- */
/* A paired statistic entry                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One element of `bestPartnerships` or `bogeyOpponents`.
 *
 * `value` is a win percentage — the share of qualifying matches won alongside, or
 * against, that player — so it is read through `readPercentage` and must lie in
 * the closed range 0.0 to 100.0 with no clamping (Requirements 13.2, 13.10). A
 * clamped value would present a perfect partnership record that the matches do
 * not support. `qualifyingMatches` is the count the percentage was computed over
 * and is required, because a percentage without its denominator cannot be read
 * honestly.
 *
 * Requirements: 13.2, 13.3, 13.10
 */
export function parsePairedStatEntry(
  body: unknown,
): ParseResult<PairedStatEntry> {
  const source = readObject(body, 'paired statistic entry');

  if (!source.ok) {
    return source;
  }

  const membershipId = readUuid(
    readProperty(source.value, 'membershipId'),
    'paired statistic entry membershipId',
  );

  if (!membershipId.ok) {
    return membershipId;
  }

  const displayName = readString(
    readProperty(source.value, 'displayName'),
    'paired statistic entry displayName',
  );

  if (!displayName.ok) {
    return displayName;
  }

  const value = readPercentage(
    readProperty(source.value, 'value'),
    'paired statistic entry value',
  );

  if (!value.ok) {
    return value;
  }

  const qualifyingMatches = readCount(
    readProperty(source.value, 'qualifyingMatches'),
    'paired statistic entry qualifyingMatches',
  );

  if (!qualifyingMatches.ok) {
    return qualifyingMatches;
  }

  return ok({
    membershipId: membershipId.value,
    displayName: displayName.value,
    value: value.value,
    qualifyingMatches: qualifyingMatches.value,
  });
}

/**
 * A paired statistic entry rendered back into the wire shape
 * {@link parsePairedStatEntry} accepts.
 *
 * Requirements: 13.7
 */
export function printPairedStatEntry(entry: PairedStatEntry): unknown {
  return {
    membershipId: entry.membershipId,
    displayName: entry.displayName,
    value: entry.value,
    qualifyingMatches: entry.qualifyingMatches,
  };
}

/* -------------------------------------------------------------------------- */
/* The rich stats block                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The `rich` block, every member of which is independently declared-optional
 * (Requirement 13.6).
 *
 * The block being **absent** and the block being present with every member
 * absent are different states — the squad's live-tracking feature being off,
 * versus tracking being on with nothing recorded — and `lib/richStats.ts` tells
 * them apart, which is why this parser never collapses an all-absent block to an
 * absent one (Requirements 11.1, 11.2, 11.6).
 *
 * Keeper_Time arrives as a .NET `TimeSpan` string and is normalised to
 * milliseconds on read, so the parsed block carries no wire formatting and the
 * presentation form is `lib/duration.ts`'s business.
 *
 * Requirements: 13.2, 13.6, 13.10
 */
export function parseRichStats(body: unknown): ParseResult<RichStats> {
  const source = readObject(body, 'profile rich stats');

  if (!source.ok) {
    return source;
  }

  const goals = readOptional(
    readProperty(source.value, 'goals'),
    'profile rich stats goals',
    readCount,
  );

  if (!goals.ok) {
    return goals;
  }

  const cleanSheets = readOptional(
    readProperty(source.value, 'cleanSheets'),
    'profile rich stats cleanSheets',
    readCount,
  );

  if (!cleanSheets.ok) {
    return cleanSheets;
  }

  const goalsConcededAsKeeper = readOptional(
    readProperty(source.value, 'goalsConcededAsKeeper'),
    'profile rich stats goalsConcededAsKeeper',
    readCount,
  );

  if (!goalsConcededAsKeeper.ok) {
    return goalsConcededAsKeeper;
  }

  const keeperTimeMs = readOptional(
    readProperty(source.value, 'keeperTime'),
    'profile rich stats keeperTime',
    readDurationMs,
  );

  if (!keeperTimeMs.ok) {
    return keeperTimeMs;
  }

  return ok({
    goals: goals.value,
    cleanSheets: cleanSheets.value,
    goalsConcededAsKeeper: goalsConcededAsKeeper.value,
    keeperTimeMs: keeperTimeMs.value,
  });
}

/**
 * A rich stats block rendered back into the wire shape {@link parseRichStats}
 * accepts, with the Keeper_Time printed in the canonical duration form.
 *
 * Requirements: 13.7
 */
export function printRichStats(rich: RichStats): unknown {
  return {
    goals: rich.goals,
    cleanSheets: rich.cleanSheets,
    goalsConcededAsKeeper: rich.goalsConcededAsKeeper,
    keeperTime:
      rich.keeperTimeMs === null ? null : printDuration(rich.keeperTimeMs),
  };
}

/* -------------------------------------------------------------------------- */
/* The whole profile                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The whole `GetPlayerProfile` body.
 *
 * Total over every input and free of exceptions, and all-or-nothing: the profile
 * is constructed on the last line, from sixteen readings every one of which has
 * already succeeded (Requirement 13.2). Any failure — a malformed identity, a
 * fractional count, a percentage out of range, a state outside its vocabulary, a
 * bad element anywhere in the five collections — returns that failure and no
 * value, so no statistic is ever rendered from a body another statistic was
 * rejected from (Requirement 13.3).
 *
 * Unrecognised properties are never named and therefore never read
 * (Requirement 13.9): an additive backend change cannot fail this parse, and a
 * property named for a rating quantity cannot reach the parsed graph even if one
 * appears beside the members this parser does read.
 *
 * Requirements: 7.7, 13.2, 13.3, 13.6, 13.9
 */
export function parsePlayerProfile(body: unknown): ParseResult<PlayerProfile> {
  const source = readObject(body, 'profile');

  if (!source.ok) {
    return source;
  }

  const membershipId = readUuid(
    readProperty(source.value, 'membershipId'),
    'profile membershipId',
  );

  if (!membershipId.ok) {
    return membershipId;
  }

  const displayName = readString(
    readProperty(source.value, 'displayName'),
    'profile displayName',
  );

  if (!displayName.ok) {
    return displayName;
  }

  const state = readOptional(
    readProperty(source.value, 'state'),
    'profile state',
    (value, label) => readWireEnumName(value, label, isMembershipState),
  );

  if (!state.ok) {
    return state;
  }

  const isGuest = readBoolean(
    readProperty(source.value, 'isGuest'),
    'profile isGuest',
  );

  if (!isGuest.ok) {
    return isGuest;
  }

  const record = parsePlayerRecord(readProperty(source.value, 'record'));

  if (!record.ok) {
    return record;
  }

  const winPercentage = readOptional(
    readProperty(source.value, 'winPercentage'),
    'profile winPercentage',
    readPercentage,
  );

  if (!winPercentage.ok) {
    return winPercentage;
  }

  const rating = parseRatingSummary(readProperty(source.value, 'rating'));

  if (!rating.ok) {
    return rating;
  }

  const progression = readCollection(
    readProperty(source.value, 'progression'),
    'profile progression',
    parseProgressionPoint,
  );

  if (!progression.ok) {
    return progression;
  }

  const winStreak = readCount(
    readProperty(source.value, 'winStreak'),
    'profile winStreak',
  );

  if (!winStreak.ok) {
    return winStreak;
  }

  const unbeatenStreak = readCount(
    readProperty(source.value, 'unbeatenStreak'),
    'profile unbeatenStreak',
  );

  if (!unbeatenStreak.ok) {
    return unbeatenStreak;
  }

  const mostPlayedWith = readCollection(
    readProperty(source.value, 'mostPlayedWith'),
    'profile mostPlayedWith',
    parseCoAppearanceEntry,
  );

  if (!mostPlayedWith.ok) {
    return mostPlayedWith;
  }

  const mostPlayedAgainst = readCollection(
    readProperty(source.value, 'mostPlayedAgainst'),
    'profile mostPlayedAgainst',
    parseCoAppearanceEntry,
  );

  if (!mostPlayedAgainst.ok) {
    return mostPlayedAgainst;
  }

  const bestPartnerships = readCollection(
    readProperty(source.value, 'bestPartnerships'),
    'profile bestPartnerships',
    parsePairedStatEntry,
  );

  if (!bestPartnerships.ok) {
    return bestPartnerships;
  }

  const bogeyOpponents = readCollection(
    readProperty(source.value, 'bogeyOpponents'),
    'profile bogeyOpponents',
    parsePairedStatEntry,
  );

  if (!bogeyOpponents.ok) {
    return bogeyOpponents;
  }

  const bibAppearances = readCount(
    readProperty(source.value, 'bibAppearances'),
    'profile bibAppearances',
  );

  if (!bibAppearances.ok) {
    return bibAppearances;
  }

  const rich = readOptional(
    readProperty(source.value, 'rich'),
    'profile rich stats',
    (value) => parseRichStats(value),
  );

  if (!rich.ok) {
    return rich;
  }

  return ok({
    membershipId: membershipId.value,
    displayName: displayName.value,
    state: state.value,
    isGuest: isGuest.value,
    record: record.value,
    winPercentage: winPercentage.value,
    rating: rating.value,
    // A record carrying no Display_Rating reads as no point (see the module
    // note); the body is accepted and contributes nothing to plot.
    progression: progression.value.filter(
      (point): point is ProgressionPoint => point !== null,
    ),
    winStreak: winStreak.value,
    unbeatenStreak: unbeatenStreak.value,
    mostPlayedWith: mostPlayedWith.value,
    mostPlayedAgainst: mostPlayedAgainst.value,
    bestPartnerships: bestPartnerships.value,
    bogeyOpponents: bogeyOpponents.value,
    bibAppearances: bibAppearances.value,
    rich: rich.value,
  });
}

/**
 * A parsed profile rendered back into a body {@link parsePlayerProfile} accepts.
 *
 * Instants and durations are printed in their canonical wire forms, and the
 * wire's rating-model members are emitted as placeholder zeros — the printer's
 * output is "a body this parser accepts", not "the body the backend sent" (see
 * the module note).
 *
 * Requirements: 13.7
 */
export function printPlayerProfile(profile: PlayerProfile): unknown {
  return {
    membershipId: profile.membershipId,
    displayName: profile.displayName,
    state: profile.state,
    isGuest: profile.isGuest,
    record: printPlayerRecord(profile.record),
    winPercentage: profile.winPercentage,
    rating: printRatingSummary(profile.rating),
    progression: profile.progression.map(printProgressionPoint),
    winStreak: profile.winStreak,
    unbeatenStreak: profile.unbeatenStreak,
    mostPlayedWith: profile.mostPlayedWith.map(printCoAppearanceEntry),
    mostPlayedAgainst: profile.mostPlayedAgainst.map(printCoAppearanceEntry),
    bestPartnerships: profile.bestPartnerships.map(printPairedStatEntry),
    bogeyOpponents: profile.bogeyOpponents.map(printPairedStatEntry),
    bibAppearances: profile.bibAppearances,
    rich: profile.rich === null ? null : printRichStats(profile.rich),
  };
}
