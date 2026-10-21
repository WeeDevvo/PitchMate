import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { formatDay } from '../lib/matchDays';
import { MATCH_STATE_LABELS } from '../lib/matchState';
import {
  AT_THRESHOLD_LABEL,
  AVAILABILITY_CLEARED_STATEMENT,
  AVAILABILITY_SAVED_STATEMENT,
  BELOW_THRESHOLD_LABEL,
  CLEAR_AVAILABILITY_LABEL,
  GUEST_LABEL,
  MATCH_NOT_FOUND_STATEMENT,
  ORGANISER_READY_STATEMENT,
  REJECTION_MESSAGES,
  SAVE_AVAILABILITY_LABEL,
  tallyCountLabel,
} from '../lib/messages';
import { MATCH_ROUTE, matchPath } from '../lib/routePaths';
import {
  DAY_ISO,
  DAY_MS,
  MATCH_ID,
  MEMBER,
  OTHER_SQUAD_ID,
  SQUAD_ID,
  fakeMatchesApi,
  matchDetail,
  renderAtRoute,
  success,
  tally,
} from '../testing/matchesFixtures';
import { MatchScreen } from './MatchScreen';

vi.mock('../../app-shell', async () => {
  const actual = await vi.importActual<typeof import('../../app-shell')>('../../app-shell');
  return { ...actual, usePublishSquadScopeFromRoute: (): string | null => null };
});

function renderScreen(api = fakeMatchesApi(), path = matchPath(SQUAD_ID, MATCH_ID)) {
  renderAtRoute(<MatchScreen api={api} />, MATCH_ROUTE, path);
  return api;
}

describe('MatchScreen while gathering availability', () => {
  it('names the match and its state', async () => {
    renderScreen();

    expect(await screen.findByRole('heading', { level: 1, name: 'Riverside 5s, pitch 2' })).toBeTruthy();
    expect(screen.getByText(MATCH_STATE_LABELS.GatheringAvailability)).toBeTruthy();
  });

  it('ticks the days the caller already marked', async () => {
    renderScreen();

    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes.map((box) => (box as HTMLInputElement).checked)).toEqual([false, true, false]);
    expect(screen.getByLabelText(formatDay(DAY_MS[1]))).toBeTruthy();
  });

  it('saves the ticked days as the exact candidate instants, then re-reads', async () => {
    const api = renderScreen();

    await userEvent.click(await screen.findByLabelText(formatDay(DAY_MS[2])));
    await userEvent.click(screen.getByRole('button', { name: SAVE_AVAILABILITY_LABEL }));

    expect(api.submitAvailability).toHaveBeenCalledWith(
      SQUAD_ID,
      MATCH_ID,
      [DAY_ISO[1], DAY_ISO[2]],
      expect.any(AbortSignal),
    );
    expect(await screen.findByText(AVAILABILITY_SAVED_STATEMENT)).toBeTruthy();
    expect(api.getMatch).toHaveBeenCalledTimes(2);
    expect(api.getAvailabilityTally).toHaveBeenCalledTimes(2);
  });

  it('clears a stored response and unticks every day', async () => {
    const api = renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: CLEAR_AVAILABILITY_LABEL }));

    expect(api.clearAvailability).toHaveBeenCalledWith(SQUAD_ID, MATCH_ID, expect.any(AbortSignal));
    expect(await screen.findByText(AVAILABILITY_CLEARED_STATEMENT)).toBeTruthy();
    expect(
      screen.getAllByRole('checkbox').every((box) => !(box as HTMLInputElement).checked),
    ).toBe(true);
  });

  it('offers no clear control before the caller has responded', async () => {
    renderScreen(
      fakeMatchesApi({
        getMatch: async () =>
          success(matchDetail({ callerAvailability: { hasStoredResponse: false, markedDaysMs: [] } })),
      }),
    );

    await screen.findAllByRole('checkbox');
    expect(screen.queryByRole('button', { name: CLEAR_AVAILABILITY_LABEL })).toBeNull();
  });

  it('states a rejected save in words', async () => {
    renderScreen(
      fakeMatchesApi({
        submitAvailability: async () => ({ kind: 'rejected', reason: 'invalid-state' }),
      }),
    );

    await userEvent.click(await screen.findByRole('button', { name: SAVE_AVAILABILITY_LABEL }));
    expect(await screen.findByText(REJECTION_MESSAGES['invalid-state'])).toBeTruthy();
  });

  it('shows each day’s count against the threshold, in words', async () => {
    renderScreen();

    const days = await screen.findAllByText(/needed$/);
    expect(days.map((day) => day.textContent)).toEqual([
      tallyCountLabel(4, 10),
      tallyCountLabel(10, 10),
      tallyCountLabel(0, 10),
    ]);

    const ready = days[1].closest('li') as HTMLElement;
    expect(within(ready).getByText(AT_THRESHOLD_LABEL)).toBeTruthy();
    expect(within(days[0].closest('li') as HTMLElement).getByText(BELOW_THRESHOLD_LABEL)).toBeTruthy();
  });

  it('tells an organiser when a day is ready', async () => {
    renderScreen();
    expect(await screen.findByText(ORGANISER_READY_STATEMENT)).toBeTruthy();
  });

  it('tells a member nothing about readiness', async () => {
    renderScreen(fakeMatchesApi({ getSquadStanding: async () => success(MEMBER) }));

    await screen.findAllByText(/needed$/);
    expect(screen.queryByText(ORGANISER_READY_STATEMENT)).toBeNull();
  });

  it('tells an organiser nothing while no day is ready', async () => {
    renderScreen(fakeMatchesApi({ getAvailabilityTally: async () => success(tally([1, 2, 3])) }));

    await screen.findAllByText(/needed$/);
    expect(screen.queryByText(ORGANISER_READY_STATEMENT)).toBeNull();
  });
});

