/**
 * The reading primitives every Response_Parser in `lib/parse/` is built from.
 *
 * `GetPlayerProfile` hands this feature an `unknown` body: the generated client
 * pins the *shape* the contract declares at compile time, but nothing checks at
 * runtime that the body which arrived is that shape. Turning the unknown value
 * into a typed `PlayerProfile` is the job of `playerProfile.ts`, and every field
 * it reads goes through a reader declared here. Declaring them once is what makes
 * the four rules of Requirement 13 hold uniformly rather than per field:
 *
 *  - **Total** (13.1). Every reader yields exactly one of `{ ok: true, value }`
 *    and `{ ok: false, reason }` for every input of every type — absent, `null`,
 *    a primitive, an array, an object nested a hundred levels deep — and raises
 *    nothing. There is no third outcome and no partially populated value.
 *  - **All or nothing** (13.2). A reader either yields a fully valid reading or a
 *    failure; it never defaults, repairs, truncates, coerces, rounds, or clamps.
 *    A parser therefore builds its result *last*, from readings it has already
 *    checked, and one bad field fails the body carrying it (13.3) rather than
 *    producing a profile with that field defaulted or dropped — a dropped member
 *    would silently remove a player from a ranked list, which is worse than
 *    showing nothing.
 *  - **Additive-change tolerant** (13.9). A reader only ever looks at a value a
 *    parser hands it, so a property no parser names is never read at all — a
 *    stronger guarantee than discarding it afterwards: an unrecognised property
 *    cannot fail a parse, cannot slow one, and cannot reach a rendered figure.
 *    It is also how the parsed type graph stays free of a Rating_Internal
 *    (Requirement 7.7): `mu` and `sigma` are not filtered out, they are never
 *    named, so there is no field that could hold one.
 *  - **Pure** (13.1, 14.3). This module is React-free and DOM-free, imports no
 *    `@pitchmate/api-client`, and reads no clock, locale, storage, or global. Its
 *    only imports are two of the feature's own `lib/` modules.
 *
 * ## Iterative by construction, never recursive
 *
 * No reader here walks the interior of an unknown value. {@link readObject}
 * establishes that a value is a plain object and {@link readArray} that it is an
 * array; neither looks inside. Depth is therefore paid for only where a parser
 * deliberately descends one level, and a body nested a hundred (or a hundred
 * thousand) levels deep costs a single type test rather than a stack frame per
 * level. The one loop in the module — the offset arithmetic of
 * {@link readInstantMs} — runs over a matched string of bounded length.
 *
 * Nothing here coerces an unknown value to a string or a number either, so a
 * hostile `toString` or `valueOf` never runs. The only place an arbitrary input
 * could raise at all is the read of a property that is defined as a throwing
 * accessor, which is why {@link readProperty} exists and why parsers take their
 * fields through it: a throwing *recognised* property costs that field its
 * reading, and a throwing *unrecognised* property costs nothing because it is
 * never read.
 *
 * ## Failure reasons are diagnostics, never user-facing text
 *
 * A `reason` is composed from the caller's own literal label plus a fixed clause
 * declared in this module, and it never embeds the value that was read
 * (Requirement 13.8). That is deliberate: a display name, an identity, or a
 * backend `detail` string embedded in a reason could travel into a log or a
 * rendered outcome, and Requirements 3.7 and 12.5 forbid exactly that — the
 * whole point of the Not_Found_Treatment is that a person cannot learn from the
 * screen whether a membership exists. A person is shown the single
 * `GENERIC_PROFILE_FAILURE` of `lib/messages.ts`; a reason exists so a failing
 * test says which field was wrong.
 *
 * Requirements: 13.1, 13.2, 13.8, 13.10
 */

import { readDurationMs as readTransmittedDuration } from '../duration';
import { isPlayerStatsIdentifier } from '../identifiers';

/* -------------------------------------------------------------------------- */
/* The result shape                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The outcome of reading a value: a fully populated reading, or a failure
 * carrying a diagnostic reason. There is no third shape and no partial value
 * (Requirement 13.2).
 *
 * This is the feature's **canonical** declaration. `lib/duration.ts` declares a
 * structurally identical local mirror, because it is the module this one takes
 * its duration seam *from* and so cannot import this one without a cycle; the
 * two are pinned together by the annotation on {@link readDurationMs} below,
 * which fails the compiler here if either drifts.
 */
export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/**
 * A reader of one unknown value, labelled for its failure reason — the shape
 * every reader in this module has, so that {@link readOptional} can wrap any of
 * them and a parser can pass one around.
 */
