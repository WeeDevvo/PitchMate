/**
 * The Players tab has no WCAG 2.1 A or AA violation, in either theme: its chips
 * and search, the list under a filter, and a row's "…" menu open on an admin's
 * view with its controls showing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';

import { PlayersPanel } from './PlayersPanel';
import type { ViewerContext } from './PlayerRow';
import type { PlayerListRow } from '../lib/playerList';
import { THEMES, applyTheme, resetTheme } from '../testing/squadsScreenStates';

const WCAG_A_AND_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const SQUAD_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f01';

const rowOf = (
  membershipId: string,
  displayName: string,
  overrides: Partial<PlayerListRow> = {},
): PlayerListRow => ({
  membershipId,
  displayName,
  role: 'Member',
  state: 'Active',
  isGuest: false,
  appearances: 12,
  ratingState: 'Established',
  isFormerPlayer: false,
  leaderboardObtained: false,
  ratingEntry: null,
  ...overrides,
});

const ROWS: readonly PlayerListRow[] = [
  rowOf('0198e2a7-1c8e-7a5e-9c2f-000000000001', 'Aisha Bello'),
  rowOf('0198e2a7-1c8e-7a5e-9c2f-000000000002', 'Big Mike', { role: null, isGuest: true }),
];

const admin: ViewerContext = { membershipId: null, isAdmin: true };

async function expectNoWcagViolations(container: HTMLElement): Promise<void> {
  const results = await axe(container, { runOnly: { type: 'tag', values: WCAG_A_AND_AA_TAGS } });
  expect(results).toHaveNoViolations();
}

afterEach(() => {
  cleanup();
  resetTheme();
});

describe('the Players tab', () => {
  for (const theme of THEMES) {
    it(`under a filter, with a row menu open, in the ${theme} theme`, async () => {
      applyTheme(theme);
      const user = userEvent.setup();
      const { container } = render(
        <PlayersPanel
          squadId={SQUAD_ID}
          rows={ROWS}
          viewer={admin}
          onOpenPlayer={vi.fn()}
          onPromote={vi.fn()}
          onEditGuest={vi.fn()}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Guests 1' }));
      await user.click(screen.getByRole('button', { name: 'Actions for Big Mike' }));
      expect(screen.getByRole('group', { name: 'Actions for Big Mike' })).toBeInTheDocument();

      await expectNoWcagViolations(container);
    });
  }
});
