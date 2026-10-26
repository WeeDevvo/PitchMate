import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CallResult } from '../api/matchesApi';
import {
  ADD_PLAYER_LABEL,
  ADD_PLAYER_SUBMIT_LABEL,
  GENERIC_MATCHES_FAILURE,
  JOIN_MATCH_LABEL,
  LEAVE_MATCH_LABEL,
  NO_PLAYERS_TO_ADD,
  NOT_PLAYING_STATEMENT,
  PLAYING_STATEMENT,
  REJECTION_MESSAGES,
  guestOptionLabel,
  removeParticipantLabel,
} from '../lib/messages';
import type { SquadPlayer } from '../lib/parse/teams';
import { PLAYERS, participants } from '../testing/matchesFixtures';
import { ParticipantsPanel } from './ParticipantsPanel';

/**
 * Example tests for the player list: everyone sees who is playing; a member
 * joins or leaves themselves with one call each, seeing which applies; and an
 * organiser removes anyone and adds any active member or guest who isn't
 * already playing, with guests labelled.
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

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Player 1',
      'Player 2',
    ]);
    expect(screen.queryByRole('button')).toBeNull();
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

  it('removes a player, then tells the screen', async () => {
    const editing = renderEditing();

    await userEvent.click(screen.getByRole('button', { name: removeParticipantLabel('Player 2') }));

    expect(editing.remove).toHaveBeenCalledWith(
      participants(3)[1].membershipId,
      expect.any(AbortSignal),
    );
    expect(editing.onSettled).toHaveBeenCalledTimes(1);
  });

  it('adds a registered member as readily as a guest, labelling the guests', async () => {
    const editing = renderEditing();

    const select = screen.getByLabelText(ADD_PLAYER_LABEL);
    expect([...select.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      guestOptionLabel('Guest Gary'),
      'Member Mo',
    ]);

    await userEvent.selectOptions(select, 'Member Mo');
    await userEvent.click(screen.getByRole('button', { name: ADD_PLAYER_SUBMIT_LABEL }));

    expect(editing.addParticipant).toHaveBeenCalledWith(
      '0198e2a7-6666-7a5e-9c2f-6b1d4a5e7f09',
      expect.any(AbortSignal),
    );
  });

  it('offers nobody who is already playing', () => {
    renderEditing([{ membershipId: participants(3)[0].membershipId, displayName: 'Player 1', isGuest: false }]);
    expect(screen.getByText(NO_PLAYERS_TO_ADD)).toBeTruthy();
    expect(screen.queryByLabelText(ADD_PLAYER_LABEL)).toBeNull();
  });

  it('states players that could not be loaded', () => {
    renderEditing('failed');
    expect(screen.getByText(GENERIC_MATCHES_FAILURE)).toBeTruthy();
  });

  it('states a refused change', async () => {
    renderEditing(PLAYERS, {
      addParticipant: vi.fn(async (): Promise<CallResult<void>> => ({ kind: 'rejected', reason: 'conflict' })),
    });

    await userEvent.click(screen.getByRole('button', { name: ADD_PLAYER_SUBMIT_LABEL }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', REJECTION_MESSAGES.conflict);
  });
});