export type ValueReader<T> = (value: unknown, label: string) => ParseResult<T>;

/** A plain wire object: string keys onto values that are still unvalidated. */
export type WireObject = Readonly<Record<string, unknown>>;

/**
 * A successful reading.
 *
 * Requirements: 13.1
 */
export function ok<T>(value: T): ParseResult<T> {
  return { ok: true, value };
}

/**
 * A failed reading.
 *
 * Returns `ParseResult<never>`, which is assignable to `ParseResult<T>` for every
 * `T`, so a parser can `return fail(…)` from a function of any result type
 * without restating the type.
 *
 * @param reason a diagnostic composed from literal text only — never from the
 *   value that was read (see the module note on reasons)
 *
 * Requirements: 13.1, 13.8
 */
export function fail(reason: string): ParseResult<never> {
  return { ok: false, reason };
}

/* -------------------------------------------------------------------------- */
/* Structural readers                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A value read as a plain wire object.
 *
 * Accepted: an object that is neither `null` nor an array. Rejected: `undefined`,
 * `null`, an array — an array is a list, not a body — and every primitive,
 * including a string of JSON, which is not parsed here.
 *
 * **The object's interior is not inspected**, so a value of any depth costs one
 * type test (see the module note on iteration). The result is typed as a record
 * of `unknown` because nothing about its properties has been established yet;
 * each property is read afterwards, through {@link readProperty} and one of the
 * value readers.
 *
 * Requirements: 13.1, 13.9
 */
export function readObject(value: unknown, label: string): ParseResult<WireObject> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(`${label} is not an object`);
  }

  return ok(value as WireObject);
}

/**
 * A value read as a wire array.
 *
 * Accepted: an array, empty included — an empty Pairwise_Section and an empty
 * progression are ordinary readings, not failures, and the screen states them in
 * words. Rejected: `undefined`, `null`, an array-like object, and every
 * primitive. The elements are **not** inspected — the caller reads each one with
 * the reader its shape requires, which is what keeps element failure a decision
 * of the calling parser (a bad element fails the body it belongs to,
 * Requirement 13.3) rather than a rule baked in here.
 *
 * Requirements: 13.1
 */
export function readArray(
  value: unknown,
  label: string,
): ParseResult<readonly unknown[]> {
  if (!Array.isArray(value)) {
    return fail(`${label} is not an array`);
  }

  return ok(value as readonly unknown[]);
}

/**
 * One named property of a wire object, or `undefined` when the object carries no
 * such property.
 *
 * The read of a property is the only operation in this module that an arbitrary
 * input value could make raise, because a property can be defined as an accessor
 * that throws. Guarding it here is what makes "never throws" absolute rather than
 * conditional on the body being ordinary JSON: a throwing property reads as
 * absent, which the field's own reader then turns into a failure for the body
 * carrying it — or, for one of the seven declared-optional members, into the
 * same absence a `null` yields.
 *
 * An unrecognised property is never passed to this function at all — a parser
 * names the properties it wants — so Requirement 13.9 holds by omission rather
 * than by filtering.
 *
 * @param source an object established by {@link readObject}
 * @param key the property name, a literal in the calling parser
 *
 * Requirements: 13.1, 13.9
 */
