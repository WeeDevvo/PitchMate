/**
 * The wire enums the Matches_Feature reads, each as a name list pinned to the
 * generated union in both directions.
 *
 * `satisfies` keeps every listed name inside the union, and the coverage record
 * at the foot of the module fails `tsc -b` when the union gains a name the list
 * lacks, so a new backend member cannot reach the screen unrecognised. Enums
 * cross the wire as their C# member names.
 */
import type { components } from '@pitchmate/api-client';

type WireEnumNames<TName extends string> = readonly [TName, ...TName[]];

type UncoveredNames<
  TUnion extends string,
  TNames extends readonly string[],
> = Record<Exclude<TUnion, TNames[number]>, never>;

function isWireEnumName<TName extends string>(
  names: readonly TName[],
  candidate: unknown,
): candidate is TName {
  return names.some((name) => name === candidate);
}

/* -------------------------------------------------------------------------- */
/* MatchState                                                                 */
/* -------------------------------------------------------------------------- */

export type MatchState = Exclude<components['schemas']['MatchState'], null>;

export const MATCH_STATE_NAMES = [
  'GatheringAvailability',
  'Confirmed',
  'TeamsRolled',
  'InProgress',
  'Completed',
  'Cancelled',
] as const satisfies WireEnumNames<MatchState>;

export function isMatchState(candidate: unknown): candidate is MatchState {
  return isWireEnumName(MATCH_STATE_NAMES, candidate);
}

/* -------------------------------------------------------------------------- */
/* SquadRole and MembershipState (the caller's own standing, for organiser    */
/* controls)                                                                  */
/* -------------------------------------------------------------------------- */

export type SquadRole = Exclude<components['schemas']['SquadRole'], null>;

export const SQUAD_ROLE_NAMES = [
  'Owner',
  'Admin',
  'Member',
] as const satisfies WireEnumNames<SquadRole>;

export function isSquadRole(candidate: unknown): candidate is SquadRole {
  return isWireEnumName(SQUAD_ROLE_NAMES, candidate);
}

export type MembershipState = Exclude<
  components['schemas']['MembershipState'],
  null
>;

export const MEMBERSHIP_STATE_NAMES = [
  'Active',
  'Inactive',
] as const satisfies WireEnumNames<MembershipState>;

export function isMembershipState(
  candidate: unknown,
): candidate is MembershipState {
  return isWireEnumName(MEMBERSHIP_STATE_NAMES, candidate);
}

/* -------------------------------------------------------------------------- */
/* ResultFidelity                                                             */
/* -------------------------------------------------------------------------- */

export type ResultFidelity = Exclude<components['schemas']['ResultFidelity'], null>;

export const RESULT_FIDELITY_NAMES = ['Basic', 'Rich'] as const satisfies WireEnumNames<ResultFidelity>;

export function isResultFidelity(candidate: unknown): candidate is ResultFidelity {
  return isWireEnumName(RESULT_FIDELITY_NAMES, candidate);
}

/** Compile-time proof that every list covers its whole generated union. */
export const WIRE_ENUM_COVERAGE = {
  MatchState: {} satisfies UncoveredNames<MatchState, typeof MATCH_STATE_NAMES>,
  SquadRole: {} satisfies UncoveredNames<SquadRole, typeof SQUAD_ROLE_NAMES>,
  MembershipState: {} satisfies UncoveredNames<
    MembershipState,
    typeof MEMBERSHIP_STATE_NAMES
  >,
  ResultFidelity: {} satisfies UncoveredNames<ResultFidelity, typeof RESULT_FIDELITY_NAMES>,
} as const;
