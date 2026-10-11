/**
 * Rating_Presentation: the one place the Squads_Feature decides what a
 * Player_Row says about a player's rating, and the one place a leaderboard value
 * becomes a displayable integer.
 *
 * **A note on the numbering below.** Bare requirement numbers are this feature's
 * own, from `web-squads-screens`. The four-condition rule arrived later, from the
 * `web-player-stats-screen` spec's Requirement 17, and every reference to it is
 * written out in full so the two seventeens cannot be mistaken for each other.
 *
 * `web-player-stats-screen` Requirement 17.1 allows a Player_Row exactly **one**
 * of four conditions — a settled Display_Rating, a provisional rating, a player
 * who has played no matches, and a rating that could not be obtained — and
 * Requirement 8.6
 * requires the choice to be a pure, total function of the Squad_Member and the
 * optional Display_Rating_Leaderboard. Making the return type a tagged union of
 * exactly those four cases is what turns "exactly one" from a rendering
 * convention into something the type system enforces: there is no value of
 * {@link RatingPresentation} that carries a number *and* claims to be
 * provisional, and no way for a component to render two of them, because it is
 * handed one value rather than four optional fields.
 *
 * The fourth condition is why that spec reaches in here at all: a player with no
 * completed match and a player whose rating is still settling used to collapse
 * onto one band, which told a reader the same thing about two different
 * situations. They are now separated **without a further call** — the
 * Appearance_Count and the Rating_State this function reads are already carried
 * on every Squad_Member and every Player_List row, and were simply unread
 * (`web-player-stats-screen` Requirements 17.2, 17.6).
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
 * **Three fields of the member are read, and no others:** its membership
 * identity, its Appearance_Count, and its Rating_State. Requirement 8.12 forbids
 * a band from varying with Membership_State, Guest_Flag, Member_Role, or
 * leaderboard size — so this function never looks at those fields, and no band
 * can acquire an accidental tell through a branch that was added later. The
 * union's three non-numeric cases carry no payload at all, which is the same
 * guarantee stated in the type: their copy is three fixed strings in
 * `lib/messages.ts`, identical on every row by construction (Requirements 8.12,
 * 8.13, and `web-player-stats-screen` 17.3).
 *
 * This module is React-free and DOM-free like every module under `lib/`
 * (Requirement 18.2), so both functions are testable without a browser, which is
 * exactly what Requirements 8.2 and 8.6 ask for.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.5, 8.6, 8.9, 8.10, and
 * `web-player-stats-screen` 17.1, 17.2, 17.3, 17.6
 */

import type { DisplayRatingLeaderboard } from './parse/leaderboard';
import type { SquadMember } from './parse/squadDetail';

/**
 * What a Player_Row says about one player's rating: exactly one of the four
 * conditions `web-player-stats-screen` Requirement 17.1 permits.
 *
 * `rating` carries the value **already rounded** by {@link formatDisplayRating},
 * so a component renders it with `String(value)` and performs no arithmetic and
 * no formatting of its own. The other three carry nothing: their labels are the
 * constants `PROVISIONAL_BAND_LABEL`, `NEVER_PLAYED_BAND_LABEL`, and
 * `RATING_UNAVAILABLE_LABEL` in `lib/messages.ts`, and a payload here would be a
 * place for row-dependent copy to creep in against Requirements 8.12 and 8.13.
 */
export type RatingPresentation =
  | { readonly kind: 'rating'; readonly value: number }
  | { readonly kind: 'provisional' }
  | { readonly kind: 'never-played' }
  | { readonly kind: 'unavailable' };

