/**
 * The Progression_Series derivation: the ordering half of Requirement 8.1.
 *
 * The parsed `PlayerProfile` carries its progression in whatever order the
 * backend sent it. Requirement 8.1 asks for the series the chart and the
 * Progression_Table read to be derived by a **pure function** — no React, no DOM
 * — retaining exactly the records that carry a Display_Rating, in ascending
 * order of completion instant, with a **deterministic tie-break**. This module is
 * that function.
 *
 * ## Retention is already settled by the parser
 *
 * {@link ProgressionPoint.displayRating} is non-nullable: a wire record without
 * one is a record with nothing to plot, and `parseProgressionPoint` accepts the
 * body while contributing no point, so `profile.progression` already holds
 * exactly the plottable points. Nothing here filters, therefore — not as a
 * defensive pass, because there is no representable point to filter out. The
 * retention clause of 8.1 is met by the type, and this module owns only the
 * order.
 *
 * ## Why the tie-break matters
 *
 * Two matches can complete in the same millisecond — a backfilled squad, a
 * fixture set, two rows written in one transaction — and `Array.prototype.sort`
 * is only specified to be stable with respect to the *input* order, which is the
 * backend's row order and is not itself guaranteed. A comparator that answered
 * `0` for two points sharing an instant would therefore leave the drawn line
 * depending on the order the rows happened to arrive in, and Requirement 8.9's
 * "the same Progression_Series renders identically on two loads" would hold only
 * by luck.
 *
 * So the comparator is a **total order**: completion instant ascending, then
 * Display_Rating ascending. Two points compare equal only when **both** fields
 * match, and at that point they are indistinguishable — a `ProgressionPoint` has
 * no third field, so swapping them cannot change a coordinate, a table row, or a
 * pixel. The series is consequently a function of the input *set* rather than of
 * its arrival order, which is the property the chart's determinism rests on and
 * what Property 19 asserts.
 *
 * ## No input is reordered
 *
 * `toProgressionSeries` copies before sorting. `sort` mutates in place, and the
 * array handed in belongs to the parsed profile — a value held in component
 * state and read by every other panel. Sorting it in place would make the
 * derivation a side effect on a shared, nominally-readonly structure, and would
 * make "the same profile renders the same screen" depend on how many times the
 * derivation had run.
 *
 * React-free and DOM-free like every module under `lib/` (Requirement 14.3): it
 * imports one type, reads no clock, locale, storage, or global, and raises
 * nothing for any input.
 *
 * Requirements: 8.1
 */

import type { ProgressionPoint } from './parse/playerProfile';

/**
 * Two Progression_Points in the series' order: completion instant ascending,
 * then Display_Rating ascending (Requirement 8.1).
 *
 * A **total** order. Every pair of points compares as one of `-1`, `0`, or `1`,
 * and `0` only when both fields match — so the ordering never defers to the
 * arrival order of the collection it came from.
 *
 * Pure and total over any two points, including ones carrying values no parsed
 * profile holds. Were a field `NaN`, no comparison against it would be true and
 * the pair would compare equal rather than raising or producing an inconsistent
 * answer; `readInstantMs` and `readNumber` admit no such value, so this is a
 * totality guarantee rather than a case the screen reaches.
 *
 * @param left the point being placed
 * @param right the point it is placed against
 * @returns `-1` where `left` sorts first, `1` where `right` does, `0` where the
 *   two are indistinguishable
 *
 * Requirements: 8.1
 */
export function compareProgressionPoints(
  left: ProgressionPoint,
  right: ProgressionPoint,
): -1 | 0 | 1 {
  // Primary key: when the match completed.
  if (left.completedAtMs < right.completedAtMs) {
    return -1;
  }

  if (left.completedAtMs > right.completedAtMs) {
    return 1;
  }

  // Tie-break: the rating recorded for it. This is what makes the order total,
  // and so the series independent of the order the points arrived in.
  if (left.displayRating < right.displayRating) {
    return -1;
  }

  if (left.displayRating > right.displayRating) {
    return 1;
  }

  // Equal in both fields, and a point has no third field: indistinguishable.
  return 0;
}

/**
 * The Progression_Series a profile's progression yields: the same points, in
 * {@link compareProgressionPoints} order (Requirement 8.1).
 *
 * Retains exactly the points handed in — none added, none duplicated, none lost
 * — because the parser has already resolved which records carry a
 * Display_Rating. Copies before sorting, so the caller's collection is never
 * reordered in place.
 *
 * Idempotent, and a function of the input *set*: two permutations of the same
 * points yield equal series, and applying it to its own output changes nothing.
 *
 * @param points the parsed profile's progression, in whatever order it arrived
 * @returns those points in series order
 *
 * Requirements: 8.1
 */
export function toProgressionSeries(
  points: readonly ProgressionPoint[],
): readonly ProgressionPoint[] {
  return [...points].sort(compareProgressionPoints);
}
