/**
 * Presentation rules over a match's state and the caller's standing.
 */
import type { SquadStanding } from './parse/responses';
import type { MatchState } from './wireEnums';

/** The label a person reads for each state. */
export const MATCH_STATE_LABELS: Readonly<Record<MatchState, string>> = {
  GatheringAvailability: 'Gathering availability',
  Confirmed: 'Confirmed',
  TeamsRolled: 'Teams locked',
  InProgress: 'In progress',
  Completed: 'Completed',
  Cancelled: 'Cancelled',
};

/**
 * True when the caller may organise matches in the squad: an active membership
 * whose role is owner or admin. An absent standing, an inactive one, and a
 * member's role all answer `false`. The backend enforces the same rule; this only
 * decides which controls are offered.
 */
export function isOrganiser(standing: SquadStanding | null): boolean {
  if (standing === null || standing.state !== 'Active') {
    return false;
  }

  return standing.role === 'Owner' || standing.role === 'Admin';
}

/** True while members can still mark and change their availability. */
export function isGatheringAvailability(state: MatchState): boolean {
  return state === 'GatheringAvailability';
}
