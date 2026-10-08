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
 *    membership, so an invented `Active` would reorder the list and could render
 *    an administration surface the backend never authorised.
 *  - **`isGuest` is a strict boolean**, never defaulted, because the guest flag
 *    decides whether a row offers the guest edit control.
 *
 * ## The two standing fields
 *
 * `SquadMemberView` now carries an **Appearance_Count** and a
 * **Rating_State_Signal** beside each membership, so the player list can tell
 * apart the three cases the shipped screen could not (Requirement 12.9):
 *
 * | Wire | Meaning |
 * | --- | --- |
 * | `appearances == 0` | never played a completed match in this squad |
 * | `ratingState == null` | no rating established for this membership |
 * | `ratingState == 'Provisional'` \| `'Established'` | the Domain's own classification |
 *
 * `appearances` is **required** — it is a count the backend always sends, and a
 * defaulted zero would claim somebody has never played. `ratingState` is a
 * *valid absence*: `null` and a missing property both mean "no rating", which is
 * a state the backend genuinely reports rather than a contract mismatch.
 *
 * Neither μ nor σ nor any display number appears here. The classification arrives
 * already made, which is what keeps this feature's ban on rating arithmetic true
 * by construction.
 *
 * The membership enum readers come from `squadSummary.ts` and the feature flags
 * from `featureFlags.ts`, so nothing about either is declared twice. The
 * Rating_State_Signal is read by name against its Generated_Enum_Union and
 * carried as that name, since no part of this feature named it before.
 *
 * Requirements: 7.2, 12.1, 12.5, 12.7, 12.8, 12.9, 16.4, 16.5, 16.8, 16.9, 16.10
 */

import {
  isRatingState,
  type MembershipState,
  type RatingState,
  type SquadRole,
} from '../wireEnums';
import {
  parseFeatureFlags,
  printFeatureFlags,
  type FeatureFlag,
} from './featureFlags';
import {
  fail,
  ok,
  readArray,
  readBoolean,
  readNumber,
  readObject,
  readOptional,
  readProperty,
  readString,
  readUuid,
  readWireEnumName,
  type ParseResult,
  type ValueReader,
} from './primitives';
import { readMemberRoleValue, readMembershipStateValue } from './squadSummary';

/**
 * One membership within a squad — a registered member or a guest. `role` is
 * `null` for a guest (Requirement 16.8); `state` is always present;
 * `ratingState` is `null` when no rating has been established.
 */
export interface SquadMember {
  readonly membershipId: string;
  readonly displayName: string;
  readonly role: SquadRole | null;
  readonly state: MembershipState;
  readonly isGuest: boolean;
  readonly appearances: number;
  readonly ratingState: RatingState | null;
}

/**
 * An Appearance_Count read as a non-negative whole number.
 *
 * Rejected: every non-number (a string-encoded count included — the schema
 * describes the `int32` as either form, but the backend serialises a JSON number
 * and accepting both would make the printer's output ambiguous), a fraction, and
 * a negative count. Nothing is rounded or clamped: a count the backend could not
 * have sent fails the member rather than being repaired into a plausible one.
 *
 * Requirements: 12.5, 12.9
 */
const readAppearanceCount: ValueReader<number> = (value, label) => {
  const count = readNumber(value, label);

  if (!count.ok) {
    return count;
  }

  if (!Number.isInteger(count.value) || count.value < 0) {
    return fail(`${label} is not a non-negative whole number`);
  }

  return ok(count.value);
};

/**
 * A present Rating_State_Signal read as a Wire_Enum_Name (Requirement 12.8).
 *
 * Handed to `readOptional` by the member parser, because an absent rating state
 * is a state the backend reports rather than a mismatch.
 */
const readRatingStateValue: ValueReader<RatingState> = (value, label) =>
  readWireEnumName(value, label, isRatingState);

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
 * seven validated readings, so a bad field fails the member rather than producing
 * one with that field defaulted (Requirements 12.5, 12.7, 16.4).
 *
 * Requirements: 12.5, 12.7, 12.9, 16.4, 16.8, 16.9
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

  // Required: a defaulted zero would claim a player has never played.
  const appearances = readAppearanceCount(
    readProperty(source.value, 'appearances'),
    'squad member appearances',
  );

  if (!appearances.ok) {
    return appearances;
  }

  // A valid absence: no rating established is a state the backend reports.
  const ratingState = readOptional(
    readProperty(source.value, 'ratingState'),
    'squad member ratingState',
    readRatingStateValue,
  );

  if (!ratingState.ok) {
    return ratingState;
  }

  return ok({
    membershipId: membershipId.value,
    displayName: displayName.value,
    role: role.value,
    state: state.value,
    isGuest: isGuest.value,
    appearances: appearances.value,
    ratingState: ratingState.value,
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
 * accepts: each enum as its Wire_Enum_Name, the appearance count as a number, and
 * an absent rating state as `null`.
 *
 * Requirements: 12.11, 16.5
 */
export function printSquadMember(member: SquadMember): unknown {
  return {
    membershipId: member.membershipId,
    displayName: member.displayName,
    role: member.role,
    state: member.state,
    isGuest: member.isGuest,
    appearances: member.appearances,
    ratingState: member.ratingState,
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
