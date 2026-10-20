/**
 * The reading primitives every feature's Response_Parser is built from.
 *
 * The generated client pins the *shape* the contract declares at compile time,
 * but nothing checks at runtime that the body which arrived is that shape.
 * Turning an unknown body into a typed value is the job of one parser per body
 * shape, in each feature's `lib/parse/`, and every field a parser reads goes
 * through a reader declared here. Declaring them once, for every feature, is what
 * makes these four rules hold uniformly rather than per parser:
 *
 *  - **Total.** Every reader yields exactly one of `{ ok: true, value }` and
 *    `{ ok: false, reason }` for every input of every type — absent, `null`, a
 *    primitive, an array, an object nested a hundred levels deep — and raises
 *    nothing. There is no third outcome and no partially populated value.
 *  - **All or nothing.** A reader either yields a fully valid reading or a
 *    failure; it never defaults, repairs, truncates, coerces, rounds, or clamps.
 *    A parser therefore builds its result *last*, from readings it has already
 *    checked, and one bad field fails the body carrying it rather than producing
 *    a value with that field defaulted or dropped.
 *  - **Additive-change tolerant.** A reader only ever looks at a value a parser
 *    hands it, so a property no parser names is never read at all — a stronger
 *    guarantee than discarding it afterwards: an unrecognised property cannot
 *    fail a parse, cannot slow one, and cannot reach a rendered value. It is also
 *    how a parsed type graph stays free of rating internals: `mu` and `sigma` are
 *    not filtered out, they are never named.
 *  - **Pure.** This module is React-free and DOM-free, imports no
 *    `@pitchmate/api-client` and no feature module, and reads no clock, locale,
 *    storage, or global. It imports nothing at all.
 *
 * Feature-specific readers (player-stats' duration reader, for one) stay in the
 * feature, which re-exports this module beside them from its own
 * `lib/parse/primitives.ts` so its parsers take every reader from one place.
 *
 * ## Iterative by construction, never recursive
 *
 * No reader here walks the interior of an unknown value. {@link readObject}
 * establishes that a value is a plain object and {@link readArray} that it is an
 * array; neither looks inside. Depth is therefore paid for only where a parser
 * deliberately descends one level, and a body nested a hundred (or a hundred
 * thousand) levels deep costs a single type test rather than a stack frame per
 * level.
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
 * declared in this module, and it never embeds the value that was read. A display
 * name, an identity, an invite secret, or a backend `detail` string embedded in a
 * reason could travel into a log or a rendered outcome, and existence
 * concealment depends on a person not learning from the screen whether a
 * resource exists. A person is shown the feature's single generic failure
 * message; a reason exists so a failing test says which field was wrong.
 */

/* -------------------------------------------------------------------------- */
/* The result shape                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The outcome of reading a value: a fully populated reading, or a failure
 * carrying a diagnostic reason. There is no third shape and no partial value.
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

/** A successful reading. */
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
 * Accepted: an array, empty included — an empty list is an ordinary reading,
 * not a failure. Rejected: `undefined`, `null`, an array-like object, and every
 * primitive. The elements are **not** inspected — the caller reads each one with
 * the reader its shape requires, which is what keeps element failure a decision
 * of the calling parser (a bad element fails the body it belongs to) rather than
 * a rule baked in here.
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
 * carrying it — or, for a declared-optional member, into the same absence a
 * `null` yields.
 *
 * An unrecognised property is never passed to this function at all — a parser
 * names the properties it wants — so additive-change tolerance holds by omission
 * rather than by filtering.
 *
 * @param source an object established by {@link readObject}
 * @param key the property name, a literal in the calling parser
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
 * backend serialises a number and accepting it would let a mistyped field parse —
 * along with `NaN` and either infinity, neither of which JSON can carry.
 *
 * Negative zero is accepted and preserved; it is the same number as zero for
 * every comparison a feature makes of a wire value.
 *
 * A reading is not constrained here beyond finiteness. A field whose range the
 * contract narrows is read through one of the narrower readers built on this one
 * ({@link readCount}, {@link readPercentage}), and no enum-valued field reaches
 * this reader at all: every wire enum arrives as a member name and is read
 * through {@link readWireEnumName}.
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
 * screen's behaviour on a value nobody supplied.
 */
export function readBoolean(value: unknown, label: string): ParseResult<boolean> {
  if (typeof value !== 'boolean') {
    return fail(`${label} is not a boolean`);
  }

  return ok(value);
}

/** The length of an identity in its 36-character hyphenated form. */
const UUID_LENGTH = 36;

/**
 * An identity in the 36-character hyphenated form, any letter case. The
 * unhyphenated, braced, and whitespace-padded variants are rejected: the backend
 * emits only this form, so any other is a fault rather than a variant to accept.
 */
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * A value read as an identity in the 36-character hyphenated form.
 *
 * Accepts exactly what each feature's own `lib/identifiers.ts` predicate accepts,
 * so a route's identity check and a parser's identity reading cannot disagree.
 * Letter case is preserved, because an identity is opaque to the web client — it
 * is forwarded, never interpreted.
 */
