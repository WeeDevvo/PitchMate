import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CallResult } from '../api/matchesApi';
import {
  CLEAR_GUEST_AVAILABILITY_LABEL,
  GENERIC_MATCHES_FAILURE,
  GUEST_AVAILABILITY_CLEARED_STATEMENT,
  GUEST_AVAILABILITY_NO_GUESTS,
  GUEST_AVAILABILITY_NOT_MARKED,
  GUEST_AVAILABILITY_SAVED_STATEMENT,
  GUESTS_LOADING_LABEL,
  REJECTION_MESSAGES,
  SAVE_GUEST_AVAILABILITY_LABEL,
} from '../lib/messages';
import { formatDay } from '../lib/matchDays';
import type { GuestAvailability } from '../lib/parse/matchDetail';
import type { SquadGuest } from '../lib/parse/teams';
import { DAY_ISO, DAY_MS } from '../testing/matchesFixtures';
import { GuestAvailabilityPanel } from './GuestAvailabilityPanel';

/**
 * Example tests for the organiser's guest-availability panel: one row per
 * guest, pre-ticked from what was marked before; saving sends exactly the
 * ticked days for that guest and nobody else; clearing withdraws them; each
 * write tells the screen to re-read; and a refused write, a squad with no
 * guests, and a guest list still loading or failed each say so.
 */

const GARY: SquadGuest = { membershipId: '0198e2a7-6666-7a5e-9c2f-6b1d4a5e7f01', displayName: 'Guest Gary' };
const GINA: SquadGuest = { membershipId: '0198e2a7-6666-7a5e-9c2f-6b1d4a5e7f02', displayName: 'Guest Gina' };

const ok = async (): Promise<CallResult<void>> => ({ kind: 'success', value: undefined });

function renderPanel({
  guests = [GARY, GINA] as readonly SquadGuest[] | null | 'failed',
  marked = [{ membershipId: GINA.membershipId, markedDaysMs: [DAY_MS[2]!] }] as readonly GuestAvailability[],
  submit = vi.fn(ok),
  clear = vi.fn(ok),
} = {}) {
  const onSettled = vi.fn();
  render(
    <GuestAvailabilityPanel
      candidateDaysMs={DAY_MS}
      guests={guests}
      marked={marked}
      submit={submit}
      clear={clear}
      onSettled={onSettled}
    />,
  );
  return { submit, clear, onSettled };
}

function row(guest: SquadGuest): HTMLElement {
  return screen.getByRole('group', { name: guest.displayName }).closest('li') as HTMLElement;
}

function dayBox(guest: SquadGuest, dayIndex: number): HTMLInputElement {
  return within(row(guest)).getByRole('checkbox', { name: formatDay(DAY_MS[dayIndex]!) });
}

describe('GuestAvailabilityPanel', () => {
  it('shows each guest with what was marked before', () => {
    renderPanel();

    expect(dayBox(GARY, 0).checked).toBe(false);
    expect(within(row(GARY)).getByText(GUEST_AVAILABILITY_NOT_MARKED)).toBeTruthy();
    expect(dayBox(GINA, 2).checked).toBe(true);
    expect(within(row(GINA)).queryByText(GUEST_AVAILABILITY_NOT_MARKED)).toBeNull();
    // Only a guest with something marked can have it cleared.
    expect(within(row(GARY)).queryByRole('button', { name: `${CLEAR_GUEST_AVAILABILITY_LABEL}, ${GARY.displayName}` })).toBeNull();
  });

  it("saves exactly the ticked days for that guest, then tells the screen", async () => {
    const { submit, onSettled } = renderPanel();

    await userEvent.click(dayBox(GARY, 1));
    await userEvent.click(dayBox(GARY, 0));
    await userEvent.click(screen.getByRole('button', { name: `${SAVE_GUEST_AVAILABILITY_LABEL}, ${GARY.displayName}` }));

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(GARY.membershipId, [DAY_ISO[0], DAY_ISO[1]], expect.any(AbortSignal));
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(within(row(GARY)).getByText(GUEST_AVAILABILITY_SAVED_STATEMENT)).toBeTruthy();
    expect(within(row(GINA)).queryByText(GUEST_AVAILABILITY_SAVED_STATEMENT)).toBeNull();
  });

  it('clears what was marked for a guest', async () => {
    const { clear, onSettled } = renderPanel();

    await userEvent.click(screen.getByRole('button', { name: `${CLEAR_GUEST_AVAILABILITY_LABEL}, ${GINA.displayName}` }));

    expect(clear).toHaveBeenCalledWith(GINA.membershipId, expect.any(AbortSignal));
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(dayBox(GINA, 2).checked).toBe(false);
    expect(within(row(GINA)).getByText(GUEST_AVAILABILITY_CLEARED_STATEMENT)).toBeTruthy();
  });

  it('states a save the backend refuses', async () => {
    renderPanel({ submit: vi.fn(async (): Promise<CallResult<void>> => ({ kind: 'rejected', reason: 'invalid-state' })) });

    await userEvent.click(screen.getByRole('button', { name: `${SAVE_GUEST_AVAILABILITY_LABEL}, ${GARY.displayName}` }));

    expect(within(row(GARY)).getByText(REJECTION_MESSAGES['invalid-state'])).toBeTruthy();
  });

  it('says when the squad has no guests, while they load, and when they fail to load', () => {
    for (const [guests, text] of [
      [[], GUEST_AVAILABILITY_NO_GUESTS],
      [null, GUESTS_LOADING_LABEL],
      ['failed', GENERIC_MATCHES_FAILURE],
    ] as const) {
      const view = render(
        <GuestAvailabilityPanel
          candidateDaysMs={DAY_MS}
          guests={guests}
          marked={[]}
          submit={vi.fn(ok)}
          clear={vi.fn(ok)}
          onSettled={vi.fn()}
        />,
      );
      expect(screen.getByText(text)).toBeTruthy();
      expect(screen.queryByRole('checkbox')).toBeNull();
      view.unmount();
    }
  });
});
