/**
 * The feature's one instant presentation function.
 *
 * A Progression_Point carries a match-completion instant, normalised to epoch
 * milliseconds on read by `readInstantMs`. The Progression_Table labels each row
 * with that instant, and {@link formatInstantDate} is the only place the feature
 * turns one into text.
 *
 * ## No locale-dependent formatter
 *
 * The date is assembled from **UTC calendar fields** and a **literal month-name
 * table** below. `toLocaleDateString`, `toLocaleString`, and `Intl` are not
 * invoked — not as a fallback, not for a single field — because their output
 * depends on the runtime's ICU data and on the ambient locale: the same instant
 * reads as `'01/02/2026'` in one locale, `'2026/2/1'` in another, and in a
 * trimmed-ICU Node build as something else again. The text a person reads, and
 * the text a test asserts, would then depend on where the code ran rather than
 * on the instant. Requirement 8.9 asks for a form determined **solely** by the
 * parsed instant, and a fixed `D MMM YYYY` form delivers it. This is the same
 * rule `lib/numberFormat.ts` follows for figures and `formatDuration` follows
 * for the Keeper_Time.
 *
 * ## UTC, not the viewer's zone
 *
 * The calendar fields are read in UTC rather than in the runtime's zone, so an
 * instant late on one day in London and early the next day in Auckland formats
 * as one date rather than two. A zone-local date would make the Progression_Table
 * read differently for two members of the same squad, and would make the
 * determinism property untestable without pinning `process.env.TZ`. The
 * trade-off is accepted and deliberate: a match completed at 23:30 UTC+13 labels
 * with its UTC date.
 *
 * The month table is English and unlocalised, which matches the rest of the
 * feature's text in `lib/messages.ts`. Translating the screen is a later concern,
 * and when it arrives the month names move with the prose rather than into
 * `Intl`.
 *
 * React-free and DOM-free like every module under `lib/` (Requirement 14.3). It
 * imports only the representable-instant bound from the parse layer, coerces
 * nothing, reads no clock and no locale, and raises nothing for any input.
 *
 * Requirements: 8.9
 */

import { MAX_INSTANT_MS } from './parse/primitives';

/**
 * The abbreviated month names, indexed by month number less one — the literal
 * table that stands in for a locale-dependent formatter.
 *
 * Three letters rather than the full name, because the Progression_Table has one
 * row per completed match and `'1 Feb 2026'` stays legible in a narrow column
 * where `'1 February 2026'` would wrap. Three letters are also unambiguous in a
 * way a numeric month is not: `'02/01/2026'` is two different days depending on
 * the reader, and `'1 Feb 2026'` is one.
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
 * The text an instant outside the representable range formats as.
 *
 * It states an absence rather than asserting a date, which is the whole point: a
 * value this function cannot place on a calendar must not be presented as the
 * epoch, as today, or as an empty cell that reads like a missing row. The phrase
 * is declared here rather than in `lib/messages.ts` because it is a formatter
 * fallback rather than prose the screen composes, the same way `formatDuration`
 * declares its `'0m'`.
 */
const UNREPRESENTABLE_INSTANT = 'Unknown date';

/**
 * An instant in epoch milliseconds as the text a person reads: `'1 Feb 2026'`,
 * `'25 Dec 2025'`.
 *
 * The form is fixed — day without leading zero, three-letter month, four-digit
 * year, single spaces — and is determined solely by the argument
 * (Requirement 8.9), so the same Progression_Series renders identically on two
 * loads, in two browsers, in CI, and in jsdom. The day carries no padding
 * because the month name already aligns the field visually and `'01 Feb 2026'`
 * reads as a form entry rather than a date.
 *
 * **Total over every number, and raises nothing.** A value that is not a finite
 * number within {@link MAX_INSTANT_MS} — `NaN`, either infinity, a value beyond
 * the bound, or a value that is not a number at all — formats as
 * {@link UNREPRESENTABLE_INSTANT}. That fallback is unreachable through the
 * screen, because every instant the feature holds came from `readInstantMs` and
 * is a representable whole number; it exists so that this function has one answer
 * for every input rather than a condition the caller must check first, and so
 * that a fuzzed or hand-built progression cannot take the table down.
 *
 * A fractional millisecond count truncates toward zero, which is what the date
 * value does with it and the same trade-off `readInstantMs` makes with a
 * sub-millisecond fraction. A year outside the four-digit range formats with the
 * digits it has (`'1 Jan -5'`); it is an instant no match carries, and showing
 * its year is more honest than hiding it behind the absence text.
 *
 * Requirements: 8.9
 */
export function formatInstantDate(instantMs: number): string {
  if (
    typeof instantMs !== 'number' ||
    !Number.isFinite(instantMs) ||
    Math.abs(instantMs) > MAX_INSTANT_MS
  ) {
    return UNREPRESENTABLE_INSTANT;
  }

  const date = new Date(instantMs);
  const monthName = MONTH_NAMES[date.getUTCMonth()];

  // Unreachable: a representable instant always has a month in 0..11. The test
  // keeps the function total under `noUncheckedIndexedAccess` without asserting.
  if (monthName === undefined) {
    return UNREPRESENTABLE_INSTANT;
  }

  return `${String(date.getUTCDate())} ${monthName} ${String(date.getUTCFullYear())}`;
}
