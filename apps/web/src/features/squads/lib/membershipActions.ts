/**
 * Membership-action eligibility: the single place the Squads_Feature decides
 * whether leave, remove, transfer ownership and demote are offered.
 *
 * Like {@link isPromotable}, each rule is a pure predicate over one Squad_Member
 * plus what the feature knows about the caller, so the accepted sets are pinned
 * by property tests without rendering anything. The components hold no rule of
 * their own: they ask these and render the control or do not.
 *
 * | Action   | Caller                      | Target                                   |
 * | -------- | --------------------------- | ---------------------------------------- |
 * | leave    | active, not the owner       | (themself)                               |
 * | remove   | owner or admin              | active, not the owner, not the caller    |
 * | transfer | owner                       | active, not a guest, not the caller      |
 * | demote   | owner or admin              | an active admin, not the caller          |
 *
 * The owner is never offered leave: product rule says ownership is transferred
 * first, so {@link leaveEligibility} names that case and the screen says so.
 *
 * ### Self-exclusion by identity, where the identity is known
 *
 * As with promotion, the caller is excluded by membership identity. Neither
 * `GetSquad` nor `ListMySquads` hands the caller their own membership identity
 * today, so `viewerMembershipId` is usually `null` and the role rules carry the
 * exclusion: an owner is never a remove, transfer or demote target, so the
 * owner's own row offers none. An admin's own row can still offer remove and
 * demote, which the backend accepts (removing yourself is leaving; demoting
 * yourself gives up authority).
 *
 * These are **presentation** decisions only. The backend stays authoritative:
 * `true` is no promise the call succeeds, and a refusal such as
 * `OwnerConstraint` arrives as a `conflict` outcome.
 *
 * This module is React-free and DOM-free like every module under `lib/`.
 */

import type { SquadMember } from './parse/squadDetail';
import { isAnonymisedPlaceholder } from './playerList';
import type { MembershipState, SquadRole } from './wireEnums';

/** What the caller's own membership offers for leaving the squad. */
export type LeaveEligibility = 'can-leave' | 'owner-must-transfer' | 'none';

/**
 * Whether the caller may leave the squad, must transfer ownership first, or has
 * no membership to leave.
 *
 * Only an active membership can leave. A guest has no account and so is never
 * the caller; an unidentified caller (`null` role and state) is offered nothing.
 */
export function leaveEligibility(
  callerRole: SquadRole | null | undefined,
  callerState: MembershipState | null | undefined,
): LeaveEligibility {
  if (callerState !== 'Active' || callerRole === null || callerRole === undefined) {
    return 'none';
  }

  return callerRole === 'Owner' ? 'owner-must-transfer' : 'can-leave';
}

/** Whether the caller holds the owner's authority: an active owner membership. */
export function resolveOwnerAuthority(
  callerRole: SquadRole | null | undefined,
  callerState: MembershipState | null | undefined,
): boolean {
  return callerState === 'Active' && callerRole === 'Owner';
}

/**
 * Remove: the caller holds Admin_Authority, and the target is active, not the
 * owner and not the caller. Guests are included.
 */
export function isRemovable(
  member: SquadMember,
  viewerMembershipId: string | null,
  viewerHasAdminAuthority: boolean,
): boolean {
  return (
    viewerHasAdminAuthority &&
    member.state === 'Active' &&
    member.role !== 'Owner' &&
    member.membershipId !== viewerMembershipId
  );
}

/**
 * Transfer ownership: the caller is the owner, and the target is an active,
 * registered member other than the caller. A Former_Player is not offered,
 * because an anonymised membership has nobody behind it to own the squad.
 */
export function isOwnershipTarget(
  member: SquadMember,
  viewerMembershipId: string | null,
  viewerIsOwner: boolean,
): boolean {
  return (
    viewerIsOwner &&
    member.state === 'Active' &&
    !member.isGuest &&
    member.role !== 'Owner' &&
    !isAnonymisedPlaceholder(member.displayName) &&
    member.membershipId !== viewerMembershipId
  );
}

/**
 * Demote: the caller holds Admin_Authority, and the target is an active admin
 * other than the caller.
 */
export function isDemotable(
  member: SquadMember,
  viewerMembershipId: string | null,
  viewerHasAdminAuthority: boolean,
): boolean {
  return (
    viewerHasAdminAuthority &&
    member.state === 'Active' &&
    !member.isGuest &&
    member.role === 'Admin' &&
    member.membershipId !== viewerMembershipId
  );
}
