import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CallResult } from '../api/matchesApi';
import {
  ADD_GUEST_LABEL,
  ADD_GUEST_SUBMIT_LABEL,
  GENERIC_MATCHES_FAILURE,
  NO_GUESTS_TO_ADD,
  REJECTION_MESSAGES,
  removeParticipantLabel,
} from '../lib/messages';
import type { SquadGuest } from '../lib/parse/teams';
import { GUESTS, participants } from '../testing/matchesFixtures';
import { ParticipantsPanel } from './ParticipantsPanel';

const ok = async (): Promise<CallResult<void>> => ({ kind: 'success', value: undefined });

function renderPanel(guests: readonly SquadGuest[] | null | 'failed' = GUESTS, overrides = {}) {
  const editing = {
    guests,
    addGuest: vi.fn(ok),
    remove: vi.fn(ok),
    onSettled: vi.fn(),
    ...overrides,
  };
  render(<ParticipantsPanel participants={participants(3)} editing={editing} />);
  return editing;
}

describe('ParticipantsPanel', () => {
  it('lists players without controls when not editing', () => {
    render(<ParticipantsPanel participants={participants(2)} />);

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Player 1',
      'Player 2',
    ]);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('removes a player, then tells the screen', async () => {
    const editing = renderPanel();

    await userEvent.click(screen.getByRole('button', { name: removeParticipantLabel('Player 2') }));

    expect(editing.remove).toHaveBeenCalledWith(
      participants(3)[1].membershipId,
      expect.any(AbortSignal),
    );
    expect(editing.onSettled).toHaveBeenCalledTimes(1);
  });

  it('adds the chosen guest', async () => {
    const editing = renderPanel([
      ...GUESTS,
      { membershipId: '0198e2a7-6666-7a5e-9c2f-6b1d4a5e7f02', displayName: 'Guest Gina' },
    ]);

    await userEvent.selectOptions(screen.getByLabelText(ADD_GUEST_LABEL), 'Guest Gina');
    await userEvent.click(screen.getByRole('button', { name: ADD_GUEST_SUBMIT_LABEL }));

    expect(editing.addGuest).toHaveBeenCalledWith(
      '0198e2a7-6666-7a5e-9c2f-6b1d4a5e7f02',
      expect.any(AbortSignal),
    );
  });

  it('offers no guest who is already playing', () => {
    renderPanel([{ membershipId: participants(3)[0].membershipId, displayName: 'Player 1' }]);
    expect(screen.getByText(NO_GUESTS_TO_ADD)).toBeTruthy();
    expect(screen.queryByLabelText(ADD_GUEST_LABEL)).toBeNull();
  });

  it('states guests that could not be loaded', () => {
    renderPanel('failed');
    expect(screen.getByText(GENERIC_MATCHES_FAILURE)).toBeTruthy();
  });

  it('states a refused change', async () => {
    renderPanel(GUESTS, {
      addGuest: vi.fn(async (): Promise<CallResult<void>> => ({ kind: 'rejected', reason: 'conflict' })),
    });

    await userEvent.click(screen.getByRole('button', { name: ADD_GUEST_SUBMIT_LABEL }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', REJECTION_MESSAGES.conflict);
  });
});
