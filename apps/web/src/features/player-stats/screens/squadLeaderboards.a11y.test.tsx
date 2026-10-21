import { axe } from 'jest-axe';
import { afterEach, describe, expect, it } from 'vitest';

import type { CallResult } from '../api/playerStatsApi';
import type { Leaderboard } from '../lib/parse/leaderboard';
import { THEMES, applyTheme, resetTheme } from '../testing/playerStatsScreenStates';
import {
  boardOf,
  renderLeaderboards,
  stubLeaderboardApi,
  success,
} from '../testing/squadLeaderboardsHarness';

/**
 * The squad leaderboards section has no WCAG 2.1 A or AA violation in any of
 * its states (loading, loaded, empty, failed), in either theme.
 *
 * jsdom computes no colour, so contrast is not measured here; the token tables
 * and their contrast floors are pinned by the feature's own token tests.
 */

const WCAG_A_AND_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const STATES: readonly {
  readonly name: string;
  readonly outcome: () => CallResult<Leaderboard> | Promise<CallResult<Leaderboard>>;
}[] = [
  { name: 'loading', outcome: () => new Promise(() => undefined) },
  { name: 'loaded', outcome: () => success(boardOf('DisplayRating', [1200, 1100, 1100])) },
  { name: 'empty', outcome: () => success(boardOf('DisplayRating', [])) },
  { name: 'failed', outcome: () => ({ kind: 'transport-failure' }) },
];

afterEach(() => {
  resetTheme();
});

describe('squad leaderboards accessibility', () => {
  for (const theme of THEMES) {
    for (const state of STATES) {
      it(`has no violation when ${state.name}, in the ${theme} theme`, async () => {
        applyTheme(theme);
        const { api } = stubLeaderboardApi(state.outcome);

        const { container } = await renderLeaderboards(api);
        const results = await axe(container, {
          runOnly: { type: 'tag', values: WCAG_A_AND_AA_TAGS },
        });

        // Not vacuous: rules were evaluated against a rendered tree.
        expect(results.passes.length + results.incomplete.length).toBeGreaterThan(0);
        expect(results).toHaveNoViolations();
      });
    }
  }
});
