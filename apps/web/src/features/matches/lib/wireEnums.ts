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

/* -------------------------------------------------------------------------- */
/* Live tracking: event kinds, per-event outcomes and the squad feature flag   */
/* -------------------------------------------------------------------------- */

export type EventKind = Exclude<components['schemas']['EventKind'], null>;

export const EVENT_KIND_NAMES = [
  'GoalScored',
  'GoalRetracted',
  'KeeperStintStarted',
  'KeeperStintRetracted',
] as const satisfies WireEnumNames<EventKind>;

export function isEventKind(candidate: unknown): candidate is EventKind {
  return isWireEnumName(EVENT_KIND_NAMES, candidate);
}

export type EventOutcome = Exclude<components['schemas']['EventOutcome'], null>;

export const EVENT_OUTCOME_NAMES = ['Applied', 'Duplicate', 'Rejected'] as const satisfies WireEnumNames<EventOutcome>;

export function isEventOutcome(candidate: unknown): candidate is EventOutcome {
  return isWireEnumName(EVENT_OUTCOME_NAMES, candidate);
}

export type SquadFeature = Exclude<components['schemas']['SquadFeature'], null>;

export const SQUAD_FEATURE_NAMES = ['LiveMatchTracking'] as const satisfies WireEnumNames<SquadFeature>;

export function isSquadFeature(candidate: unknown): candidate is SquadFeature {
  return isWireEnumName(SQUAD_FEATURE_NAMES, candidate);
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
  EventKind: {} satisfies UncoveredNames<EventKind, typeof EVENT_KIND_NAMES>,
  EventOutcome: {} satisfies UncoveredNames<EventOutcome, typeof EVENT_OUTCOME_NAMES>,
  SquadFeature: {} satisfies UncoveredNames<SquadFeature, typeof SQUAD_FEATURE_NAMES>,
} as const;
