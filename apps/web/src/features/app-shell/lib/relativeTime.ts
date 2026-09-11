/**
 * The App_Shell's single pure relative time label.
 *
 * Every displayed Notification_Record carries a relative time label derived from
 * its creation instant and an **injected** current instant. Injecting the
 * current instant is the whole point: Requirement 5.11 asks for a pure function
 * so the label is deterministic and testable, which it cannot be if the function
 * reads the ambient clock itself. `Date.now()` is therefore never called here —
 * the caller supplies `nowMs`.
 *
 * The five bands Requirement 5.5 fixes, on the elapsed time `nowMs - createdAtMs`
 * after clamping (Requirement 5.11):
 *
 * | Elapsed time                | Label                                    |
 * | --------------------------- | ---------------------------------------- |
 * | below 60 seconds            | {@link JUST_NOW_LABEL}                   |
 * | 60 seconds to below 60 min  | whole minutes rounded down — `5 minutes ago` |
 * | 60 minutes to below 24 h    | whole hours rounded down — `3 hours ago`  |
 * | 24 hours to below 7 days    | whole days rounded down — `6 days ago`    |
 * | 7 days or above             | the calendar date — `12 Mar 2025`        |
 *
 * The bands are contiguous and each is closed at its lower bound, so an elapsed
 * time of exactly 60 seconds is `1 minute ago` rather than
 * {@link JUST_NOW_LABEL}, exactly 60 minutes is `1 hour ago`, exactly 24 hours
 * is `1 day ago`, and exactly 7 days is the calendar date. Every band below the
 * last rounds **down**, so 119 seconds is `1 minute ago`.
 *
 * A creation instant *after* the injected current instant is not an error and
 * not a "in 3 minutes" label: negative elapsed time clamps to zero, which lands
 * in the first band, so a future instant reads {@link JUST_NOW_LABEL} — the
 * label for the smallest supported elapsed interval, as Requirements 5.11 and
 * 14.11 require. Clock skew between a backend `createdAt` and the browser's
 * clock is common enough that this is the behaviour worth having.
 *
 * The calendar date is formatted from the instant's **UTC** components by hand
 * rather than through `toLocaleDateString`, because a locale- or
 * timezone-sensitive format would make the same two inputs produce different
 * labels on different machines, and Requirement 5.11 asks for a deterministic
 * label. That is a deliberate trade: a reader in a non-UTC timezone sees the UTC
 * calendar date. It only applies to notifications a week or more old, where the
 * date is a rough marker rather than something anyone reconciles to the hour.
 *
 * The function is **total**: every pair of inputs yields a non-empty label and
 * raises no exception (Requirement 14.11), including `NaN`, the infinities, and
 * an instant outside the range a date can represent. Those fold to
 * {@link JUST_NOW_LABEL} for the same reason a future instant does — no band can
 * be named from an elapsed time that is not a real number, and the smallest band
 * is the non-disclosing, non-empty answer.
 *
 * The fixed string {@link JUST_NOW_LABEL} is declared here rather than in
 * `lib/messages.ts` because it is one arm of this function's output, not a
 * shell-wide outcome message; it follows the same one-declaration,
 * one-user-facing-string convention that module establishes.
 *
 * This module is React-free and DOM-free like every module under `lib/`, and
 * imports nothing at all — in particular not `@pitchmate/api-client`
 * (Requirements 14.16, 15.5).
 *
 * Requirements: 5.5, 5.11, 14.11
 */

/** Milliseconds in one second. */
const MS_PER_SECOND = 1_000;

/** Milliseconds in one minute — the lower bound of the minutes band. */
const MS_PER_MINUTE = 60 * MS_PER_SECOND;

/** Milliseconds in one hour — the lower bound of the hours band. */
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

/** Milliseconds in one day — the lower bound of the days band. */
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Milliseconds in seven days — the lower bound of the calendar date band. */
const MS_PER_WEEK = 7 * MS_PER_DAY;