export function readProperty(source: WireObject, key: string): unknown {
  try {
    return source[key];
  } catch {
    return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/* Primitive readers                                                          */
/* -------------------------------------------------------------------------- */

/** Inclusive length bounds on a string reading, both optional. */
export interface StringBounds {
  /** Least accepted length in UTF-16 code units; `0` when unstated. */
  readonly minLength?: number;
  /** Greatest accepted length in UTF-16 code units; unbounded when unstated. */
  readonly maxLength?: number;
}

/**
 * A value read as a string, optionally within inclusive length bounds.
 *
 * Accepted: a string of a length within the stated bounds, exactly as supplied.
 * Rejected: every non-string — a number, a boolean, `null`, absent, an array, an
 * object, a boxed string — and a string outside the bounds.
 *
 * Nothing is coerced and nothing is repaired: a number is not stringified and a
 * string is not trimmed, because a parser must not turn a value nobody sent into
 * a value a screen renders. A parser that wants a trimmed value states the
 * trimming itself, and a parser that wants a non-empty value states
 * `{ minLength: 1 }` — the default bound is `0`, so this reader answers only the
 * question of type.
 *
 * Length is counted in UTF-16 code units, the same unit the backend's own bounds
 * are expressed in.
 *
 * Requirements: 13.1, 13.2
 */
export function readString(
  value: unknown,
  label: string,
  bounds: StringBounds = {},
): ParseResult<string> {
  if (typeof value !== 'string') {
    return fail(`${label} is not a string`);
  }

  const minLength = bounds.minLength ?? 0;

  if (value.length < minLength) {
    return fail(`${label} is shorter than its least accepted length`);
  }

  if (bounds.maxLength !== undefined && value.length > bounds.maxLength) {
    return fail(`${label} is longer than its greatest accepted length`);
  }

  return ok(value);
}

/**
 * A value read as a finite number.
 *
 * Accepted: a `number` that is neither `NaN` nor an infinity. Rejected: every
 * non-number — notably a **string-encoded** number, since `'12'` is not how this
 * backend serialises a number and accepting it would let a mistyped field parse
 * (Requirement 13.5) — along with `NaN` and either infinity, neither of which
 * JSON can carry.
 *
 * Negative zero is accepted and preserved; it is the same number as zero for
 * every comparison this feature makes of a wire value.
 *
 * A reading is not constrained here beyond finiteness. The three fields whose
 * ranges the contract narrows are read through the narrower readers built on this
 * one — {@link readCount} for a count and {@link readPercentage} for the
 * Win_Percentage — and no enum-valued field reaches this reader at all: every
 * wire enum arrives as a member name and is read through
 * {@link readWireEnumName} (Requirement 13.4).
 *
 * Requirements: 13.1, 13.5
 */
export function readNumber(value: unknown, label: string): ParseResult<number> {
  if (typeof value !== 'number') {
    return fail(`${label} is not a number`);
  }

  if (!Number.isFinite(value)) {
    return fail(`${label} is not a finite number`);
  }

  return ok(value);
}

/**
 * A value read as a boolean.
 *
 * Accepted: `true` and `false`. Rejected: everything else, including `0`, `1`,
 * `'true'`, `'false'`, and `null` — a boolean field the backend did not send is a
 * failure rather than a silent `false`, because a defaulted flag would decide a
 * screen's behaviour on a value nobody supplied. The feature's one such field is
 * the guest flag, which decides whether the Guest_Label is rendered.
 *
 * Requirements: 13.1, 13.2
 */
export function readBoolean(value: unknown, label: string): ParseResult<boolean> {
  if (typeof value !== 'boolean') {
    return fail(`${label} is not a boolean`);
  }

  return ok(value);
}

/**
 * A value read as an identity in the 36-character hyphenated form.
 *
 * The accepted form and the reasons for rejecting the unhyphenated, braced, and
 * whitespace-padded variants are stated once, in `lib/identifiers.ts`, and read
 * from there rather than restated: within this feature there is exactly one
 * declaration of what an identity looks like, so an identity accepted by the
 * Player_Stats_Route's own check and an identity accepted by the parser cannot
 * disagree. Letter case is preserved, because the identity is opaque to this
 * feature — it is forwarded, never interpreted.
 *
 * Requirements: 13.1
 */
export function readUuid(value: unknown, label: string): ParseResult<string> {
  if (!isPlayerStatsIdentifier(value)) {
    return fail(`${label} is not an identity`);
  }

  return ok(value);
}

/* -------------------------------------------------------------------------- */
/* Narrowed numeric readers                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A value read as a count: a non-negative whole number.
 *
 * This is the reader for every figure the Player_Record and the statistics carry
 * as a tally — appearances, wins, draws, losses, the two streak lengths, the
 * Bib_Appearance count, a co-appearance count, a paired statistic's qualifying
 * matches, and the whole-number members of the Rich_Stats block.
 *
 * Accepted: a finite `number` that is a whole number and is not negative. `0` is
 * a reading like any other — a membership with no appearances is the
 * Never_Played case the screen states in words, not a parse failure — and `-0`
 * is accepted as the zero it is.
 *
 * Rejected, and **nothing is rounded or clamped** to make it pass
 * (Requirement 13.2): a fraction (`2.5`, `-0.5`), a negative (`-1`), `NaN`,
 * either infinity, and a string-encoded count (`'12'`, Requirement 13.5), along
 * with every other non-number. A rounded count is the worst available outcome
 * here: `2.5` appearances would render as a confident `3`, and a clamped `-1`
 * would render as a confident `0`, each presenting a backend fault as a figure a
 * person would believe. Failing the body surfaces the fault instead.
 *
 * Wholeness is tested with `Number.isInteger` rather than `Number.isSafeInteger`,
 * because the stated rule is "non-negative whole number" and a count beyond the
 * exactly representable range is still the whole number it says it is. No such
 * count can arise from this backend — every one of these figures is a row count
 * over a squad's matches — so the distinction is theoretical; stating the rule
 * the requirement states keeps the reader's accepted set exactly the one
 * Property 13 asserts.
 *
 * Total over every input and free of exceptions, and built on
 * {@link readNumber} so the type and finiteness rules are stated once.
 *
 * Requirements: 13.1, 13.2, 13.10
 */
export const readCount: ValueReader<number> = (value, label) => {
  const number = readNumber(value, label);

  if (!number.ok) {
    return number;
  }

  if (!Number.isInteger(number.value)) {
    return fail(`${label} is not a whole number`);
  }

  if (number.value < 0) {
    return fail(`${label} is a negative count`);
  }

  return ok(number.value);
};

/** The least percentage the contract admits. */
const MIN_PERCENTAGE = 0;

/** The greatest percentage the contract admits. */
const MAX_PERCENTAGE = 100;

/**
 * A value read as a percentage: a finite number in the **closed** range 0.0 to
 * 100.0.
 *
 * The feature's one such field is the Win_Percentage, which the backend computes
 * and this feature only presents (to one decimal place, by
 * `lib/numberFormat.ts`).
 *
 * Accepted: every finite number from `0` to `100` inclusive. Both endpoints are
 * readings a real record produces — a membership that has won every match and
 * one that has won none — and `-0` is accepted as the zero it is.
 *
 * Rejected, with **no clamping** (Requirement 13.2): a value below the range
 * (`-0.1`), a value above it (`100.1`), `NaN`, either infinity, a string-encoded
 * percentage (`'50'`, Requirement 13.5), and every other non-number. Clamping
 * `100.1` to `100` would render a perfect record for a membership that has lost
 * matches; failing the body says so instead.
 *
 * A fractional percentage is *expected*, not merely tolerated: a 1-in-3 record is
 * `33.333…`, and rounding it here rather than at presentation would lose the
 * decimal place the screen shows.
 *
 * Total over every input and free of exceptions.
 *
 * Requirements: 13.1, 13.2, 13.10
 */
export const readPercentage: ValueReader<number> = (value, label) => {
  const number = readNumber(value, label);

  if (!number.ok) {
    return number;
  }

  if (number.value < MIN_PERCENTAGE || number.value > MAX_PERCENTAGE) {
    return fail(`${label} is outside the accepted percentage range`);
  }

  return ok(number.value);
};

/**
 * A value read as a duration in milliseconds — the Keeper_Time reader, declared
 * in `lib/duration.ts` and re-exported here so that a parser takes **all** of its
 * readers from one module.
 *
 * The reader itself lives beside the duration printer and the duration formatter,
 * because the three are one subject: the accepted .NET `TimeSpan` wire form, the
 * canonical form printed back, and the `'1h 05m'` form a person reads. Splitting
 * the reader away from its printer would let the pair drift; re-exporting it here
 * costs nothing and keeps `playerProfile.ts` importing from a single place.
 *
 * The annotation on this binding is the **pinning between the two result
 * shapes**. `lib/duration.ts` declares its own structurally identical
 * `ParseResult`/`ValueReader` mirror, because this module takes its duration seam
 * from that one and so that one cannot import this one without a cycle. Assigning
 * it to the canonical {@link ValueReader} here means a change to either
 * declaration fails `tsc -b` at this line rather than passing as two types that
 * have quietly stopped agreeing.
 *
 * Accepts exactly the non-negative durations of the transmitted form and rejects
 * the negative form, every other string shape, and every non-string (a number of
 * milliseconds included); see that module for why.
 *
 * Requirements: 13.1, 13.10
 */
export const readDurationMs: ValueReader<number> = readTransmittedDuration;

/* -------------------------------------------------------------------------- */
/* Wire enum names                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A membership test over one wire enum's names — the shape of every predicate
 * `lib/wireEnums.ts` exports.
 *
 * Declared structurally rather than imported, so this module stays unaware of
 * which enums exist: the reader below is the same reader for both of them, and
 * the vocabulary it enforces is the predicate's, which is in turn pinned to the
 * generated union at compile time (Requirement 13.4).
 */
export type WireEnumNamePredicate<TName extends string> = (
  candidate: unknown,
) => candidate is TName;

/**
 * A value read as a member name of one wire enum, validated against the
 * generated vocabulary that `isName` tests (Requirement 13.4).
 *
 * Accepted: exactly the names the predicate admits, returned unchanged. Rejected:
 * every other value — a string outside the union (`'provisional'` in the wrong
 * case, `'Settled'`), a number (including the code a previous contract sent for
 * the same field), a boolean, `null`, absent, an array, an object, a boxed
 * string. Nothing is coerced, case-folded, or defaulted, so a state nobody sent
 * never reaches the Rating_Condition the screen resolves.
 *
 * Reading **by name** rather than by code is what removes a whole class of silent
 * error: a code would depend on a hand-maintained table agreeing with the
 * backend's declaration order, and a table that disagreed would map a field to
 * the wrong *valid* member rather than failing — an `Established` rating
 * presented for a `Provisional` one. A name either is in the generated union or
 * is not.
 *
 * Total over every input and free of exceptions. The predicate compares the
 * candidate against a fixed list of strings with `===`, so the value is never
 * converted and a hostile `toString` or `valueOf` never runs; nothing here looks
 * inside the value either, so depth costs one membership test.
 *
 * An absence is not this reader's business. Both of the feature's wire-enum
 * fields — the Membership_State and the Rating_State — are declared-optional, so
 * the parser wraps this reader in {@link readOptional} for each; keeping the
 * tolerance at the call site is what leaves it a decision of each field rather
 * than a rule baked in here (Requirement 13.6).
 *
 * @param isName a membership predicate from `lib/wireEnums.ts`
 *
 * Requirements: 13.1, 13.4
 */
export function readWireEnumName<TName extends string>(
  value: unknown,
  label: string,
  isName: WireEnumNamePredicate<TName>,
): ParseResult<TName> {
  if (!isName(value)) {
    return fail(`${label} names no member of its wire enum`);
  }

  return ok(value);
}

/* -------------------------------------------------------------------------- */
/* Absence                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A value read as either an absence or a reading of the given reader.
 *
 * `null` and an absent property are **the same absence** and both yield `null`.
 * The distinction a JSON body can express between "sent as null" and "not sent"
 * carries no meaning for this feature: a Win_Percentage is absent because nobody
 * has played, not because of how the body was serialised. Collapsing it here is
 * what lets one reader serve all seven of Requirement 13.6's declared-optional
 * members — the Win_Percentage, the Membership_State, the Rating_State, every
 * Display_Rating, the Rich_Stats block, and each member of that block.
 *
 * Any other value is handed to `reader`, so a *present but malformed* optional
 * field fails rather than quietly reading as an absence. That asymmetry is the
 * point: an optional field is optional, not unvalidated. A Display_Rating of
 * `'1200'` is a fault, and reading it as "no rating" would present the
 * Rating_Absent statement for a membership that has one.
 *
 * @param reader the reader for a present value; any reader of this module, or a
 *   lambda closing over one that needs bounds
 *
 * Requirements: 13.1, 13.6
 */
export function readOptional<T>(
  value: unknown,
  label: string,
  reader: ValueReader<T>,
): ParseResult<T | null> {
  if (value === null || value === undefined) {
    return ok(null);
  }

  return reader(value, label);
}

/* -------------------------------------------------------------------------- */
/* Instants                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The largest absolute instant a date value can represent, and so the bound
 * outside which an instant is neither readable nor printable.
 */
export const MAX_INSTANT_MS = 8_640_000_000_000_000;

/**
 * An ISO 8601 date-time carrying an explicit UTC designator or a numeric UTC
 * offset. A value carrying neither matches nothing here, which is the point: a
 * local-time instant names no instant.
 *
 * Accepted: a four-digit year or the expanded signed six-digit year an instant
 * near the ends of the representable range prints as, an optional seconds field,
 * an optional fractional part introduced by `.` or `,`, and an offset of `Z`,
 * `±HH:MM`, `±HHMM`, or `±HH`. Anchored at both ends; neither global nor sticky,
 * so it carries no `lastIndex` state between calls.
 */
const ISO_DATE_TIME_PATTERN =
  /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(Z|z|[+-]\d{2}:\d{2}|[+-]\d{4}|[+-]\d{2})$/;

/**
 * A value read as an instant in epoch milliseconds.
 *
 * The feature's one instant is a Progression_Point's match-completion time, which
 * orders the Progression_Series and labels a row of the Progression_Table.
 * Normalising to milliseconds on read is why the round-trip property
 * (Property 10) compares instants rather than wire strings:
 * `'2026-01-01T00:00:00Z'` and `'2026-01-01T00:00:00.000+00:00'` are the same
 * instant and must compare equal, and a fractional part finer than a millisecond
 * is truncated rather than retained — the same trade-off `readDurationMs` makes.
 *
 * Accepted: a string matching {@link ISO_DATE_TIME_PATTERN} whose calendar fields
 * are all in range and whose instant is representable. Rejected: a non-string
 * (including epoch milliseconds supplied as a number — this feature's wire form
 * for an instant is a string, and accepting both would make the printer's output
 * ambiguous), a string of another shape, a value naming an impossible day such as
 * `2026-02-30`, an out-of-range offset, and an instant beyond
 * {@link MAX_INSTANT_MS}.
 *
 * Calendar fields are combined arithmetically rather than handed to the runtime's
 * lenient date parser, so a two-digit year is not silently shifted into the
 * twentieth century and a rolled-over field such as day 32 is rejected rather
 * than absorbed.
 *
 * Requirements: 13.1, 13.2
 */
export function readInstantMs(value: unknown, label: string): ParseResult<number> {
  if (typeof value !== 'string') {
    return fail(`${label} is not an instant`);
  }

  const match = ISO_DATE_TIME_PATTERN.exec(value);

  if (match === null) {
    return fail(`${label} is not an ISO 8601 instant with a UTC designator`);
  }

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    fractionText,
    offsetText,
  ] = match;

  // ISO 8601 has no negative zero year.
  if (yearText === '-000000') {
    return fail(`${label} names no year`);
  }

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = secondText === undefined ? 0 : Number(secondText);

  if (month < 1 || month > 12) {
    return fail(`${label} names no month`);
  }

  if (day < 1 || day > daysInMonth(year, month)) {
    return fail(`${label} names no day of its month`);
  }

  if (hour > 23 || minute > 59 || second > 59) {
    return fail(`${label} names no time of day`);
  }

  const millisecond =
    fractionText === undefined ? 0 : Number(`${fractionText}00`.slice(0, 3));

  const offsetMinutes = offsetMinutesFrom(offsetText);

  if (offsetMinutes === null) {
    return fail(`${label} names no UTC offset`);
  }

  // `setUTCFullYear` rather than `Date.UTC`, which maps years 0..99 to 1900..1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);

  const localMs = date.getTime();

  if (!Number.isFinite(localMs)) {
    return fail(`${label} names no representable instant`);
  }

  const instantMs = localMs - offsetMinutes * 60_000;

  if (!Number.isFinite(instantMs) || Math.abs(instantMs) > MAX_INSTANT_MS) {
    return fail(`${label} names no representable instant`);
  }

  return ok(instantMs);
}

/**
 * An instant in epoch milliseconds printed as ISO-8601 with an explicit `Z`, the
 * wire form {@link readInstantMs} accepts.
 *
 * Total and exception-free for every input. A value that is not a representable
 * whole-millisecond instant — a fraction, `NaN`, an infinity, a value beyond
 * {@link MAX_INSTANT_MS}, or a value that is not a number at all — prints as a
 * string the reader **rejects** rather than raising. Printing a fraction as the
 * instant it truncates to would be worse than failing: it would let a value that
 * cannot round-trip appear to (Requirement 13.7), hiding the mismatch instead of
 * surfacing it.
 *
 * Requirements: 13.1, 13.7
 */
export function printInstant(instantMs: number): string {
  if (
    typeof instantMs !== 'number' ||
    !Number.isInteger(instantMs) ||
    Math.abs(instantMs) > MAX_INSTANT_MS
  ) {
    return String(instantMs);
  }

  return new Date(instantMs).toISOString();
}

/**
 * The offset of a matched designator in whole minutes east of UTC: `0` for the
 * UTC designator, and `null` for an offset whose hour or minute field is out of
 * range.
 */
function offsetMinutesFrom(offsetText: string): number | null {
  if (offsetText === 'Z' || offsetText === 'z') {
    return 0;
  }

  const sign = offsetText.charAt(0) === '-' ? -1 : 1;
  const digits = offsetText.slice(1).replace(':', '');
  const offsetHour = Number(digits.slice(0, 2));
  const offsetMinute = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;

  if (offsetHour > 23 || offsetMinute > 59) {
    return null;
  }

  return sign * (offsetHour * 60 + offsetMinute);
}

/** The number of days in a month of the proleptic Gregorian calendar. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