describe('MatchScreen once confirmed', () => {
  it('shows the confirmed day and the players in roster order, without the availability form', async () => {
    const api = renderScreen(
      fakeMatchesApi({
        getMatch: async () =>
          success(
            matchDetail({
              state: 'Confirmed',
              confirmedDayMs: DAY_MS[1],
              participantCount: 2,
              participants: [
                { membershipId: SQUAD_ID, displayName: 'Robin', isGuest: true, rosterPosition: 1 },
                { membershipId: MATCH_ID, displayName: 'Alex', isGuest: false, rosterPosition: 0 },
              ],
            }),
          ),
      }),
    );

    const players = await screen.findByRole('list');
    expect(within(players).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Alex',
      `Robin${GUEST_LABEL}`,
    ]);
    expect(screen.getByText(formatDay(DAY_MS[1]))).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(api.getAvailabilityTally).not.toHaveBeenCalled();
  });
});

describe('MatchScreen concealment', () => {
  it('states not found for a match the caller cannot see', async () => {
    renderScreen(fakeMatchesApi({ getMatch: async () => ({ kind: 'not-found' }) }));
    expect(await screen.findByText(MATCH_NOT_FOUND_STATEMENT)).toBeTruthy();
  });

  it('states not found for a match addressed under another squad', async () => {
    renderScreen(fakeMatchesApi(), matchPath(OTHER_SQUAD_ID, MATCH_ID));
    expect(await screen.findByText(MATCH_NOT_FOUND_STATEMENT)).toBeTruthy();
  });

  it('states not found for a route identity that is not one, and asks nothing', async () => {
    const api = renderScreen(fakeMatchesApi(), matchPath(SQUAD_ID, 'not-an-identity'));

    expect(await screen.findByText(MATCH_NOT_FOUND_STATEMENT)).toBeTruthy();
    expect(api.getMatch).not.toHaveBeenCalled();
  });
});
