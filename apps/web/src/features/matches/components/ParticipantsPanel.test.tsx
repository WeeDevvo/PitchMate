import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CallResult } from '../api/matchesApi';
import {
  GENERIC_MATCHES_FAILURE,
  JOIN_MATCH_LABEL,
  LEAVE_MATCH_LABEL,
  NOT_PLAYING_STATEMENT,
  PLAYING_STATEMENT,
  REJECTION_MESSAGES,
  WHO_IS_PLAYING_LEGEND,
  playingCountLabel,
} from '../lib/messages';
import type { SquadPlayer } from '../lib/parse/teams';
import { PLAYERS, participants } from '../testing/matchesFixtures';
import { ParticipantsPanel } from './ParticipantsPanel';

/**
 * Example tests for the player list: everyone sees who is playing; a member
 * joins or leaves themselves with one call each, seeing which applies; and an
 * organiser sees the whole squad as a tick list, players first, where ticking
 * adds a member or guest and unticking removes them, with guests labelled.
 */

const ok = async (): Promise<CallResult<void>> => ({ kind: 'success', value: undefined });

function renderEditing(players: readonly SquadPlayer[] | null | 'failed' = PLAYERS, overrides = {}) {
  const editing = {
    players,
    addParticipant: vi.fn(ok),
    remove: vi.fn(ok),
    onSettled: vi.fn(),
    ...overrides,
  };
  render(<ParticipantsPanel participants={participants(3)} editing={editing} />);
  return editing;
}

function renderSelf(isParticipant: boolean) {
  const self = { isParticipant, join: vi.fn(ok), leave: vi.fn(ok), onSettled: vi.fn() };
  render(<ParticipantsPanel participants={participants(2)} self={self} />);
  return self;
}

describe('ParticipantsPanel', () => {
  it('lists players without controls when the caller can change nothing', () => {
    render(<ParticipantsPanel participants={participants(2)} />);

    expect(screen.getAllByRole('listitem').map((item) => item.querySelector('.pm-player__name')?.textContent)).toEqual([
      'Player 1',
      'Player 2',
    ]);
    expect(screen.getByText(playingCountLabel(2))).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('lets a member who is not playing join, with one call, then tells the screen', async () => {
    const self = renderSelf(false);

    expect(screen.getByText(NOT_PLAYING_STATEMENT)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: JOIN_MATCH_LABEL }));

    expect(self.join).toHaveBeenCalledTimes(1);
    expect(self.leave).not.toHaveBeenCalled();
    expect(self.onSettled).toHaveBeenCalledTimes(1);
  });

  it('lets a member who is playing leave instead', async () => {
    const self = renderSelf(true);

    expect(screen.getByText(PLAYING_STATEMENT)).toBeTruthy();
    expect(screen.queryByRole('button', { name: JOIN_MATCH_LABEL })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: LEAVE_MATCH_LABEL }));

    expect(self.leave).toHaveBeenCalledTimes(1);
    expect(self.join).not.toHaveBeenCalled();
  });

  it('ticks the players, then the rest of the squad, labelling the guests', () => {
    renderEditing();

    const group = screen.getByRole('group', { name: WHO_IS_PLAYING_LEGEND });
    const boxes = within(group).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((box) => [box.labels?.[0]?.textContent, box.checked])).toEqual([
      ['Player 1', true],
      ['Player 2', true],
      ['Player 3', true],
      ['Guest Gary', false],
      ['Member Mo', false],
    ]);
    const gary = screen.getByRole('checkbox', { name: 'Guest Gary' }).closest('li') as HTMLElement;
    expect(within(gary).getByText('Guest')).toBeTruthy();
  });

  it('removes a player on unticking, then tells the screen', async () => {
    const editing = renderEditing();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Player 2' }));

    expect(editing.remove).toHaveBeenCalledWith(participants(3)[1].membershipId, expect.any(AbortSignal));
    expect(editing.addParticipant).not.toHaveBeenCalled();
    expect(editing.onSettled).toHaveBeenCalledTimes(1);
    // The tick holds until the re-read list arrives.
    expect(screen.getByRole('checkbox', { name: 'Player 2' })).not.toBeChecked();
  });

  it('adds a registered member as readily as a guest on ticking', async () => {
    const editing = renderEditing();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Member Mo' }));

    expect(editing.addParticipant).toHaveBeenCalledWith(
      '0198e2a7-6666-7a5e-9c2f-6b1d4a5e7f09',
      expect.any(AbortSignal),
    );
    expect(editing.remove).not.toHaveBeenCalled();
  });

  it('lists a player once when the squad list has them too', () => {
    renderEditing([{ membershipId: participants(3)[0].membershipId, displayName: 'Player 1', isGuest: false }]);
    expect(screen.getAllByRole('checkbox', { name: 'Player 1' })).toHaveLength(1);
  });

  it('states players that could not be loaded', () => {
    renderEditing('failed');
    expect(screen.getByText(GENERIC_MATCHES_FAILURE)).toBeTruthy();
  });

  it('states a refused change', async () => {
    renderEditing(PLAYERS, {
      addParticipant: vi.fn(async (): Promise<CallResult<void>> => ({ kind: 'rejected', reason: 'conflict' })),
    });

    await userEvent.click(screen.getByRole('checkbox', { name: 'Guest Gary' }));
    expect((await screen.findByRole('alert')).textContent).toContain(REJECTION_MESSAGES.conflict);
    // A refused tick goes back.
    expect(screen.getByRole('checkbox', { name: 'Guest Gary' })).not.toBeChecked();
  });
});
