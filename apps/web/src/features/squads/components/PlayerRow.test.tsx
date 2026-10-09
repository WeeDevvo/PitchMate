/**
 * Worked examples for the Player_Row (task 11.3).
 *
 * The generated claims arrive with `PlayerRow.property.test.tsx` (Property 16) and
 * `PlayerRow.seam.property.test.tsx` (Property 24). This file pins what a reader
 * wants stated plainly: the order the row renders its parts in, that the one
 * navigation control is named by the player and targets the path `playerStatsPath`
 * builds, that a Former_Player keeps that control and loses both admin controls,
 * that neither admin control exists for a caller without Admin_Authority, and that
 * each of the three Rating_Presentations reaches the row.
 *
 * Requirements: 7.5, 7.6, 7.7, 7.8, 9.1, 9.4, 9.5, 9.8, 19.3
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  PLAYER_ROW_EDIT_GUEST_SELECTOR,
  PLAYER_ROW_OPEN_SELECTOR,
  PLAYER_ROW_PROMOTE_SELECTOR,
  PLAYER_ROW_SELECTOR,
  PLAYER_ROW_STATS_PATH_ATTRIBUTE,
  PlayerRow,
  type ViewerContext,
} from './PlayerRow';
import { MEMBERSHIP_LABEL_SELECTOR } from './MembershipLabels';
import { RATING_BADGE_KIND_ATTRIBUTE, RATING_BADGE_SELECTOR } from './RatingBadge';
import { ANONYMISED_PLACEHOLDER, type PlayerListRow } from '../lib/playerList';
import {
  EDIT_GUEST_LABEL,
  PROMOTE_TO_ADMIN_LABEL,
  PROVISIONAL_BAND_LABEL,
  RATING_UNAVAILABLE_LABEL,
} from '../lib/messages';
import { playerStatsPath } from '../lib/routePaths';

const SQUAD_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f01';
const MEMBERSHIP_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f02';
const VIEWER_MEMBERSHIP_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f03';

/** An active registered member with a settled rating. */
const rowOf = (overrides: Partial<PlayerListRow> = {}): PlayerListRow => ({
  membershipId: MEMBERSHIP_ID,
  displayName: 'Dave',
  role: 'Member',
  state: 'Active',
  isGuest: false,
  appearances: 12,
  ratingState: 'Established',
  isFormerPlayer: false,
  leaderboardObtained: true,
  ratingEntry: { membershipId: MEMBERSHIP_ID, displayName: 'Dave', value: 1240.4 },
  ...overrides,
});

const viewerOf = (overrides: Partial<ViewerContext> = {}): ViewerContext => ({
  membershipId: VIEWER_MEMBERSHIP_ID,
  isAdmin: false,
  ...overrides,
});

interface Rendered {
  readonly container: HTMLElement;
  readonly onOpenPlayer: ReturnType<typeof vi.fn>;
  readonly onPromote: ReturnType<typeof vi.fn>;
  readonly onEditGuest: ReturnType<typeof vi.fn>;
  readonly unmount: () => void;
}

function renderRow(
  row: PlayerListRow = rowOf(),
  viewer: ViewerContext = viewerOf(),
): Rendered {
  const onOpenPlayer = vi.fn();
  const onPromote = vi.fn();
  const onEditGuest = vi.fn();

  const { container, unmount } = render(
    <PlayerRow
      squadId={SQUAD_ID}
      row={row}
      viewer={viewer}
      onOpenPlayer={onOpenPlayer}
      onPromote={onPromote}
      onEditGuest={onEditGuest}
    />,
  );

  return { container, onOpenPlayer, onPromote, onEditGuest, unmount };
}

/** The position of the first node matching `selector` among the row's descendants. */
function positionOf(container: HTMLElement, selector: string): number {
  const nodes = [...container.querySelectorAll('*')];
  const match = container.querySelector(selector);

  expect(match, `nothing matched ${selector}`).not.toBeNull();

  return nodes.indexOf(match as Element);
}

