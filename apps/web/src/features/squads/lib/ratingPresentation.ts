/**
 * Rating_Presentation: the one place the Squads_Feature decides what a
 * Player_Row says about a player's rating, and the one place a leaderboard value
 * becomes a displayable integer.
 *
 * Requirement 8.5 allows a Player_Row exactly **one** of three presentations — a
 * Display_Rating, a Provisional_Band, or a Rating_Unavailable label — and
 * Requirement 8.6 requires the choice to be a pure, total function of the
 * Squad_Member and the optional Display_Rating_Leaderboard. Making the return
 * type a tagged union of exactly those three cases is what turns "exactly one"
 * from a rendering convention into something the type system enforces: there is
 * no value of {@link RatingPresentation} that carries a number *and* claims to be
 * provisional, and no way for a component to render two of them, because it is
 * handed one value rather than three optional fields.
 *
 * **Nothing here computes a rating.** The mapping from the model to a friendly
 * number is the backend's (Requirement 8.9), so this module contains no mean
 * skill estimate, no uncertainty value, and no scaling parameter — no μ, no σ, no
 * K, no C. The only number it touches is the `value` of the entry matching the
 * row's own membership, and the only thing it does to that number is round it.
 * Nothing else the entry carries is read: the entry's own `displayName` is
 * deliberately ignored, because `GetSquad` is the authority on who is in the
 * squad and under what name (Requirement 7.2).
 *
 * **Only the membership identity of the member is read.** Requirement 8.12
 * forbids the Provisional_Band from varying with Membership_State, Guest_Flag,
 * Member_Role, or leaderboard size — so this function never looks at those
 * fields, and the band cannot acquire an accidental tell through a branch that
 * was added later. The union's `provisional` and `unavailable` cases carry no
 * payload at all, which is the same guarantee stated in the type: their copy is
 * two fixed strings in `lib/messages.ts`, identical on every row by construction
 * (Requirements 8.12, 8.13).
 *
 * This module is React-free and DOM-free like every module under `lib/`
 * (Requirement 18.2), so both functions are testable without a browser, which is
 * exactly what Requirements 8.2 and 8.6 ask for.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.5, 8.6, 8.9, 8.10
 */

import type { DisplayRatingLeaderboard } from './parse/leaderboard';
import type { SquadMember } from './parse/squadDetail';

/**
 * What a Player_Row says about one player's rating: exactly one of the three
 * presentations Requirement 8.5 permits.
 *
 * `rating` carries the value **already rounded** by {@link formatDisplayRating},
 * so a component renders it with `String(value)` and performs no arithmetic and
 * no formatting of its own. The other two carry nothing: their labels are the
 * constants `PROVISIONAL_BAND_LABEL` and `RATING_UNAVAILABLE_LABEL` in
 * `lib/messages.ts`, and a payload here would be a place for row-dependent copy
 * to creep in against Requirements 8.12 and 8.13.
 */
export type RatingPresentation =
  | { readonly kind: 'rating'; readonly value: number }
  | { readonly kind: 'provisional' }
  | { readonly kind: 'unavailable' };

/**
 * The Rating_Presentation for one Squad_Member, given the leaderboard if one was
 * obtained.
 *
 * Pure, total, and free of exceptions: it reads one string off the member, walks
 * the entries once, and returns one of three literal shapes. Equal inputs give
 * equal results (Requirement 8.6), so composing a Player_List twice renders the
 * same ratings twice.
 *
 * The three branches are evaluated in this order:
 *
 * 1. **No leaderboard → `unavailable`.** `null` means the `GetSquadLeaderboard`
 *    call did not yield a usable body: it failed, it timed out, it is still in
 *    flight while `GetSquad` has already landed, or its body was rejected by the
 *    parser — including the ambiguous duplicate-identity case, which
 *    Requirement 8.11 routes here so no player gets a rating derived from it
 *    (Requirements 7.10, 7.13, 8.11).
 * 2. **No matching entry, or a matching entry whose value is not finite →
 *    `provisional`** (Requirements 8.3, 8.10). The two collapse on purpose: a
 *    `NaN` or infinite value carries no more information about the player than an
 *    absent entry does, and folding them keeps a single "exactly one
 *    presentation" rule rather than adding a fourth case that would have to be
 *    given copy of its own.
 * 3. **Otherwise → `rating`**, the matching entry's value rounded by
 *    {@link formatDisplayRating} (Requirement 8.1).
 *
 * Identities compare exactly, as Requirement 8.1 specifies — the membership
 * identity is opaque to this feature, so it is neither trimmed nor case-folded
 * before comparison. The leaderboard parser has already rejected a body with a
 * repeated identity (Requirement 8.11), so at most one entry can match and the
 * first match is unambiguous rather than chosen by array order.
 *
 * @param member the Squad_Member whose row is being presented; only its
 *   `membershipId` is read (Requirement 8.12)
 * @param leaderboard the parsed Display_Rating_Leaderboard, or `null` when none
 *   was obtained
 * @returns exactly one of the three presentations
 *
 * Requirements: 8.1, 8.3, 8.5, 8.6, 8.9, 8.10
 */
