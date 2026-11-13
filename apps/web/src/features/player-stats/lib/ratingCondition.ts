/**
 * The Player_Stats_Feature's one resolution of the four rating conditions.
 *
 * A membership's rating is in exactly one of four conditions: it has settled on
 * a number, it has a number that is still settling, there is nothing to rate
 * because the person has never played, or the player has appearances but the
 * backend recorded no rating at all. The profile carries `record.appearances`,
 * `rating.state`, and `rating.displayRating` separately, which is exactly enough
 * to separate all of them.
 *
 * Requirement 7.1 asks for that separation to happen in **one** pure function,
 * total over every combination of its inputs, so the four presentations
 * (Requirements 7.2 to 7.6) are four renderings of one decision rather than four
 * places each re-deciding what a rating means.
 *
 * ## The precedence is the specification
 *
 * | Order | Condition | Yields |
 * | --- | --- | --- |
 * | 1 | `appearances === 0` | `never-played` |
 * | 2 | `rating.state === 'Provisional'` and a Display_Rating is present | `settling` |
 * | 3 | `rating.state === 'Established'` and a Display_Rating is present | `established` |
 * | 4 | anything else | `absent` |
 *
 * **Never_Played is unconditional and first.** A number shown for someone who
 * has played nothing is the confusion this feature exists to remove, so no later
 * branch can override it (Requirement 7.4).
 *
 * **A settling rating carries its number.** Every player shows a rating from
 * their first match (product.md, "Ratings"): the backend sends the same kind of
 * number for a rating that is still settling as for a settled one, and the
 * `settling` arm passes it through unchanged. The condition only tells the
 * screen to put the settling note beside the player's name; the number itself
 * is rendered exactly as an established one is.
 *
 * ## What this function cannot see
 *
 * It reads the Rating_Summary's two members and the Appearance_Count, and
 * **nothing else** — not `isGuest`, not the Membership_State, not the
 * membership identity, not the Player_Display_Name. A guest's rating resolves
 * exactly as a registered member's does (Requirement 5.4).
 *
 * It also performs **no arithmetic** on the Display_Rating. Both numeric arms
 * carry the parsed integer through unchanged — the display scale and offset are
 * the backend's concern alone (Requirement 7.8) — and no Rating_Internal is
 * named here, because the parsed {@link RatingSummary} has no member that could
 * hold one (Requirement 7.7).
 *
 * React-free and DOM-free like every module under `lib/`, and importing nothing
 * but two sibling **types**, both erased at compile time (Requirement 14.3).
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.8
 */

import type { RatingSummary } from './parse/playerProfile';
import type { RatingState } from './wireEnums';

/**
 * The Rating_State of a rating that is still settling, pinned to the wire
 * vocabulary so a renamed backend member fails `tsc -b` here rather than
 * silently stopping matching. The wire still calls it "Provisional".
 */
const SETTLING_STATE = 'Provisional' as const satisfies RatingState;

/** The Rating_State of a rating the backend considers settled. Pinned likewise. */
const ESTABLISHED_STATE = 'Established' as const satisfies RatingState;

/** The Appearance_Count at which a membership has played nothing in this squad. */
const NO_APPEARANCES = 0;

/**
 * Exactly one of the four mutually exclusive conditions the screen presents a
 * rating under (Requirement 7.1).
 *
 * The `established` and `settling` arms both carry the number to render; the
 * other two are bare tags, so there is no Display_Rating for a caller to reach
 * for while a rating is unplayed or unrecorded (Requirements 7.4, 7.5).
 */
export type RatingCondition =
  | { readonly kind: 'established'; readonly displayRating: number }
  | { readonly kind: 'settling'; readonly displayRating: number }
  | { readonly kind: 'never-played' }
  | { readonly kind: 'absent' };

/**
 * The Rating_Condition of one Rating_Summary read beside one Appearance_Count.
 *
 * Pure and total: no clock, no transport, no DOM, no exception, and the same
 * answer for the same input. Every combination resolves, because the fourth rule
 * is unconditional — a rating block with no state, a state with no number, a
 * number with no state, and any pair the contract could not produce all land on
 * `absent` rather than on nothing.
 *
 * Negative zero counts as no appearances (`-0 === 0`). The Display_Rating is
 * tested with `typeof` rather than against `null` alone, so the value a numeric
 * arm carries is a number at runtime as well as in the declared type. The test
 * is a type question, not arithmetic: the integer is then passed through exactly
 * as parsed (Requirement 7.8).
 *
 * @param rating the profile's rating block, exactly as parsed
 * @param appearances the Player_Record's Appearance_Count for this squad
 * @returns exactly one of the four conditions
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.8
 */
export function resolveRatingCondition(
  rating: RatingSummary,
  appearances: number,
): RatingCondition {
  // 7.4: unconditional and first. Nothing has been rated, so no rating-block
  // member below can produce a figure for someone who has played nothing.
  if (appearances === NO_APPEARANCES) {
    return { kind: 'never-played' };
  }

  const displayRating = rating.displayRating;

  if (typeof displayRating === 'number') {
    // 7.3: still settling. The number is the backend's and is shown like any
    // other; the condition is what puts the settling note beside the name.
    if (rating.state === SETTLING_STATE) {
      return { kind: 'settling', displayRating };
    }

    // 7.2: settled, carried through unchanged.
    if (rating.state === ESTABLISHED_STATE) {
      return { kind: 'established', displayRating };
    }
  }

  // 7.5: appearances exist but no rating is recorded — a state with no number,
  // a number with no state, or no rating block content at all.
  return { kind: 'absent' };
}
