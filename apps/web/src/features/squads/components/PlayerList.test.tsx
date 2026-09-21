/**
 * Worked examples for the Player_List (task 11.5).
 *
 * The generated claim about the Player_Order arrives with
 * `PlayerList.property.test.tsx` (Property 15). This file pins what a reader wants
 * stated plainly: the `<ul>` of `<li>` structure, one row per supplied row and no
 * other identity, the three ordering keys on a worked example supplied out of
 * order, that each item holds exactly one group named by its player, that the
 * callbacks reach the right membership, and that an empty row set renders the fixed
 * statement with no list and no error indication.
 *
 * Requirements: 7.4, 7.12, 19.6
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  PLAYER_LIST_EMPTY_SELECTOR,
  PLAYER_LIST_SELECTOR,
  PlayerList,
} from './PlayerList';
import {
  PLAYER_ROW_MEMBERSHIP_ID_ATTRIBUTE,
  PLAYER_ROW_SELECTOR,
  type ViewerContext,
} from './PlayerRow';
import { NO_PLAYERS_STATEMENT } from '../lib/messages';
import type { PlayerListRow } from '../lib/playerList';

const SQUAD_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f01';

/** An active registered member carrying no rating entry, so no leaderboard is needed. */
const rowOf = (
  membershipId: string,
  displayName: string,
  overrides: Partial<PlayerListRow> = {},
): PlayerListRow => ({
  membershipId,
  displayName,
  role: 'member',
  state: 'active',
  isGuest: false,
  isFormerPlayer: false,
  leaderboardObtained: false,
  ratingEntry: null,
  ...overrides,
});

const viewer: ViewerContext = { membershipId: null, isAdmin: false };

interface Rendered {
  readonly container: HTMLElement;
  readonly onOpenPlayer: ReturnType<typeof vi.fn>;
  readonly onPromote: ReturnType<typeof vi.fn>;
  readonly onEditGuest: ReturnType<typeof vi.fn>;
}

function renderList(rows: readonly PlayerListRow[]): Rendered {
  const onOpenPlayer = vi.fn();
  const onPromote = vi.fn();
  const onEditGuest = vi.fn();

  const { container } = render(
    <PlayerList
      squadId={SQUAD_ID}
      rows={rows}
      viewer={viewer}
      onOpenPlayer={onOpenPlayer}
      onPromote={onPromote}
      onEditGuest={onEditGuest}
    />,
  );

  return { container, onOpenPlayer, onPromote, onEditGuest };
}

/** The membership identities of the rendered rows, in rendered order. */
const renderedIdentities = (container: HTMLElement): readonly string[] =>
  [...container.querySelectorAll(PLAYER_ROW_SELECTOR)].map(
    (row) => row.getAttribute(PLAYER_ROW_MEMBERSHIP_ID_ATTRIBUTE) ?? '',
  );

describe('PlayerList', () => {
  // Requirements: 19.6
  it('renders a list of one item per supplied row and no other identity', () => {
    const rows = [rowOf('m-1', 'Ash'), rowOf('m-2', 'Bev'), rowOf('m-3', 'Cal')];

    const { container } = renderList(rows);

    const list = container.querySelector(PLAYER_LIST_SELECTOR);
    expect(list?.tagName).toBe('UL');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(renderedIdentities(container)).toEqual(['m-1', 'm-2', 'm-3']);
    // The statement stands only where the list does not.
    expect(container.querySelector(PLAYER_LIST_EMPTY_SELECTOR)).toBeNull();
  });

  // Requirements: 19.6
  it('gives every item exactly one group named by its own player', () => {
    renderList([rowOf('m-1', 'Ash'), rowOf('m-2', 'Bev')]);

    const items = screen.getAllByRole('listitem');
    const groups = screen.getAllByRole('group');

    expect(groups).toHaveLength(items.length);
    expect(groups[0]).toHaveAccessibleName('Ash');
    expect(groups[1]).toHaveAccessibleName('Bev');
    // Each group is the item's own, so no value inside an item belongs to another
    // player.
    items.forEach((item, index) => {
      expect(item.querySelectorAll('[role="group"]')).toHaveLength(1);
      expect(item.contains(groups[index])).toBe(true);
    });
  });

  // Requirements: 7.4
  it('renders the Player_Order whatever order the rows are supplied in', () => {
    // Supplied deliberately backwards: an inactive membership first, names out of
    // order, and two names differing only in case so the identity tie-break decides.
    const rows = [
      rowOf('m-5', 'Zoe', { state: 'inactive' }),
      rowOf('m-4', 'dave'),
      rowOf('m-3', 'Dave'),
      rowOf('m-2', 'bev'),
      rowOf('m-1', 'Ash', { state: 'inactive' }),
    ];

    const { container } = renderList(rows);

    expect(renderedIdentities(container)).toEqual([
      // Active first, by name case-insensitively, then by identity.
      'm-2', // bev
      'm-3', // Dave
      'm-4', // dave — same name under the collation, later identity
      // Then the inactive memberships, by the same keys.
      'm-1', // Ash
      'm-5', // Zoe
    ]);
  });

  // Requirements: 7.4
  it('leaves the supplied collection unreordered', () => {
    const rows = [rowOf('m-2', 'Zoe'), rowOf('m-1', 'Ash')];

    renderList(rows);

    expect(rows.map((row) => row.membershipId)).toEqual(['m-2', 'm-1']);
  });

  // Requirements: 7.12
  it('renders the fixed no-players statement, and no list and no error indication', () => {
    const { container } = renderList([]);

    expect(screen.getByText(NO_PLAYERS_STATEMENT)).toBeInTheDocument();
    expect(container.querySelector(PLAYER_LIST_SELECTOR)).toBeNull();
    expect(container.querySelectorAll(PLAYER_ROW_SELECTOR)).toHaveLength(0);
    // An absence, not a failure: nothing is announced as a fault and nothing
    // invites a retry.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(container.querySelector('[aria-invalid]')).toBeNull();
  });

  it('hands an activation on with the activated row’s own membership identity', async () => {
    const rendered = renderList([rowOf('m-1', 'Ash'), rowOf('m-2', 'Bev')]);

    await userEvent.click(screen.getByRole('button', { name: 'Bev' }));

    expect(rendered.onOpenPlayer).toHaveBeenCalledTimes(1);
    expect(rendered.onOpenPlayer).toHaveBeenCalledWith('m-2');
    expect(rendered.onPromote).not.toHaveBeenCalled();
    expect(rendered.onEditGuest).not.toHaveBeenCalled();
  });
});