/**
 * The widest instant a date can represent, ±100,000,000 days from the epoch. An
 * instant outside this range has no calendar date, so the calendar date band
 * falls back rather than rendering an invalid one.
 */
const MAX_TIME_VALUE = 8_640_000_000_000_000;

/**
 * The label for the smallest supported elapsed interval: an elapsed time below
 * 60 seconds, a creation instant after the injected current instant, or a pair
 * of instants no band can be derived from (Requirements 5.5, 5.11, 14.11).
 */
export const JUST_NOW_LABEL = 'Just now';

/**
 * Abbreviated month names indexed by UTC month, used by the calendar date band.
 * Declared here rather than taken from a locale API so the same instant always
 * formats identically (Requirement 5.11).
 */
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Name a whole count of a unit as an elapsed-time label, singular for 1.
 *
 * @param count the whole units elapsed, already rounded down and 1 or greater
 * @param unit the singular unit name, pluralised with a trailing `s`
 */
function elapsedLabel(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

/**
 * Format an instant's UTC calendar date, or `null` where the instant is outside
 * the range a date can represent.
 *
 * @param instantMs the instant in milliseconds since the epoch, a finite number
 */
function utcCalendarDate(instantMs: number): string | null {
  if (Math.abs(instantMs) > MAX_TIME_VALUE) {
    return null;
  }

  const instant = new Date(instantMs);
  const day = instant.getUTCDate();
  const month = MONTH_NAMES[instant.getUTCMonth()];
  const year = instant.getUTCFullYear();

  return `${day} ${month} ${year}`;
}

/**
 * Derive a Notification_Record's relative time label from its creation instant
 * and an injected current instant.
 *
 * Deterministic and total: the same two inputs always yield the same non-empty
 * label, no input raises an exception, and the ambient clock is never read
 * (Requirements 5.11, 14.11).
 *
 * @param createdAtMs the Notification_Record's creation instant in milliseconds
 *   since the epoch
 * @param nowMs the injected current instant in milliseconds since the epoch
 * @returns the label for the band the clamped elapsed time falls in
 *
 * Requirements: 5.5, 5.11, 14.11
 */
export function relativeTimeLabel(createdAtMs: number, nowMs: number): string {
  const elapsed = nowMs - createdAtMs;

  // 14.11: an elapsed time that is not a real number — either instant `NaN` or
  // infinite, or two infinities of the same sign — names no band, so it takes
  // the smallest band like a future instant does. This runs before the band
  // comparisons because `NaN` compares false against every bound and would
  // otherwise fall through to the calendar date.
  if (!Number.isFinite(elapsed)) {
    return JUST_NOW_LABEL;
  }

  // 5.11: negative elapsed time clamps to zero, so a creation instant after the
  // injected current instant lands in the first band rather than reading as a
  // future time.
  const clamped = elapsed < 0 ? 0 : elapsed;

  // 5.5: below 60 seconds.
  if (clamped < MS_PER_MINUTE) {
    return JUST_NOW_LABEL;
  }

  // 5.5: 60 seconds to below 60 minutes, whole minutes rounded down.
  if (clamped < MS_PER_HOUR) {
    return elapsedLabel(Math.floor(clamped / MS_PER_MINUTE), 'minute');
  }

  // 5.5: 60 minutes to below 24 hours, whole hours rounded down.
  if (clamped < MS_PER_DAY) {
    return elapsedLabel(Math.floor(clamped / MS_PER_HOUR), 'hour');
  }

  // 5.5: 24 hours to below 7 days, whole days rounded down.
  if (clamped < MS_PER_WEEK) {
    return elapsedLabel(Math.floor(clamped / MS_PER_DAY), 'day');
  }

  // 5.5: 7 days or above, the calendar date of the creation instant. An instant
  // with no representable date falls back to the smallest band so the label is
  // still non-empty (Requirement 14.11).
  return utcCalendarDate(createdAtMs) ?? JUST_NOW_LABEL;
}
