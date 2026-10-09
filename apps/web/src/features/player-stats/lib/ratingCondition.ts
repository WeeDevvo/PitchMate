/**
 * The Player_Stats_Feature's one resolution of the four rating conditions.
 *
 * Three things can be true of a membership's rating and the shipped squads
 * player list currently tells only two of them apart: a rating can have settled
 * on a number, it can still be settling, and there can be nothing to rate
 * because the person has never played. Collapsing the last two into one
 * non-asserting band is the known compromise this feature is partly here to fix
 * (`docs/backlog.md` → Later / Ideas). The profile carries `record.appearances`,
 * `rating.state`, and `rating.displayRating` separately, which is exactly enough
 * to separate all of them — plus the fourth, residual condition in which a
 * player has appearances but the backend recorded no rating at all.
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
 * | 2 | `rating.state === 'Provisional'` | `provisional` |
 * | 3 | `rating.state === 'Established'` and a Display_Rating is present | `established` |
 * | 4 | anything else | `absent` |
 *
 * The order matters because the glossary's Established_Rating and Never_Played
 * definitions can **both** hold of a single input — a membership with no
 * appearances can still carry a seeded, established-looking rating block — and a
 * precedence is what makes Requirement 7.1's "exactly one" true rather than
 * ambiguous.
 *
 * Two of the rules are deliberate and neither is an implementation convenience:
 *
 * - **Never_Played is unconditional and first.** A number shown for someone who
 *   has played nothing is the precise confusion this feature exists to remove,
 *   so no later branch can override it (Requirement 7.4).
 * - **Provisional wins over a present Display_Rating.** A provisional rating is
 *   not shown as a hard number even when the backend sent one, because an
 *   unsettled rating presented as a firm figure mislabels a player the squad
 *   barely knows; product.md ("Rating display") asks for a badge or a band
 *   instead, which is what Requirement 7.3 renders.
 *
 * ## What this function cannot see
 *
 * It reads the Rating_Summary's two members and the Appearance_Count, and
 * **nothing else** — not `isGuest`, not the Membership_State, not the
 * membership identity, not the Player_Display_Name. None of them is a parameter,
 * so the condition cannot acquire a tell: a guest's rating resolves exactly as a
 * registered member's does, and an inactive membership's exactly as an active
 * one's. That is Requirement 5.4's "not a reduced presentation" held
 * structurally rather than by every caller remembering.
 *
 * It also performs **no arithmetic** on the Display_Rating. The `established`
 * arm carries the parsed integer through unchanged — the display scale and
 * offset are the backend's concern alone (Requirement 7.8) — and no
 * Rating_Internal is named here, because the parsed {@link RatingSummary} has no
 * member that could hold one (Requirement 7.7).
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
 * silently stopping matching.
 */
const PROVISIONAL_STATE = 'Provisional' as const satisfies RatingState;

/** The Rating_State of a rating the backend considers settled. Pinned likewise. */
const ESTABLISHED_STATE = 'Established' as const satisfies RatingState;

/** The Appearance_Count at which a membership has played nothing in this squad. */
const NO_APPEARANCES = 0;

/**
 * Exactly one of the four mutually exclusive conditions the screen presents a
 * rating under (Requirement 7.1).
 *
 * Only the `established` arm carries a value, because it is the only one with a
 * number to render; the other three are bare tags, so there is no Display_Rating
 * for a caller to reach for — and therefore none to render as a settled figure —
 * while a rating is provisional, unplayed, or unrecorded (Requirements 7.3 to
 * 7.5). A discriminated union rather than a bare string union, which is what
 * makes that narrowing the compiler's job.
 */
export type RatingCondition =
  | { readonly kind: 'established'; readonly displayRating: number }
  | { readonly kind: 'provisional' }
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
 * Negative zero counts as no appearances (`-0 === 0`), which is the only sensible
 * reading of it. A count that is not a whole non-negative number cannot reach
 * here through the Response_Parser — `readCount` rejects fractions, negatives,
 * and non-finite values — and if one somehow did it simply fails the first rule
 * and is resolved from the rating block alone; nothing is clamped or repaired,
 * because a repair here would hide a reader that let it through.
 *
 * The Display_Rating is tested with `typeof` rather than against `null` alone, so
 * the value the `established` arm carries is a number at runtime as well as in
 * the declared type. The test is a type question, not arithmetic: the integer is
 * then passed through exactly as parsed (Requirement 7.8).
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

  // 7.3: a provisional rating is a badge and a label, never a hard number —
  // even when the backend sent a Display_Rating alongside the state.
  if (rating.state === PROVISIONAL_STATE) {
    return { kind: 'provisional' };
  }

  const displayRating = rating.displayRating;

  // 7.2: the one condition with a number to render, carried through unchanged.
  if (rating.state === ESTABLISHED_STATE && typeof displayRating === 'number') {
    return { kind: 'established', displayRating };
  }

  // 7.5: appearances exist but no rating is recorded — an established state with
  // no number, a number with no state, or no rating block content at all.
  return { kind: 'absent' };
}
