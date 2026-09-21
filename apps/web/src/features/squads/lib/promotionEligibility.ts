/**
 * Promotion eligibility: the single place the Squads_Feature decides whether a
 * Player_Row offers the Promotion_Control.
 *
 * Requirement 13.3 asks for this shape specifically — a pure predicate over one
 * Squad_Member plus the caller's own membership identity and Admin_Authority —
 * so the whole eligibility rule can be stated and tested without rendering
 * anything. The Player_Row holds no eligibility logic of its own: it calls
 * {@link isPromotable} and renders the control or does not.
 *
 * The rule is the conjunction of six conditions, and it is worth being explicit
 * that Requirements 13.1 and 13.2 are **the same rule read from both ends**.
 * 13.1 lists what must hold for the control to appear; 13.2 lists the cases that
 * must never offer it. Written as one predicate they cannot disagree — every
 * exclusion in 13.2 is the negation of a conjunct in 13.1, so there is no second
 * "should I hide it?" test anywhere that could drift from the first:
 *
 * | Excluded case (13.2)                | Conjunct that rejects it            |
 * | ----------------------------------- | ----------------------------------- |
 * | caller holds no Admin_Authority     | `viewerHasAdminAuthority`           |
 * | Membership_State is inactive        | `state === 'active'`                |
 * | Guest_Flag is set                   | `!member.isGuest`                   |
 * | Member_Role is owner or admin       | `role === 'member'`                 |
 * | Anonymised_Placeholder display name | `!isAnonymisedPlaceholder(…)`       |
 * | the caller's own membership         | `membershipId !== viewerMembershipId` |
 *
 * Three of those conjuncts are less obvious than they look:
 *
 * - **`role === 'member'` is a positive test, not "not owner and not admin".**
 *   A guest carries no role at all — `null` (Requirement 16.8) — and a positive
 *   test rejects it without relying on the guest flag, so a guest is excluded
 *   twice over rather than by one branch that could be removed. The same test
 *   also rejects any role a future backend adds that this feature does not yet
 *   understand, which is the safe direction for an admin affordance.
 * - **The anonymised check is here as well as in the Former_Player
 *   presentation.** Requirement 7.8 already says a Former_Player row renders no
 *   Promotion_Control; folding that into this predicate means the row's
 *   presentation and its controls cannot disagree about who is a former player,
 *   because both read the same predicate from `./playerList`.
 * - **Self-exclusion is by membership identity, not by role.** A caller holding
 *   Admin_Authority is an owner or admin, so their own row would already fail the
 *   `member` test — but the identity comparison is stated anyway, because it is
 *   what Requirement 13.2 asks for and because it stays correct if authority is
 *   ever resolved from a source other than this squad's own membership list.
 *   Absence of a viewer identity (`null`, when no membership identified the
 *   caller — Requirement 6.10) is not treated as "matches nobody" carelessly: a
 *   caller who was never identified also holds no Admin_Authority, so the first
 *   conjunct has already answered `false`.
 *
 * Like {@link resolveAdminAuthority}, this is a **presentation** decision only.
 * Requirement 10.5 keeps the backend's authorisation result authoritative for
 * `PromoteToAdmin`: `true` here is not a promise that the call will succeed, and
 * `false` is enforced by the control being *absent* rather than disabled.
 *
 * Requirement 13.8 — no control that demotes an admin, transfers ownership, or
 * removes a membership — is honoured by omission: promotion is the only
 * membership-changing predicate in the feature, and the absence of the other
 * three is pinned by the structural scan rather than by anything in this file.
 *
 * This module is React-free and DOM-free like every module under `lib/`, and
 * imports only the Squad_Member type it reads and the placeholder predicate it
 * reuses (Requirement 18.2).
 *
 * Requirements: 13.1, 13.2, 13.3
 */

import type { SquadMember } from './parse/squadDetail';
import { isAnonymisedPlaceholder } from './playerList';

/**
 * Whether a Player_Row offers the Promotion_Control for this Squad_Member.
 *
 * The accepted set is exactly: the caller holds Admin_Authority, and the member
 * is an active, non-guest membership whose role is `member`, whose display name
 * is not the Anonymised_Placeholder, and whose membership identity is not the
 * caller's own (Requirements 13.1, 13.2).
 *
 * Pure, total, and free of exceptions: the body is five comparisons over values
 * this feature's own parsers produced plus one call to a predicate that is itself
 * a trimmed string comparison. Nothing is coerced and nothing is recursed into,
 * so the same arguments always yield the same answer — which is what makes the
 * property test over role × state × guest × anonymised × self effectively
 * exhaustive.
 *
 * @param member the Squad_Member whose row is being rendered
 * @param viewerMembershipId the caller's own membership identity within this
 *   squad, or `null` when no membership identified the caller (Requirement 6.10)
 * @param viewerHasAdminAuthority the caller's Admin_Authority, as resolved by
 *   `resolveAdminAuthority`
 * @returns `true` only when every condition of Requirement 13.1 holds
 *
 * Requirements: 13.1, 13.2, 13.3
 */
export function isPromotable(
  member: SquadMember,
  viewerMembershipId: string | null,
  viewerHasAdminAuthority: boolean,
): boolean {
  // 13.2: a caller without Admin_Authority is offered no Promotion_Control on any
  // row — including the unidentified caller, whose authority is already `false`.
  if (!viewerHasAdminAuthority) {
    return false;
  }

  // 13.2: an inactive membership is not promoted. It keeps its role for history
  // and replay, so the state is checked in its own right.
  if (member.state !== 'active') {
    return false;
  }

  // 13.2: a guest has no account to administer with.
  if (member.isGuest) {
    return false;
  }

  // 13.1: promotion applies to a plain member. A positive test also rejects an
  // owner, an admin, a guest's absent role, and any role this feature does not
  // yet name.
  if (member.role !== 'member') {
    return false;
  }

  // 7.8, 13.1: a Former_Player row offers no Promotion_Control, recognised
  // through the same predicate the row's presentation uses.
  if (isAnonymisedPlaceholder(member.displayName)) {
    return false;
  }

  // 13.2: the caller is never offered promotion of their own membership.
  return member.membershipId !== viewerMembershipId;
}