export function selectRatingPresentation(
  member: SquadMember,
  leaderboard: DisplayRatingLeaderboard | null,
): RatingPresentation {
  // 1. 7.10, 8.11: no leaderboard reached us, so no row can claim a rating.
  if (leaderboard === null) {
    return { kind: 'unavailable' };
  }

  const entry = leaderboard.entries.find(
    (candidate) => candidate.membershipId === member.membershipId,
  );

  // 2. 8.3, 8.10: an absent entry and an unusable value are the same statement —
  // this player has no settled rating to show.
  if (entry === undefined || !Number.isFinite(entry.value)) {
    return { kind: 'provisional' };
  }

  // 3. 8.1, 8.9: the row's own entry value, rounded, and nothing else.
  return { kind: 'rating', value: formatDisplayRating(entry.value) };
}

/**
 * A finite leaderboard value rounded to the nearest integer, with an exact half
 * rounded **away from zero** (Requirement 8.2).
 *
 * `Math.round` is not this function. It breaks a tie toward `+∞`, so it maps
 * `-0.5` to `-0` and `-2.5` to `-2` — toward zero on the negative side, which is
 * the opposite of the rule. Rounding the **magnitude** and reapplying the sign
 * makes the behaviour symmetric: `0.5 → 1`, `-0.5 → -1`, `1.5 → 2`, `-2.5 → -3`.
 * Rounding the magnitude also avoids the `floor(x + 0.5)` trap, where a value a
 * hair under a half — `0.49999999999999994` — sums to exactly `1` in binary
 * floating point and rounds up when the nearest integer is `0`.
 *
 * A magnitude that rounds to zero returns positive zero rather than `-0`, so a
 * small negative value cannot render as `"-0"`. Larger magnitudes keep their
 * sign, and values at or beyond `Number.MAX_SAFE_INTEGER` are already integral,
 * so they pass through unchanged.
 *
 * The result is a plain integer for a component to render with `String(value)`.
 * That is deliberate rather than incidental: a locale formatter would be free to
 * insert a grouping separator or a locale-specific digit, and Requirement 8.1
 * asks for a decimal integer with no grouping separator and no leading zero on
 * every row regardless of the reader's locale.
 *
 * Pure, total, and free of exceptions. Callers reach it only through
 * {@link selectRatingPresentation}, which has already established that the value
 * is finite; a non-finite argument is neither rejected nor substituted here,
 * because inventing a number would be worse than propagating the caller's own
 * mistake.
 *
 * @param value the matching entry's finite value
 * @returns that value rounded to the nearest integer, ties away from zero
 *
 * Requirements: 8.1, 8.2, 8.9
 */
export function formatDisplayRating(value: number): number {
  // Rounding the magnitude gives the tie the away-from-zero direction on both
  // sides; `Math.round` on a non-negative number already breaks its tie upward.
  const magnitude = Math.round(Math.abs(value));

  // Positive zero, never `-0`: a rating of "-0" is not a thing a row should show.
  if (magnitude === 0) {
    return 0;
  }

  return value < 0 ? -magnitude : magnitude;
}
