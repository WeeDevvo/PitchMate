/**
 * Where a match stands in the admin's create-match flow: each state before kickoff
 * names a step of `MATCH_FLOW_STEPS` (locked teams have finished every step), and
 * a match that has started, finished or been cancelled is past the flow.
 */
import { describe, expect, it } from 'vitest';

import { MATCH_FLOW_STEPS } from './messages';
import { setupStepOf } from './matchState';
import { MATCH_STATE_NAMES } from './wireEnums';

describe('setupStepOf', () => {
  it('names a step for each state before kickoff, in lifecycle order, and none after', () => {
    expect(setupStepOf('GatheringAvailability')).toBe(MATCH_FLOW_STEPS.indexOf('Availability'));
    expect(setupStepOf('Confirmed')).toBe(MATCH_FLOW_STEPS.indexOf('Players'));
    expect(setupStepOf('TeamsRolled')).toBe(MATCH_FLOW_STEPS.length);
    expect(setupStepOf('InProgress')).toBeNull();
    expect(setupStepOf('Completed')).toBeNull();
    expect(setupStepOf('Cancelled')).toBeNull();
  });

  it('answers within the flow for every wire state', () => {
    for (const state of MATCH_STATE_NAMES) {
      const step = setupStepOf(state);
      expect(step === null || (step >= 0 && step <= MATCH_FLOW_STEPS.length)).toBe(true);
    }
  });
});
