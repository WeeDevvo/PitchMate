/**
 * The `GetSquad` body shape: the squad's identity and name, every membership, and
 * every feature's state.
 *
 * `GetSquad` is the **authority on membership**. The Player_List's row set is
 * `members` alone and the Display_Rating leaderboard only decorates it
 * (Requirement 7.2), so a member this parser drops is a player who vanishes from
 * the squad with nothing on screen saying so. That is why one bad member fails
 * the whole body: a complete-looking list that quietly omits somebody is worse
 * than one Generic_Squads_Failure a person can retry.
 *
 * Two differences from the Squad_Summary shape are load-bearing, and both come
 * from the backend's own `SquadMemberView`:
 *
 *  - **`role` is nullable, `state` is not.** A guest membership has no role, so
 *    `null` and absent are valid absences there (Requirement 16.8). A membership
 *    always has a lifecycle state, so an absent `state` is a contract mismatch and
 *    fails the member. Defaulting it would be worse than failing: the Player_Order
 *    sorts active before inactive and the Admin_Authority check requires an active
 *    membership, so an invented `active` would reorder the list and could render
 *    an administration surface the backend never authorised.
 *  - **`isGuest` is a strict boolean**, never defaulted, because the guest flag
 *    decides whether a row offers the guest edit control.
 *
 * The membership enum readers come from `squadSummary.ts` and the feature flags
 * from `featureFlags.ts`, so nothing about either is declared twice.
 *
 * Requirements: 7.2, 16.4, 16.5, 16.6, 16.8, 16.9, 16.10
 */

import { codeFromMemberRole, codeFromMembershipState } from '../enumCodes';
import type { MemberRole, MembershipStateValue } from '../enumCodes';
import {
  parseFeatureFlags,
  printFeatureFlags,
  type FeatureFlag,
} from './featureFlags';
import {
  ok,
  readArray,
  readBoolean,
  readObject,
  readOptional,
  readProperty,
  readString,
  readUuid,
  type ParseResult,
} from './primitives';
import { readMemberRoleValue, readMembershipStateValue } from './squadSummary';

/**
 * One membership within a squad — a registered member or a guest. `role` is
 * `null` for a guest (Requirement 16.8); `state` is always present.
 */
export interface SquadMember {
  readonly membershipId: string;
  readonly displayName: string;
  readonly role: MemberRole | null;
  readonly state: MembershipStateValue;
  readonly isGuest: boolean;
}

/** A squad as the Squad_Screen renders it, before the leaderboard decorates it. */
export interface SquadDetail {
  readonly squadId: string;
  readonly name: string;
  readonly members: readonly SquadMember[];
  readonly features: readonly FeatureFlag[];
}

/**
 * One Squad_Member parsed from an element of `members`.
 *
 * Total over every input and free of exceptions; the result is built last, from
 * five validated readings, so a bad field fails the member rather than producing
 * one with that field defaulted (Requirement 16.4).
 *
 * Requirements: 16.4, 16.8, 16.9
 */
export function parseSquadMember(body: unknown): ParseResult<SquadMember> {
  const source = readObject(body, 'squad member');

  if (!source.ok) {
    return source;
  }

  const membershipId = readUuid(
    readProperty(source.value, 'membershipId'),
    'squad member membershipId',
  );

  if (!membershipId.ok) {
    return membershipId;
  }

  const displayName = readString(
    readProperty(source.value, 'displayName'),
    'squad member displayName',
  );

  if (!displayName.ok) {
    return displayName;
  }

  // 16.8: a guest carries no role, which arrives as `null` or an absent property.
  const role = readOptional(
    readProperty(source.value, 'role'),
    'squad member role',
    readMemberRoleValue,
  );

  if (!role.ok) {
    return role;
  }

  // Not optional: a membership always has a state, and an invented one would
  // reorder the Player_List and could unlock an administration surface.
  const state = readMembershipStateValue(
    readProperty(source.value, 'state'),
    'squad member state',
  );

  if (!state.ok) {
    return state;
  }

  // Not optional either: the guest flag decides whether a row offers the guest
  // edit control, so a defaulted `false` would hide it from a real guest.
  const isGuest = readBoolean(
    readProperty(source.value, 'isGuest'),
    'squad member isGuest',
  );

  if (!isGuest.ok) {
    return isGuest;
  }

  return ok({
    membershipId: membershipId.value,
    displayName: displayName.value,
    role: role.value,
    state: state.value,
    isGuest: isGuest.value,
  });
}

/**
 * The whole `GetSquad` body.
 *
 * Requirements: 16.4, 16.9
 */
export function parseSquadDetail(body: unknown): ParseResult<SquadDetail> {
  const source = readObject(body, 'squad detail');

  if (!source.ok) {
    return source;
  }

  const squadId = readUuid(
    readProperty(source.value, 'squadId'),
    'squad detail squadId',
  );

  if (!squadId.ok) {
    return squadId;
  }

  const name = readString(readProperty(source.value, 'name'), 'squad detail name');

  if (!name.ok) {
    return name;
  }

  const elements = readArray(
    readProperty(source.value, 'members'),
    'squad detail members',
  );

  if (!elements.ok) {
    return elements;
  }

  const members: SquadMember[] = [];

  for (const element of elements.value) {
    const member = parseSquadMember(element);

    if (!member.ok) {
      return member;
    }

    members.push(member.value);
  }

  const features = parseFeatureFlags(readProperty(source.value, 'features'));

  if (!features.ok) {
    return features;
  }

  return ok({
    squadId: squadId.value,
    name: name.value,
    members,
    features: features.value,
  });
}

/**
 * A Squad_Member rendered back into the wire shape {@link parseSquadMember}
 * accepts.
 *
 * Requirements: 16.5
 */
export function printSquadMember(member: SquadMember): unknown {
  return {
    membershipId: member.membershipId,
    displayName: member.displayName,
    role: member.role === null ? null : codeFromMemberRole(member.role),
    state: codeFromMembershipState(member.state),
    isGuest: member.isGuest,
  };
}

/**
 * A Squad_Detail rendered back into the wire shape {@link parseSquadDetail}
 * accepts.
 *
 * Requirements: 16.5
 */
export function printSquadDetail(detail: SquadDetail): unknown {
  return {
    squadId: detail.squadId,
    name: detail.name,
    members: detail.members.map(printSquadMember),
    features: printFeatureFlags(detail.features),
  };
}
