/**
 * The Keeper_Time duration: its reader, its printer, and its presentation
 * formatter.
 *
 * Keeper_Time is the one duration this feature carries. It arrives on the
 * Rich_Stats block in the .NET `TimeSpan` wire form — `[-][d.]hh:mm:ss[.fffffff]`
 * — and it is rendered as a short human form (`'1h 05m'`). Three functions
 * cover the whole journey, and this module is their only declaration:
 *
 * | Function | Direction | Totality |
 * | --- | --- | --- |
 * | {@link readDurationMs} | wire string to milliseconds | total; yields a failure rather than raising |
 * | {@link printDuration} | milliseconds to the canonical wire form | total; a value it cannot represent prints as a string the reader rejects |
 * | {@link formatDuration} | milliseconds to presentation text | total over **every** number; always returns a string |
 *
 * ## Milliseconds, not strings
 *
 * A duration normalises to milliseconds **on read**, exactly as an instant does
 * in `lib/parse/primitives.ts`. Two consequences, both deliberate:
 *
 *  - `'00:45:00'` and `'0.00:45:00.0000000'` are the same duration and compare
 *    equal, so the round-trip property (Property 25) compares milliseconds
 *    rather than wire text. The printer emits one canonical form rather than
 *    attempting to reproduce whichever accepted form it was given.
 *  - The wire's seven-digit fraction counts 100-nanosecond ticks, which is finer
 *    than a millisecond. The sub-millisecond remainder is **truncated** on read,
 *    the same trade-off `readInstantMs` already makes. Keeper_Time is a sum of
 *    stint lengths measured in match minutes; nothing this feature presents can
 *    observe a tick.
 *
 * ## The reader rejects a number of milliseconds
 *
 * `readDurationMs` accepts the string form and nothing else — a `number` is
 * rejected even though it is the very unit the reader produces. Accepting both
 * would make {@link printDuration}'s output ambiguous: a round trip could no
 * longer tell a duration that was transmitted from one that was computed, and a
 * field mistyped as a number on the backend would parse instead of failing.
 * This is the rule `readInstantMs` states for instants, applied to the one other
 * normalising reader the feature has.
 *
 * ## Why the result shape is declared here
 *
 * `lib/parse/primitives.ts` is the canonical home of `ParseResult` and
 * `ValueReader`, and it takes its `readDurationMs` seam **from this module** —
 * so this module cannot import from it without a cycle. The two declarations
 * below are therefore a deliberate local mirror of that shape: identical by
 * construction, structurally interchangeable with the primitives' pair, and
 * narrow enough (a two-arm union and a function type) that drift would fail the
 * compiler at the primitives' re-export rather than at runtime.
 *
 * React-free and DOM-free like every module under `lib/`. It imports nothing at
 * all, coerces nothing, reads no clock, locale, or global, and raises no
 * exception for any input of any type.
 *
 * Requirements: 11.5, 13.10
 */

/* -------------------------------------------------------------------------- */
/* The result shape                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The outcome of reading a value: a fully populated reading, or a failure
 * carrying a diagnostic reason. There is no third shape and no partial value.
 *
 * A local mirror of the shape `lib/parse/primitives.ts` declares — see the
 * module note on why this module declares it rather than importing it.
 */
export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/**
 * A reader of one unknown value, labelled for its failure reason.
 *
 * A local mirror of the shape `lib/parse/primitives.ts` declares.
 */
export type ValueReader<T> = (value: unknown, label: string) => ParseResult<T>;

/* -------------------------------------------------------------------------- */
/* Bounds and the accepted form                                               */
/* -------------------------------------------------------------------------- */

/** Milliseconds in one second, minute, hour, and day. */
const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * The greatest duration this module reads and prints, in milliseconds.
 *
 * The bound is the largest exactly representable whole number rather than a
 * calendar figure, because beyond it a millisecond count stops being exact and a
 * round trip stops being meaningful. The backend's own ceiling is far below it:
 * .NET's `TimeSpan.MaxValue` is a little over 922 billion seconds, some four
 * orders of magnitude short of this, so no transmitted duration can approach the
 * bound. It exists so that a hand-written or fuzzed wire string carrying a
 * hundred days' worth of digits fails cleanly instead of reading as an
 * imprecise number.
 */
