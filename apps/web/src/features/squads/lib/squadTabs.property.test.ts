/**
 * The Squad_Screen's tabs: every tab's address reads back as that tab, for any
 * squad identity (however it encodes) and with or without a trailing separator;
 * the squad's own address is the Players tab; and the Admin tab is offered to an
 * admin and absent for anyone else, every other tab offered to both.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { squadPath } from './routePaths';
import { SQUAD_TABS, squadTabOf, squadTabPath, squadTabsFor } from './squadTabs';

describe('squadTabs', () => {
  it('reads every tab back from its own address, for any squad identity', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.constantFrom(...SQUAD_TABS), fc.boolean(), (squadId, tab, slash) => {
        const path = squadTabPath(squadId, tab);
        expect(squadTabOf(slash ? `${path}/` : path)).toBe(tab);
      }),
      { numRuns: 300 },
    );
  });

  it('never mistakes a squad identity that spells a tab name for that tab', () => {
    for (const squadId of ['matches', 'leaderboards', 'admin', 'squads']) {
      expect(squadTabOf(squadTabPath(squadId, 'players'))).toBe('players');
      expect(squadTabOf(squadTabPath(squadId, 'leaderboards'))).toBe('leaderboards');
    }
  });

  it('puts the Players tab at the squad own address', () => {
    fc.assert(
      fc.property(fc.uuid(), (squadId) => {
        expect(squadTabPath(squadId, 'players')).toBe(squadPath(squadId));
        expect(squadTabPath(squadId, 'admin')).toBe(`${squadPath(squadId)}/admin`);
      }),
      { numRuns: 100 },
    );
  });

  it('offers the Admin tab to an admin only, and every other tab to everyone', () => {
    expect(squadTabsFor(true)).toEqual(['players', 'matches', 'leaderboards', 'admin']);
    expect(squadTabsFor(false)).toEqual(['players', 'matches', 'leaderboards']);
  });
});
