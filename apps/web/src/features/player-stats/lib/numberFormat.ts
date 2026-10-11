/**
 * The feature's two numeric presentation functions: the Win_Percentage and the
 * whole-number count.
 *
 * Every figure the Player_Stats_Screen renders passes through one of these two
 * functions, and both answer the same question the same way — *what text does
 * this number read as?* — with no reference to React, the DOM, a clock, a
 * locale, or any ambient state:
 *
 * | Function | Input | Output |
 * | --- | --- | --- |
 * | {@link formatWinPercentage} | a percentage in the closed range 0.0 to 100.0 | text with exactly one decimal place and a percentage indication |
 * | {@link formatCount} | a whole number | its digits, exactly as parsed |
 *
 * ## No locale-dependent formatter
 *
 * Neither function invokes `toLocaleString`, `Intl.NumberFormat`, or anything
 * else whose output depends on the runtime's ICU data or the ambient locale.
 * `Intl` would render the same percentage as `'66.7%'` in one locale and
 * `'66,7 %'` in another, and would introduce a grouping separator into a count
 * of a thousand appearances — so the text a person reads, and the text a test
 * asserts, would depend on where the code ran rather than on the number. Both
 * functions here are determined **solely by their argument** (Requirements 6.5,
 * 10.4): `toFixed` and `String` are specified operations on the number value,
 * free of locale input and of grouping separators. This is the same rule
 * `lib/instantFormat.ts` follows for instants and `formatDuration` follows for
 * the Keeper_Time.
 *
 * ## The percentage sign belongs here
 *
 * Requirements 6.3 and 10.4 both ask for an *explicit percentage indication*
 * alongside the one decimal place. That indication is part of reading the number
 * rather than a sentence about it, so it is produced here, once, rather than
 * appended by each of the two call sites — the Record_Panel and the paired-stat
 * entries of the Pairwise_Sections — where it could drift apart or be forgotten.
 * The prose of the feature lives in `lib/messages.ts`; `'%'` is notation.
 *
 * ## Why the percentage can decline to format and the count cannot
 *
 * `formatWinPercentage` returns `null` for an input it cannot present, because
 * there is something sensible for the caller to do with that answer: render the
 * `NO_WIN_PERCENTAGE` statement, which is exactly what Requirement 6.4 asks for
 * when a profile carries no percentage at all. One absence, one presentation,
 * decided in one place.
 *
 * `formatCount` has no such arm. A count is never optional on the wire — the
 * four Player_Record counts, both streaks, the Bib_Appearance_Count, a
 * Co_Appearance_Entry's count, a Paired_Stat_Entry's qualifying matches, and the
 * three numeric Rich_Stats members are all required members read through
 * `readCount` — so there is no "no count" condition for a caller to branch on,
 * and inventing one would invite a fallback where the requirement says to render
 * the number exactly as parsed (Requirement 6.1).
 *
 * React-free and DOM-free like every module under `lib/` (Requirement 14.3),
 * importing nothing at all. Both functions are total over every input of every
 * type, coerce nothing, and raise nothing.
 *
 * Requirements: 6.1, 6.3, 6.5, 10.4
 */

/** The least Win_Percentage the backend can send. */
const MIN_PERCENTAGE = 0;

/** The greatest Win_Percentage the backend can send. */
const MAX_PERCENTAGE = 100;

/** The number of decimal places a Win_Percentage is presented with. */
const PERCENTAGE_DECIMAL_PLACES = 1;

/** The explicit percentage indication Requirements 6.3 and 10.4 call for. */
const PERCENTAGE_SIGN = '%';

/**
 * A Win_Percentage as the text a person reads: `'66.7%'`, `'0.0%'`, `'100.0%'`.
 *
 * Yields text with **exactly one decimal place** — never none, never two — for
 * every finite number in the closed range 0.0 to 100.0, which is precisely the
 * range `readPercentage` accepts, so every percentage that reached the screen
 * formats. The decimal place is not decoration: `'50%'` and `'50.0%'` claim
 * different precisions, and a column of percentages where some carry a decimal
 * and some do not is harder to compare than one where they all do. A value whose
 * first decimal is zero therefore still shows it, and both endpoints format
 * (`'0.0%'`, `'100.0%'`).
 *
 * Yields `null` — no text, not a placeholder figure — for every other input: a
 * value below 0 or above 100, `NaN`, either infinity, and anything that is not a
 * number at all. The caller renders `NO_WIN_PERCENTAGE` in that case
 * (Requirement 6.4), which is also the presentation for a profile that carries
 * no percentage, so an out-of-range figure and an absent one are indistinguishable
 * on screen. Nothing is clamped and nothing is rounded into range: `100.1` is a
 * number no backend sends, and presenting it as `'100.0%'` would turn a fault
 * into a figure that looks earned.
 *
 * Negative zero formats as `'0.0%'` rather than `'-0.0%'`. It is a value a
 * percentage computation can produce and one nobody should ever be shown; it is
 * normalised to positive zero before formatting rather than special-cased
 * afterwards.
 *
 * Total over every input of every type and free of exceptions: a `typeof` test,
 * two comparisons, and `toFixed` on a value already known to be a finite number
 * in range. Nothing is coerced, so a hostile `toString` or `valueOf` never runs.
 *
 * Requirements: 6.3, 6.5, 10.4
 */
export function formatWinPercentage(value: number): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  if (value < MIN_PERCENTAGE || value > MAX_PERCENTAGE) {
    return null;
  }

  // `-0` is in range and would print its sign; it is the same percentage as `0`.
  const normalised = value === 0 ? 0 : value;

  return `${normalised.toFixed(PERCENTAGE_DECIMAL_PLACES)}${PERCENTAGE_SIGN}`;
}

/**
 * A whole number as the text a person reads: `'0'`, `'7'`, `'1234'`.
 *
 * The digits of the argument and nothing else — no grouping separator, no unit,
 * no sign for zero, no rounding, no clamping, and no abbreviation of a large
 * figure. Requirement 6.1 asks that each count render *exactly as parsed*, and
 * `String` is that rendering: every count the screen holds came from `readCount`
 * and is already a non-negative whole number, so there is nothing to repair and
 * repairing it here would only hide a reader that let something else through.
 *
 * Total over every input of every type and free of exceptions. A value that is
 * not a non-negative whole number renders as whatever `String` makes of it —
 * `'NaN'`, `'-1'`, `'1.5'`, `'Infinity'` — which is deliberate: such a value
 * cannot arrive through the Response_Parser, and a figure that is visibly wrong
 * on screen is a better outcome than one quietly turned into a plausible zero.
 * Negative zero renders as `'0'`, which `String` already does.
 *
 * Requirements: 6.1, 9.1, 9.4, 10.3, 10.4, 11.3
 */
export function formatCount(value: number): string {
  return String(value);
}