export function readUuid(value: unknown, label: string): ParseResult<string> {
  if (
    typeof value !== 'string' ||
    value.length !== UUID_LENGTH ||
    !UUID_PATTERN.test(value)
  ) {
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
 * Accepted: a finite `number` that is a whole number and is not negative. `0` is
 * a reading like any other, and `-0` is accepted as the zero it is.
 *
 * Rejected, and **nothing is rounded or clamped** to make it pass: a fraction
 * (`2.5`, `-0.5`), a negative (`-1`), `NaN`, either infinity, and a
 * string-encoded count (`'12'`), along with every other non-number. A rounded
 * count is the worst available outcome: `2.5` appearances would render as a
 * confident `3`, and a clamped `-1` as a confident `0`, each presenting a backend
 * fault as a figure a person would believe. Failing the body surfaces the fault
 * instead.
 *
 * Wholeness is tested with `Number.isInteger` rather than `Number.isSafeInteger`,
 * because the rule is "non-negative whole number" and a count beyond the exactly
 * representable range is still the whole number it says it is.
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
 * Accepted: every finite number from `0` to `100` inclusive; `-0` is accepted as
 * the zero it is. A fractional percentage is expected, not merely tolerated: a
 * 1-in-3 record is `33.333…`, and rounding belongs to presentation.
 *
 * Rejected, with **no clamping**: a value below the range (`-0.1`), a value above
 * it (`100.1`), `NaN`, either infinity, a string-encoded percentage (`'50'`), and
 * every other non-number. Clamping `100.1` to `100` would render a perfect record
 * for a membership that has lost matches; failing the body says so instead.
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

/* -------------------------------------------------------------------------- */
/* Wire enum names                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A membership test over one wire enum's names — the shape of every predicate a
 * feature's `lib/wireEnums.ts` exports.
 *
 * Declared structurally rather than imported, so this module stays unaware of
 * which enums exist: the reader below is the same reader for all of them, and
 * the vocabulary it enforces is the predicate's, which is in turn pinned to the
 * generated union at compile time.
 */
export type WireEnumNamePredicate<TName extends string> = (
  candidate: unknown,
) => candidate is TName;

/**
 * A value read as a member name of one wire enum, validated against the
 * generated vocabulary that `isName` tests.
 *
 * Accepted: exactly the names the predicate admits, returned unchanged. Rejected:
 * every other value — a string outside the union (a name in the wrong case
 * included), a number (including the code a previous contract sent for the same
 * field), a boolean, `null`, absent, an array, an object, a boxed string. Nothing
 * is coerced, case-folded, or defaulted.
 *
 * Reading **by name** rather than by code is what removes a whole class of silent
 * error: a code would depend on a hand-maintained table agreeing with the
 * backend's declaration order, and a table that disagreed would map a field to
 * the wrong *valid* member rather than failing. A name either is in the
 * generated union or is not.
 *
 * Total over every input and free of exceptions. The predicate compares the
 * candidate against a fixed list of strings with `===`, so the value is never
 * converted and a hostile `toString` or `valueOf` never runs.
 *
 * An absence is not this reader's business: a parser wraps it in
 * {@link readOptional} for a declared-optional field, which leaves the tolerance
 * a decision of each field rather than a rule baked in here.
 *
 * @param isName a membership predicate from the feature's `lib/wireEnums.ts`
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
 * `null` and an absent property are **the same absence** and both yield `null`:
 * the distinction a JSON body can express between "sent as null" and "not sent"
 * carries no meaning for a declared-optional field.
 *
 * Any other value is handed to `reader`, so a *present but malformed* optional
 * field fails rather than quietly reading as an absence. That asymmetry is the
 * point: an optional field is optional, not unvalidated.
 *
 * @param reader the reader for a present value; any reader of this module, or a
 *   lambda closing over one that needs bounds
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
 * Normalising to milliseconds on read is why round-trip properties compare
 * instants rather than wire strings: `'2026-01-01T00:00:00Z'` and
 * `'2026-01-01T00:00:00.000+00:00'` are the same instant and must compare equal,
 * and a fractional part finer than a millisecond is truncated rather than
 * retained.
 *
 * Accepted: a string matching {@link ISO_DATE_TIME_PATTERN} whose calendar fields
 * are all in range and whose instant is representable. Rejected: a non-string
 * (including epoch milliseconds supplied as a number — the wire form for an
 * instant is a string, and accepting both would make the printer's output
 * ambiguous), a string of another shape, a value naming an impossible day such as
 * `2026-02-30`, an out-of-range offset, and an instant beyond
 * {@link MAX_INSTANT_MS}.
 *
 * Calendar fields are combined arithmetically rather than handed to the runtime's
 * lenient date parser, so a two-digit year is not silently shifted into the
 * twentieth century and a rolled-over field such as day 32 is rejected rather
 * than absorbed.
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
 * instant it truncates to would let a value that cannot round-trip appear to,
 * hiding the mismatch instead of surfacing it.
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