describe('PlayerRow', () => {
  // Requirements: 7.5, 8.5, 9.1
  it('renders the navigation control, then the labels, then the rating, then the admin controls', () => {
    const { container } = renderRow(
      rowOf({ role: null, isGuest: true }),
      viewerOf({ isAdmin: true }),
    );

    const open = positionOf(container, PLAYER_ROW_OPEN_SELECTOR);
    const labels = positionOf(container, MEMBERSHIP_LABEL_SELECTOR);
    const rating = positionOf(container, RATING_BADGE_SELECTOR);
    const editGuest = positionOf(container, PLAYER_ROW_EDIT_GUEST_SELECTOR);

    expect(open).toBeLessThan(labels);
    expect(labels).toBeLessThan(rating);
    expect(rating).toBeLessThan(editGuest);
  });

  // Requirements: 9.1, 9.5
  it('renders exactly one navigation control, named by the player', () => {
    const { container } = renderRow();

    expect(container.querySelectorAll(PLAYER_ROW_OPEN_SELECTOR)).toHaveLength(1);

    const open = screen.getByRole('button', { name: 'Dave' });
    expect(open.tagName).toBe('BUTTON');
    expect(open.getAttribute('type')).toBe('button');
    // 9.4: no link default and no location assignment, so no full-document reload
    // is possible from this row.
    expect(open.hasAttribute('href')).toBe(false);
    expect(container.querySelector('a')).toBeNull();
  });

  // Requirements: 9.1, 9.2
  it('targets the Player_Stats_Route path built for its own identities', () => {
    const { container } = renderRow();

    expect(
      container
        .querySelector(PLAYER_ROW_OPEN_SELECTOR)
        ?.getAttribute(PLAYER_ROW_STATS_PATH_ATTRIBUTE),
    ).toBe(playerStatsPath(SQUAD_ID, MEMBERSHIP_ID));
  });

  // Requirements: 9.1, 9.4
  it('opens its own player on pointer activation, Enter, and Space', async () => {
    const activations: readonly (readonly [string, (open: HTMLElement) => Promise<void>])[] =
      [
        ['pointer', async (open) => userEvent.click(open)],
        [
          'Enter',
          async (open) => {
            open.focus();
            await userEvent.keyboard('{Enter}');
          },
        ],
        [
          'Space',
          async (open) => {
            open.focus();
            await userEvent.keyboard(' ');
          },
        ],
      ];

    for (const [name, activate] of activations) {
      const rendered = renderRow();

      await activate(screen.getByRole('button', { name: 'Dave' }));

      expect(
        rendered.onOpenPlayer,
        `${name} must open the player exactly once`,
      ).toHaveBeenCalledTimes(1);
      expect(rendered.onOpenPlayer).toHaveBeenCalledWith(MEMBERSHIP_ID);
      rendered.unmount();
    }
  });

  // Requirements: 19.6
  it('is a group named by the player, so every value in it belongs to that player', () => {
    renderRow();

    expect(screen.getByRole('group')).toHaveAccessibleName('Dave');
  });

  // Requirements: 7.7
  it('carries its Membership_State on the row, and keeps an inactive row navigable', () => {
    const { container } = renderRow(rowOf({ state: 'Inactive' }));

    expect(
      container.querySelector(PLAYER_ROW_SELECTOR)?.getAttribute('data-membership-state'),
    ).toBe('Inactive');
    expect(container.querySelectorAll(PLAYER_ROW_OPEN_SELECTOR)).toHaveLength(1);
  });

  // Requirements: 7.8, 9.8
  it('keeps the navigation control on a Former_Player row and offers no admin action', () => {
    const { container } = renderRow(
      rowOf({
        displayName: ANONYMISED_PLACEHOLDER,
        isFormerPlayer: true,
        isGuest: true,
        appearances: 12,
        ratingState: 'Established',
        role: null,
      }),
      viewerOf({ isAdmin: true }),
    );

    expect(container.querySelectorAll(PLAYER_ROW_OPEN_SELECTOR)).toHaveLength(1);
    expect(container.querySelector(PLAYER_ROW_PROMOTE_SELECTOR)).toBeNull();
    expect(container.querySelector(PLAYER_ROW_EDIT_GUEST_SELECTOR)).toBeNull();
  });

  // Requirements: 10.3, 13.1
  it('renders no admin control for a caller without Admin_Authority', () => {
    const { container } = renderRow(rowOf(), viewerOf({ isAdmin: false }));

    expect(container.querySelector(PLAYER_ROW_PROMOTE_SELECTOR)).toBeNull();
    expect(container.querySelector(PLAYER_ROW_EDIT_GUEST_SELECTOR)).toBeNull();
  });

  // Requirements: 13.1, 13.4
  it('offers promotion on an eligible row, naming the player, and hands the activation on', async () => {
    const rendered = renderRow(rowOf(), viewerOf({ isAdmin: true }));

    const promote = screen.getByRole('button', {
      name: `${PROMOTE_TO_ADMIN_LABEL}: Dave`,
    });
    expect(promote).toHaveTextContent(PROMOTE_TO_ADMIN_LABEL);

    await userEvent.click(promote);

    expect(rendered.onPromote).toHaveBeenCalledTimes(1);
    expect(rendered.onPromote).toHaveBeenCalledWith(MEMBERSHIP_ID);
    // The row performs the promotion nowhere: the guest edit path is untouched.
    expect(rendered.onEditGuest).not.toHaveBeenCalled();
  });

  // Requirements: 13.2
  it('offers no promotion on the caller’s own row, an owner, a guest, or an inactive membership', () => {
    const ineligible: readonly (readonly [string, PlayerListRow])[] = [
      ['own membership', rowOf({ membershipId: VIEWER_MEMBERSHIP_ID })],
      ['Owner', rowOf({ role: 'Owner' })],
      ['Admin', rowOf({ role: 'Admin' })],
      ['guest', rowOf({ role: null, isGuest: true })],
      ['Inactive', rowOf({ state: 'Inactive' })],
    ];

    for (const [name, row] of ineligible) {
      const { container, unmount } = renderRow(row, viewerOf({ isAdmin: true }));

      expect(
        container.querySelector(PLAYER_ROW_PROMOTE_SELECTOR),
        `${name} must offer no Promotion_Control`,
      ).toBeNull();
      unmount();
    }
  });

  // Requirements: 12.7
  it('offers the guest edit action on a guest row and on no registered membership', async () => {
    const rendered = renderRow(
      rowOf({ role: null, isGuest: true }),
      viewerOf({ isAdmin: true }),
    );

    await userEvent.click(
      screen.getByRole('button', { name: `${EDIT_GUEST_LABEL}: Dave` }),
    );

    expect(rendered.onEditGuest).toHaveBeenCalledTimes(1);
    expect(rendered.onEditGuest).toHaveBeenCalledWith(MEMBERSHIP_ID);
    rendered.unmount();

    const registered = renderRow(rowOf(), viewerOf({ isAdmin: true }));

    expect(
      registered.container.querySelector(PLAYER_ROW_EDIT_GUEST_SELECTOR),
    ).toBeNull();
  });

  // Requirements: 8.1, 8.3, 8.5
  it('renders the row’s one Rating_Presentation from the rating data it carries', () => {
    const cases: readonly (readonly [PlayerListRow, string, string])[] = [
      // The entry's value, rounded upstream, as a plain decimal integer.
      [rowOf(), 'rating', '1240'],
      // No entry for this membership: a band, and no number.
      [
        rowOf({ ratingEntry: null }),
        'provisional',
        PROVISIONAL_BAND_LABEL,
      ],
      // No leaderboard at all: the same label on every row.
      [
        rowOf({ leaderboardObtained: false, ratingEntry: null }),
        'unavailable',
        RATING_UNAVAILABLE_LABEL,
      ],
    ];

    for (const [row, kind, text] of cases) {
      const { container, unmount } = renderRow(row);
      const badges = container.querySelectorAll(RATING_BADGE_SELECTOR);

      expect(badges, `${kind} must be the row's only presentation`).toHaveLength(1);
      expect(badges[0].getAttribute(RATING_BADGE_KIND_ATTRIBUTE)).toBe(kind);
      expect(badges[0]).toHaveTextContent(text);
      unmount();
    }
  });
});
