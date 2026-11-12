import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CallResult } from '../api/matchesApi';
import {
  AVAILABILITY_CLEARED_STATEMENT,
  AVAILABILITY_SAVED_STATEMENT,
  AVAILABILITY_UNCHANGED_STATEMENT,
  CLEAR_AVAILABILITY_LABEL,
  GENERIC_MATCHES_FAILURE,
  GUEST_AVAILABILITY_NO_GUESTS,
  GUESTS_LOADING_LABEL,
  MOST_PLAYERS_LABEL,
  REJECTION_MESSAGES,
  SAVE_AVAILABILITY_LABEL,
  YOU_LABEL,
  availabilityCellLabel,
  bestDayStatement,
  clearGuestAvailabilityLabel,
  tallyCountLabel,
} from '../lib/messages';
import { formatDay } from '../lib/matchDays';
import type { CallerAvailability, GuestAvailability } from '../lib/parse/matchDetail';
import type { DayTally } from '../lib/parse/responses';
import type { SquadGuest } from '../lib/parse/teams';
import { DAY_ISO, DAY_MS } from '../testing/matchesFixtures';
import { AvailabilityPanel, type GuestAnswers } from './AvailabilityPanel';

/**
 * Example tests for the "Who can play" grid: the caller's row and, for an
 * organiser, a row per guest, each pre-ticked from what was stored; a day left
 * unticked reads as "can't" once someone has answered and "no reply" before;
 * one save sends exactly the answers that changed, as the exact candidate
 * instants, then tells the screen to re-read; clearing withdraws an answer; the
 * best-attended day is named; and a refused write, a squad with no guests, and
 * a guest list still loading or failed each say so.
 */

const GARY: SquadGuest = { membershipId: '0198e2a7-6666-7a5e-9c2f-6b1d4a5e7f01', displayName: 'Guest Gary' };
const GINA: SquadGuest = { membershipId: '0198e2a7-6666-7a5e-9c2f-6b1d4a5e7f02', displayName: 'Guest Gina' };

const ok = async (): Promise<CallResult<void>> => ({ kind: 'success', value: undefined });

const NOT_ANSWERED: CallerAvailability = { hasStoredResponse: false, markedDaysMs: [] };

function renderPanel({
  availability = NOT_ANSWERED,
  tally = null as readonly DayTally[] | null,
  guestList = [GARY, GINA] as GuestAnswers['guests'],
  marked = [{ membershipId: GINA.membershipId, markedDaysMs: [DAY_MS[2]!] }] as readonly GuestAvailability[],
  organiser = true,
  submit = vi.fn(ok),
  clear = vi.fn(ok),
  submitGuest = vi.fn(ok),
  clearGuest = vi.fn(ok),
} = {}) {
  const onSettled = vi.fn();
  render(
    <AvailabilityPanel
      candidateDaysMs={DAY_MS}
      availability={availability}
      tally={tally}
      submit={submit}
      clear={clear}
      guests={organiser ? { guests: guestList, marked, submit: submitGuest, clear: clearGuest } : undefined}
      onSettled={onSettled}
    />,
  );
  return { submit, clear, submitGuest, clearGuest, onSettled };
}

function cell(name: string, dayIndex: number): HTMLInputElement {
  return screen.getByRole('checkbox', { name: availabilityCellLabel(name, formatDay(DAY_MS[dayIndex]!)) });
}

const save = () => userEvent.click(screen.getByRole('button', { name: SAVE_AVAILABILITY_LABEL }));

