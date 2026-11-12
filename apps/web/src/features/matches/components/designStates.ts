/**
 * Each wire match state as the design system's state chip names it. The chip
 * takes the feature's own words through `MATCH_STATE_LABELS`; this only picks its
 * icon and colour.
 */
import type { MatchStateName } from '../../../ui';
import type { MatchState } from '../lib/wireEnums';

export const DESIGN_STATES: Readonly<Record<MatchState, MatchStateName>> = {
  GatheringAvailability: 'gathering',
  Confirmed: 'confirmed',
  TeamsRolled: 'rolled',
  InProgress: 'live',
  Completed: 'completed',
  Cancelled: 'cancelled',
};