/**
 * The Rating_Presentation for one Squad_Member, given the leaderboard if one was
 * obtained.
 *
 * Pure, total, and free of exceptions: it reads three fields off the member,
 * walks the entries once, and returns one of four literal shapes. Equal inputs
 * give equal results (Requirement 8.6), so composing a Player_List twice renders
 * the same ratings twice.
 *
 * The branches are evaluated in this order, and the order is the whole of the
 * "exactly one" guarantee — two conditions can hold of a single input, and
 * precedence is what picks between them:
 *
 * 1. **No leaderboard → `unavailable`.** First, because when no leaderboard was
 *    obtained nothing is known about any row. `null` means the
 *    `GetSquadLeaderboard` call did not yield a usable body: it failed, it timed
 *    out, it is still in flight while `GetSquad` has already landed, or its body
 *    was rejected by the parser — including the ambiguous duplicate-identity
 *    case, which Requirement 8.11 routes here so no player gets a rating derived
 *    from it (Requirements 7.10, 7.13, 8.11).
 * 2. **A zero Appearance_Count → `never-played`** (`web-player-stats-screen`
 *    17.2). Unconditional once a leaderboard is in hand, and ahead of every
 *    rating branch: a rating shown for somebody who has played nothing is the
 *    exact confusion that requirement exists to remove, so no later branch may
 *    override it.
 * 3. **A provisional Rating_State → `provisional`** (`web-player-stats-screen`
 *    17.2). A
 *    provisional rating is deliberately not shown as a number even when the
 *    leaderboard carries one for this membership, which is what product.md's
 *    "Rating display" asks for: a band rather than a hard number while the
 *    uncertainty is high.
 * 4. **A leaderboard entry for this membership with a finite value → `rating`**,
 *    rounded by {@link formatDisplayRating} (Requirement 8.1).
 * 5. **Otherwise → `unavailable`.** The residual is a player who has played, is
 *    not provisional, and has no usable entry — a rating that was not obtained
 *    for this row, which is what that label already says. A `NaN` or infinite
 *    value lands here with an absent entry, because an unusable number carries no
 *    more information about the player than no number at all (Requirement 8.10).
 *
 * Identities compare exactly, as Requirement 8.1 specifies — the membership
 * identity is opaque to this feature, so it is neither trimmed nor case-folded
 * before comparison. The leaderboard parser has already rejected a body with a
 * repeated identity (Requirement 8.11), so at most one entry can match and the
 * first match is unambiguous rather than chosen by array order.
 *
 * @param member the Squad_Member whose row is being presented; only its
 *   `membershipId`, `appearances`, and `ratingState` are read (Requirement 8.12,
 *   `web-player-stats-screen` 17.2)
 * @param leaderboard the parsed Display_Rating_Leaderboard, or `null` when none
 *   was obtained
 * @returns exactly one of the four presentations
 *
 * Requirements: 8.1, 8.3, 8.5, 8.6, 8.9, 8.10, and `web-player-stats-screen`
 * 17.1, 17.2, 17.3, 17.6
 */
export function selectRatingPresentation(
  member: SquadMember,
  leaderboard: DisplayRatingLeaderboard | null,
): RatingPresentation {
  // 1. 7.10, 8.11: no leaderboard reached us, so no row can claim a rating.
  if (leaderboard === null) {
    return { kind: 'unavailable' };
  }

  // 2. player-stats 17.2: no completed match in this squad, so there is nothing
  // for a rating to be derived from — stated before any rating branch speaks.
  if (member.appearances === 0) {
    return { kind: 'never-played' };
  }

  // 3. player-stats 17.2: the rating exists but is still settling, so it is
  // presented as a band rather than a number, whatever the leaderboard carries.
  if (member.ratingState === 'Provisional') {
    return { kind: 'provisional' };
  }

  const entry = leaderboard.entries.find(
    (candidate) => candidate.membershipId === member.membershipId,
  );

  // 5. 8.3, 8.10: an absent entry and an unusable value are the same statement —
  // this played, non-provisional row has no rating that could be obtained.
  if (entry === undefined || !Number.isFinite(entry.value)) {
    return { kind: 'unavailable' };
  }

  // 4. 8.1, 8.9: the row's own entry value, rounded, and nothing else.
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