describe('AvailabilityPanel', () => {
  it('pre-ticks each row from what was stored, reading unanswered days as no reply', () => {
    renderPanel();

    expect(cell(YOU_LABEL, 0).checked).toBe(false);
    expect(cell(GARY.displayName, 0).checked).toBe(false);
    expect(cell(GINA.displayName, 2).checked).toBe(true);
    // Neither the caller nor Gary has answered; Gina has, so her other days are "can't".
    expect(cell(YOU_LABEL, 0).closest('td')).toHaveClass('is-unknown');
    expect(cell(GARY.displayName, 0).closest('td')).toHaveClass('is-unknown');
    expect(cell(GINA.displayName, 0).closest('td')).toHaveClass('is-no');
    // Only a guest with something marked can have it cleared.
    expect(screen.queryByRole('button', { name: clearGuestAvailabilityLabel(GARY.displayName) })).toBeNull();
    expect(screen.getByRole('button', { name: clearGuestAvailabilityLabel(GINA.displayName) })).toBeTruthy();
  });

  it('gives a member their own row only', () => {
    renderPanel({ organiser: false });

    expect(cell(YOU_LABEL, 1)).toBeTruthy();
    expect(screen.queryByText(GARY.displayName)).toBeNull();
  });

  it('sends exactly the answers that changed in one save, then tells the screen', async () => {
    const { submit, submitGuest, onSettled } = renderPanel();

    await userEvent.click(cell(YOU_LABEL, 1));
    await userEvent.click(cell(GARY.displayName, 1));
    await userEvent.click(cell(GARY.displayName, 0));
    await save();

    expect(submit).toHaveBeenCalledWith([DAY_ISO[1]], expect.any(AbortSignal));
    expect(submitGuest).toHaveBeenCalledTimes(1);
    expect(submitGuest).toHaveBeenCalledWith(GARY.membershipId, [DAY_ISO[0], DAY_ISO[1]], expect.any(AbortSignal));
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(screen.getByText(AVAILABILITY_SAVED_STATEMENT)).toBeTruthy();
  });

  it('sends nothing when nothing changed, and says so', async () => {
    const { submit, submitGuest, onSettled } = renderPanel();

    await userEvent.click(cell(GINA.displayName, 0));
    await userEvent.click(cell(GINA.displayName, 0));
    await save();

    expect(submit).not.toHaveBeenCalled();
    expect(submitGuest).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
    expect(screen.getByText(AVAILABILITY_UNCHANGED_STATEMENT)).toBeTruthy();
  });

  it("clears the caller's response, and a guest's", async () => {
    const { clear, clearGuest, onSettled } = renderPanel({
      availability: { hasStoredResponse: true, markedDaysMs: [DAY_MS[0]!] },
    });

    await userEvent.click(screen.getByRole('button', { name: CLEAR_AVAILABILITY_LABEL }));
    expect(clear).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(cell(YOU_LABEL, 0).checked).toBe(false);
    expect(screen.getByText(AVAILABILITY_CLEARED_STATEMENT)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: clearGuestAvailabilityLabel(GINA.displayName) }));
    expect(clearGuest).toHaveBeenCalledWith(GINA.membershipId, expect.any(AbortSignal));
    expect(onSettled).toHaveBeenCalledTimes(2);
  });

  it('states a save the backend refuses', async () => {
    renderPanel({
      submit: vi.fn(async (): Promise<CallResult<void>> => ({ kind: 'rejected', reason: 'invalid-state' })),
    });

    await userEvent.click(cell(YOU_LABEL, 0));
    await save();

    expect(screen.getByText(REJECTION_MESSAGES['invalid-state'])).toBeTruthy();
  });

  it('totals each day and names the best one', () => {
    renderPanel({
      tally: [
        { dayMs: DAY_MS[0]!, count: 2 },
        { dayMs: DAY_MS[1]!, count: 5 },
      ],
    });

    expect(screen.getByText(bestDayStatement([formatDay(DAY_MS[1]!)]))).toBeTruthy();
    expect(screen.getByText(`${tallyCountLabel(5)}, ${MOST_PLAYERS_LABEL}`)).toBeTruthy();
    expect(screen.getByText(tallyCountLabel(0))).toBeTruthy();
  });

  it('says when the squad has no guests, while they load, and when they fail to load', () => {
    for (const [guestList, text] of [
      [[], GUEST_AVAILABILITY_NO_GUESTS],
      [null, GUESTS_LOADING_LABEL],
      ['failed', GENERIC_MATCHES_FAILURE],
    ] as const) {
      const view = render(
        <AvailabilityPanel
          candidateDaysMs={DAY_MS}
          availability={NOT_ANSWERED}
          tally={null}
          submit={vi.fn(ok)}
          clear={vi.fn(ok)}
          guests={{ guests: guestList, marked: [], submit: vi.fn(ok), clear: vi.fn(ok) }}
          onSettled={vi.fn()}
        />,
      );
      expect(screen.getByText(text)).toBeTruthy();
      // The caller's own row is all there is.
      expect(screen.getAllByRole('checkbox')).toHaveLength(DAY_MS.length);
      view.unmount();
    }
  });
});
