/**
 * Admin_Authority: the single place the Squads_Feature decides whether the caller
 * may see the Admin_Section.
 *
 * Requirement 10.1 fixes both the rule and its shape. The rule is narrow — the
 * caller's Membership_State must be active *and* their Member_Role must be owner
 * or admin — and every other combination, an absent role and an absent state
 * included, is `false`. The shape is a pure function of those two values, which
 * is what lets the whole admin surface be stated and tested without rendering
 * anything: the Squad_Screen holds no authority logic of its own, it calls
 * {@link resolveAdminAuthority} and renders the Admin_Section subtree or does
 * not.
 *
 * Two things follow from taking *only* a role and a state:
 *
 * - **Absence is a decision, not a gap.** Requirement 6.10 says that when
 *   neither the `GetSquad` result nor the `ListMySquads` summary identifies the
 *   caller's own membership, the caller holds no Admin_Authority. The caller
 *   resolves that to an absent role and an absent state and this function answers
 *   `false` — so the unidentified-caller case needs no separate branch anywhere,
 *   and cannot be forgotten at one call site while being handled at another.
 * - **A guest can never hold authority.** A guest membership carries no
 *   Member_Role at all, which reaches this function as `null` (Requirement 16.8)
 *   and is rejected by the role test regardless of state.
 *
 * The inactive case is deliberately *not* a special case of the role test: an
 * inactive membership keeps its role for history and replay, so an inactive owner
 * still parses as an owner. The state test is what stops a removed owner from
 * administering the squad they left, which is why both conjuncts are checked
 * rather than trusting the role alone.
 *
 * This is a **presentation** decision only. Requirement 10.5 keeps the backend's
 * authorisation result authoritative for every admin call: this function decides
 * what is rendered, never what is permitted. Its value being `true` is not a
 * claim that a call will succeed, and its value being `false` is enforced by the
 * Admin_Section subtree being *absent* rather than disabled (Requirement 10.4),
 * so no admin call can be issued from a non-admin session.
 *
 * This module is React-free and DOM-free like every module under `lib/`, and
 * imports only the two named value types it compares (Requirement 18.2).
 *
 * Requirements: 6.10, 10.1
 */

import type { MemberRole, MembershipStateValue } from './enumCodes';

/**
 * Whether the caller holds Admin_Authority within the squad.
 *
 * The accepted set is exactly `active` × {`owner`, `admin`} — two of the twelve
 * combinations of a role in {owner, admin, member, absent} and a state in
 * {active, inactive, absent}. `member` is rejected however active the membership
 * is, because a plain member administers nothing.
 *
 * Pure, total, and free of exceptions: the body is two comparisons over values
 * this feature's own parsers produced, so there is nothing to coerce and nothing
 * to recurse into. The same pair of arguments always yields the same answer.
 *
 * Both parameters accept absence, and absence is never treated as a default: an
 * absent state with an owner role is `false`, and an active state with an absent
 * role is `false`. `null` and `undefined` are equivalent here — the former is how
 * a parsed-but-absent wire value arrives, the latter how a caller that never
 * identified its own membership arrives (Requirement 6.10) — and neither is an
 * error worth distinguishing, because the answer for both is the same.
 *
 * @param role the caller's Member_Role within this squad, or `null`/`undefined`
 *   when the membership carries none or the caller's membership was not
 *   identified
 * @param state the caller's Membership_State within this squad, or
 *   `null`/`undefined` under the same conditions
 * @returns `true` only for an active membership whose role is owner or admin
 *
 * Requirements: 6.10, 10.1
 */
export function resolveAdminAuthority(
  role: MemberRole | null | undefined,
  state: MembershipStateValue | null | undefined,
): boolean {
  // 10.1: an inactive membership holds no authority, and neither does one whose
  // state is unknown — a removed owner keeps the owner role, so the state is
  // checked in its own right rather than inferred from the role.
  if (state !== 'active') {
    return false;
  }

  // 10.1: only owner and admin carry authority. A `member` role, and an absent
  // role such as a guest's or an unidentified caller's (6.10), does not.
  return role === 'owner' || role === 'admin';
}
