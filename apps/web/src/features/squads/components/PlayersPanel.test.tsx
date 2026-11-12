/**
 * The Players tab's filter over the Player_List: the chips name their counts and
 * report which is chosen (`aria-pressed`), a chip narrows the list to its kind,
 * the search narrows it by name, both together narrow to their intersection, the
 * Player_Order is kept throughout, and a filter that leaves nobody says so rather
 * than claiming the squad has no players.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PlayersPanel } from './PlayersPanel';
import { PLAYER_ROW_SELECTOR, type ViewerContext } from './PlayerRow';
import { FIND_PLAYER_LABEL, NO_MATCHING_PLAYERS, NO_PLAYERS_STATEMENT } from '../lib/messages';
import type { PlayerListRow } from '../lib/playerList';

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

const viewer: ViewerContext = { membershipId: null, isAdmin: false };

const ROWS: readonly PlayerListRow[] = [
  rowOf('0198e2a7-1c8e-7a5e-9c2f-000000000003', 'Zoë Hart'),
  rowOf('0198e2a7-1c8e-7a5e-9c2f-000000000001', 'Big Mike', { role: null, isGuest: true }),
  rowOf('0198e2a7-1c8e-7a5e-9c2f-000000000002', 'Aisha Bello'),
];

function renderPanel(rows: readonly PlayerListRow[] = ROWS): HTMLElement {
  const { container } = render(
    <PlayersPanel
      squadId={SQUAD_ID}
      rows={rows}
      viewer={viewer}
      onOpenPlayer={vi.fn()}
      onEditGuest={vi.fn()}
    />,
  );
  return container;
}

/** The names of the rendered rows, in document order. */
function shownNames(container: HTMLElement): readonly string[] {
  return Array.from(container.querySelectorAll<HTMLElement>(PLAYER_ROW_SELECTOR)).map(
    (row) => row.querySelector('.squads-player-row__name')?.textContent ?? '',
  );
}

describe('PlayersPanel', () => {
  it('shows everyone in the Player_Order, with each chip naming its count', () => {
    const container = renderPanel();

    expect(shownNames(container)).toEqual(['Aisha Bello', 'Big Mike', 'Zoë Hart']);
    expect(screen.getByRole('button', { name: 'All 3' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Members 2' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Guests 1' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('narrows to a chip kind, and the search to the names that contain it', async () => {
    const user = userEvent.setup();
    const container = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Guests 1' }));
    expect(shownNames(container)).toEqual(['Big Mike']);
    expect(screen.getByRole('button', { name: 'Guests 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All 3' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: 'Members 2' }));
    await user.type(screen.getByRole('searchbox', { name: FIND_PLAYER_LABEL }), 'zoe');
    expect(shownNames(container)).toEqual(['Zoë Hart']);
  });

  it('says that no player matches when the filter leaves nobody, and that there are none when there are none', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByRole('searchbox', { name: FIND_PLAYER_LABEL }), 'nobody here');
    expect(screen.getByText(NO_MATCHING_PLAYERS)).toBeInTheDocument();
    expect(screen.queryByText(NO_PLAYERS_STATEMENT)).toBeNull();
  });

  it('keeps the squad-has-no-players statement for a squad with nobody in it', () => {
    renderPanel([]);

    expect(screen.getByText(NO_PLAYERS_STATEMENT)).toBeInTheDocument();
    expect(screen.queryByText(NO_MATCHING_PLAYERS)).toBeNull();
  });
});