export const MAX_DURATION_MS = Number.MAX_SAFE_INTEGER;

/**
 * The .NET `TimeSpan` constant ("c") form, without its sign.
 *
 * Accepted: an optional day field of one or more digits followed by `.`, then
 * exactly two digits each of hours, minutes, and seconds, then an optional
 * fractional part of one to seven digits introduced by `.`. Anchored at both
 * ends; neither global nor sticky, so it carries no `lastIndex` state between
 * calls.
 *
 * The leading `-` of the negative form is **not** in the pattern, which is what
 * makes rejecting it structural rather than a check that could be forgotten;
 * {@link readDurationMs} tests for it first only to give the failure a more
 * useful reason than "not of the transmitted form".
 *
 * The day field is unbounded in digits rather than capped at .NET's eight,
 * because the bound that matters is {@link MAX_DURATION_MS} and it is applied to
 * the assembled total below. A day field of a hundred digits assembles to a
 * non-finite total and fails there.
 */
const TIMESPAN_PATTERN =
  /^(?:(\d+)\.)?(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?$/;

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A value read as a duration in milliseconds.
 *
 * Accepted: a string of the form {@link TIMESPAN_PATTERN} describes, whose hours
 * are 0 to 23, minutes 0 to 59, and seconds 0 to 59, and whose assembled total
 * is a whole number of milliseconds within {@link MAX_DURATION_MS}. A day-less
 * and a day-bearing spelling of the same duration read to the same number.
 *
 * Rejected:
 *
 *  - the **negative** form (`'-00:45:00'`). A negative Keeper_Time is not a
 *    duration a person has spent in goal, and silently reading it as its
 *    magnitude or as zero would turn a backend fault into a plausible figure.
 *  - **every other string shape** — `'45'`, `'45m'`, `'0:45:00'` with a
 *    single-digit hour, `'00:45'` with no seconds, an eight-digit fraction, a
 *    whitespace-padded value, an ISO-8601 duration such as `'PT45M'`.
 *  - an **out-of-range field**: `'25:00:00'`, `'00:60:00'`, `'00:00:60'`. The
 *    constant form carries an overflowing hour as a day, so 25 hours is
 *    `'1.01:00:00'`; a two-digit hour above 23 is a value no serialiser emits.
 *  - **every non-string**: a number of milliseconds (see the module note), a
 *    boolean, `null`, absent, an array, an object, a boxed string.
 *
 * Nothing is coerced, repaired, trimmed, clamped, or rounded, so a hostile
 * `toString` or `valueOf` never runs and a duration nobody sent never reaches a
 * rendered figure. Total over every input of every type, and free of exceptions:
 * the fields are matched by one anchored pattern over a string of bounded length
 * and combined arithmetically, with no loop and no recursion.
 *
 * Requirements: 11.5, 13.10
 */
export const readDurationMs: ValueReader<number> = (value, label) => {
  if (typeof value !== 'string') {
    return { ok: false, reason: `${label} is not a duration` };
  }

  if (value.startsWith('-')) {
    return { ok: false, reason: `${label} is a negative duration` };
  }

  const match = TIMESPAN_PATTERN.exec(value);

  if (match === null) {
    return {
      ok: false,
      reason: `${label} is not a duration of the transmitted form`,
    };
  }

  const [, dayText, hourText, minuteText, secondText, fractionText] = match;

  const days = dayText === undefined ? 0 : Number(dayText);
  const hours = Number(hourText);
  const minutes = Number(minuteText);
  const seconds = Number(secondText);

  if (hours > 23 || minutes > 59 || seconds > 59) {
    return { ok: false, reason: `${label} names no duration of its form` };
  }

  // The wire fraction counts 100-nanosecond ticks; its first three digits are
  // the milliseconds and the remainder is truncated (see the module note).
  const milliseconds =
    fractionText === undefined ? 0 : Number(`${fractionText}00`.slice(0, 3));

  const totalMs =
    days * MS_PER_DAY +
    hours * MS_PER_HOUR +
    minutes * MS_PER_MINUTE +
    seconds * MS_PER_SECOND +
    milliseconds;

  if (!Number.isSafeInteger(totalMs) || totalMs > MAX_DURATION_MS) {
    return { ok: false, reason: `${label} names no representable duration` };
  }

  return { ok: true, value: totalMs };
};

/* -------------------------------------------------------------------------- */
/* Printing                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A duration in milliseconds printed in the canonical wire form
 * {@link readDurationMs} accepts: `[d.]hh:mm:ss[.fffffff]`.
 *
 * The canonical form is .NET's own: the day field appears exactly when the
 * duration reaches a day, the hour, minute, and second fields are always two
 * digits, and the seven-digit fraction appears exactly when the duration carries
 * a sub-second part — `0` prints as `'00:00:00'`, 45 minutes as `'00:45:00'`,
 * and 1.5 seconds as `'00:00:01.5000000'`. The fraction is not optional
 * decoration: without it a printed duration would lose its milliseconds and the
 * round trip would hold only for whole seconds.
 *
 * Total and exception-free for every input. A value that is not a non-negative
 * whole number of milliseconds within {@link MAX_DURATION_MS} — a fraction, a
 * negative, `NaN`, an infinity, or a value that is not a number at all — prints
 * as a string the reader **rejects** rather than raising. Printing such a value
 * as the duration it truncates or clamps to would be worse than failing: it
 * would let a value that cannot round-trip appear to, hiding the mismatch
 * instead of surfacing it. This is the rule `printInstant` states for instants.
 *
 * Requirements: 11.5
 */
export function printDuration(ms: number): string {
  if (
    typeof ms !== 'number' ||
    !Number.isSafeInteger(ms) ||
    ms < 0 ||
    ms > MAX_DURATION_MS
  ) {
    return String(ms);
  }

  const days = Math.floor(ms / MS_PER_DAY);
  const hours = Math.floor((ms % MS_PER_DAY) / MS_PER_HOUR);
  const minutes = Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE);
  const seconds = Math.floor((ms % MS_PER_MINUTE) / MS_PER_SECOND);
  const milliseconds = ms % MS_PER_SECOND;

  const dayPart = days === 0 ? '' : `${String(days)}.`;
  const clock = `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
  // Ticks, so a millisecond is 10 000 of them and the fraction is seven digits.
  const fractionPart =
    milliseconds === 0
      ? ''
      : `.${String(milliseconds * 10_000).padStart(7, '0')}`;

  return `${dayPart}${clock}${fractionPart}`;
}

/* -------------------------------------------------------------------------- */
/* Presentation                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A duration in milliseconds as the text a person reads: `'1h 05m'`, `'45m'`,
 * `'0m'`.
 *
 * The form is determined **solely** by the argument (Requirement 11.5): hours
 * appear exactly when the duration reaches one, in which case the minutes are
 * padded to two digits so a column of durations stays aligned; below an hour the
 * minutes carry no padding. Seconds are not presented — Keeper_Time is a sum of
 * stint lengths over hour-long matches, and a figure to the second would imply a
 * precision the stint records do not have. There is no day unit either: two days
 * in goal reads as `'48h 00m'`, which is a stranger number to see than
 * `'2d 00h'` and a far less likely one.
 *
 * No locale-dependent formatter and no grouping separator, so the digits do not
 * depend on the runtime's ICU data or the ambient locale and the text is the
 * same in a browser, in CI, and in jsdom.
 *
 * **Total over every number, and raises nothing.** Every value that is not a
 * positive finite duration — `0`, a negative, a fraction below a minute, `NaN`,
 * either infinity — formats as `'0m'`. That fallback is unreachable through the
 * screen, because the only duration the feature holds came from
 * {@link readDurationMs} and is a non-negative finite number; it exists so that
 * this function has one answer for every input rather than a condition the
 * caller must check first. A fractional millisecond count truncates downward,
 * for the same reason the reader truncates ticks.
 *
 * Requirements: 11.5
 */
export function formatDuration(ms: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < MS_PER_MINUTE) {
    return '0m';
  }

  const totalMinutes = Math.floor(ms / MS_PER_MINUTE);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${String(minutes)}m`;
  }

  return `${String(hours)}h ${pad2(minutes)}m`;
}

/** A whole number padded to at least two digits. */
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
