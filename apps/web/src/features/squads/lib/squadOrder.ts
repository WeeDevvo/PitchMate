/**
 * The order the Squad_Cards are rendered in on the Squads_Home.
 *
 * Requirement 1.3 fixes the order — ascending Squad_Name under a case-insensitive
 * comparison, ties broken by ascending squad identity — and Requirement 1.4 fixes
 * *where* it is decided: a single pure function depending on neither React nor
 * the DOM, so the order can be stated and tested without rendering anything. The
 * Squads_Home therefore holds no sorting of its own; it maps over the result of
 * {@link orderSquadSummaries} and nothing else.
 *
 * Two properties matter more than the keys themselves:
 *
 * - **It is a total order.** The final key is the squad identity, which the
 *   backend guarantees is unique across a caller's squads. No two distinct
 *   squads can therefore compare equal, which is what makes the order fully
 *   determined rather than partly inherited from the arrival order of the
 *   response.
 * - **A permutation of the input changes nothing.** Because no comparison falls
 *   back to position, the same collection in any order yields the same rendered
 *   sequence. `ListMySquads` makes no ordering promise, so a person must not see
 *   their cards rearrange between two loads of the same squads.
 *
 * The primary key is a *case-insensitive* name comparison, which is a weaker
 * relation than string equality: under `sensitivity: 'base'` the names `dave`,
 * `Dave`, and `dāve` all compare equal, and the identity key then separates them
 * deterministically. That fall-through is the whole reason the tie-break exists —
 * without it, two squads whose names differ only in case would order by whichever
 * the backend happened to send first.
 *
 * The collation is the runtime's own — `localeCompare` with no locale argument,
 * as the design specifies — so the *relation* is a function of the collection
 * alone within a given runtime, which is what the rendered order is compared
 * against. Nothing here formats a name for display; a name reaches the screen
 * exactly as parsed.
 *
 * This module is React-free and DOM-free like every module under `lib/`, and
 * imports only the parsed value type it orders (Requirement 18.2).
 *
 * Requirements: 1.3, 1.4
 */

import type { SquadSummary } from './parse/squadSummary';

/**
 * A comparison result narrowed to the three answers a total order gives, so a
 * caller cannot come to depend on the magnitude `localeCompare` happens to
 * return.
 */
export type Comparison = -1 | 0 | 1;

const sign = (value: number): Comparison => (value < 0 ? -1 : value > 0 ? 1 : 0);

/**
 * Compares two squad identities by code unit.
 *
 * Deliberately *not* case-insensitive and deliberately not locale-aware: this is
 * the key that has to separate everything the name comparison leaves equal, so it
 * must be as fine-grained and as runtime-independent as possible. Identities are
 * opaque to this feature — comparing them is only ever a tie-break, never a
 * statement about what they mean.
 */
const compareIdentity = (left: string, right: string): Comparison =>
  left < right ? -1 : left > right ? 1 : 0;

/**
 * The Squad_Card comparator: name ascending case-insensitively, then squad
 * identity ascending.
 *
 * Total over every pair of Squad_Summary values and free of exceptions. Returns
 * `0` only for two summaries carrying the same squad identity, so the induced
 * order is total over any collection of distinct squads (Requirement 1.3).
 *
 * @returns `-1` when `left` sorts before `right`, `1` when after, `0` when the
 *   two are the same squad
 */
export function compareSquadSummaries(
  left: SquadSummary,
  right: SquadSummary,
): Comparison {
  const byName = sign(
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }),
  );

  if (byName !== 0) {
    return byName;
  }

  // Reached whenever the names are equal *under the collation* — which includes
  // names differing only in case or in accent, not just identical strings.
  return compareIdentity(left.squadId, right.squadId);
}

/**
 * The parsed Squad_Summary collection in the order its Squad_Cards are rendered.
 *
 * Pure and total: the input is copied before sorting, so the caller's collection
 * is never reordered in place, and every input summary appears in the result
 * exactly once — this function selects nothing, adds nothing, and merges nothing
 * (Requirement 1.2 stays a property of the collection, not of the ordering).
 *
 * Idempotent, and independent of the supplied order: ordering an already-ordered
 * collection, or any permutation of a collection, yields the same sequence.
 *
 * @param summaries the parsed `ListMySquads` collection, in whatever order the
 *   response carried it
 * @returns a new collection holding exactly those summaries, ordered by
 *   {@link compareSquadSummaries}
 *
 * Requirements: 1.3, 1.4
 */
export function orderSquadSummaries(
  summaries: readonly SquadSummary[],
): readonly SquadSummary[] {
  return [...summaries].sort(compareSquadSummaries);
}
