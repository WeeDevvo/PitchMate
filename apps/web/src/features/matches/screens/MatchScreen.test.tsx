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
  CONFIRM_HEADING,
  CONFIRM_LABEL,
  MATCH_NOT_FOUND_STATEMENT,
  NO_DAY_READY_STATEMENT,
  PARTICIPANTS_HEADING,
  RELOCK_TEAMS_LABEL,
  TEAM_SHEET_HEADING,
  TEAMS_HEADING,
  REJECTION_MESSAGES,
  SAVE_AVAILABILITY_LABEL,
  tallyCountLabel,
} from '../lib/messages';
import { MATCH_ROUTE, matchPath } from '../lib/routePaths';
import {
  confirmedMatch,
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

  it('offers an organiser only the days that have reached the threshold, and confirms one', async () => {
    const api = renderScreen();

    const panel = (await screen.findByRole('heading', { name: CONFIRM_HEADING })).closest(
      'section',
    ) as HTMLElement;
    const choices = within(panel).getAllByRole('radio');
    expect(choices).toHaveLength(1);
    expect((choices[0] as HTMLInputElement).checked).toBe(true);
    expect(within(panel).getByText(formatDay(DAY_MS[1]))).toBeTruthy();

    await userEvent.click(within(panel).getByRole('button', { name: CONFIRM_LABEL }));

    expect(api.confirmMatch).toHaveBeenCalledWith(
      SQUAD_ID,
      MATCH_ID,
      DAY_ISO[1],
      expect.any(AbortSignal),
    );
    await expect.poll(() => api.getMatch.mock.calls.length).toBe(2);
  });

  it('offers a member no confirm step', async () => {
    renderScreen(fakeMatchesApi({ getSquadStanding: async () => success(MEMBER) }));

    await screen.findAllByText(/needed$/);
    expect(screen.queryByRole('heading', { name: CONFIRM_HEADING })).toBeNull();
  });

  it('tells an organiser no day is ready yet', async () => {
    renderScreen(fakeMatchesApi({ getAvailabilityTally: async () => success(tally([1, 2, 3])) }));

    expect(await screen.findByText(NO_DAY_READY_STATEMENT)).toBeTruthy();
    expect(screen.queryByRole('button', { name: CONFIRM_LABEL })).toBeNull();
  });

  it('states a confirm the backend refuses', async () => {
    renderScreen(
      fakeMatchesApi({
        confirmMatch: async () => ({ kind: 'rejected', reason: 'threshold-not-met' }),
      }),
    );

    await userEvent.click(await screen.findByRole('button', { name: CONFIRM_LABEL }));
    expect(await screen.findByText(REJECTION_MESSAGES['threshold-not-met'])).toBeTruthy();
  });
});

describe('MatchScreen once confirmed', () => {
  it('shows a member the confirmed day and the players in roster order, and nothing to edit', async () => {
    const api = renderScreen(
      fakeMatchesApi({
        getSquadStanding: async () => success(MEMBER),
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
    expect(screen.queryByRole('heading', { name: TEAMS_HEADING })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
    expect(api.getAvailabilityTally).not.toHaveBeenCalled();
    expect(api.getWorkingTeams).not.toHaveBeenCalled();
    expect(api.getSquadGuests).not.toHaveBeenCalled();
  });

  it('gives an organiser the players and the teams editor', async () => {
    const api = renderScreen(fakeMatchesApi({ getMatch: async () => success(confirmedMatch()) }));

    expect(await screen.findByRole('heading', { name: TEAMS_HEADING })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Remove Player 1' })).toBeTruthy();
    await expect.poll(() => api.getWorkingTeams.mock.calls[0]?.[0]).toBe(MATCH_ID);
    await expect.poll(() => api.getSquadGuests.mock.calls[0]?.[0]).toBe(SQUAD_ID);
  });

  it('shows a member the team sheet once locked, in place of the player list', async () => {
    const api = renderScreen(
      fakeMatchesApi({
        getSquadStanding: async () => success(MEMBER),
        getMatch: async () => success(confirmedMatch(10, { state: 'TeamsRolled' })),
      }),
    );

    expect(await screen.findByRole('heading', { name: TEAM_SHEET_HEADING })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: PARTICIPANTS_HEADING })).toBeNull();
    expect(screen.queryByRole('heading', { name: TEAMS_HEADING })).toBeNull();
    await expect.poll(() => api.getTeamSheet.mock.calls[0]?.[0]).toBe(MATCH_ID);
  });

  it('keeps showing the sheet after the match has started or finished', async () => {
    for (const state of ['InProgress', 'Completed'] as const) {
      const { unmount } = renderAtRoute(
        <MatchScreen
          api={fakeMatchesApi({ getMatch: async () => success(confirmedMatch(10, { state })) })}
        />,
        MATCH_ROUTE,
        matchPath(SQUAD_ID, MATCH_ID),
      );
      expect(await screen.findByRole('heading', { name: TEAM_SHEET_HEADING })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: TEAMS_HEADING })).toBeNull();
      unmount();
    }
  });

  it('re-reads the sheet after an organiser re-locks', async () => {
    const api = renderScreen(
      fakeMatchesApi({ getMatch: async () => success(confirmedMatch(10, { state: 'TeamsRolled' })) }),
    );

    await screen.findByRole('heading', { name: TEAM_SHEET_HEADING });
    await userEvent.click(await screen.findByRole('button', { name: RELOCK_TEAMS_LABEL }));

    await expect.poll(() => api.getTeamSheet.mock.calls.length).toBe(2);
  });

  it('stops offering participant changes once the teams are locked', async () => {
    const api = renderScreen(
      fakeMatchesApi({ getMatch: async () => success(confirmedMatch(10, { state: 'TeamsRolled' })) }),
    );

    expect(await screen.findByRole('heading', { name: TEAMS_HEADING })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove Player 1' })).toBeNull();
    expect(api.getSquadGuests).not.toHaveBeenCalled();
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
