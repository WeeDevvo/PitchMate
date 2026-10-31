import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { formatDay } from '../lib/matchDays';
import { MATCH_STATE_LABELS } from '../lib/matchState';
import type { MatchesApi } from '../api/matchesApi';
import type { MatchDetail } from '../lib/parse/matchDetail';
import {
  CANCEL_MATCH_LABEL,
  COMPLETE_MATCH_LABEL,
  COMPLETE_NEEDS_RESULT_STATEMENT,
  CONFIRM_CANCEL_LABEL,
  CONFIRM_COMPLETE_LABEL,
  FINAL_RESULT_LABEL,
  KEEP_MATCH_LABEL,
  MATCH_CANCELLED_STATEMENT,
  OUTCOME_LABELS,
  PROVISIONAL_RESULT_LABEL,
  RESULT_SAVED_STATEMENT,
  SAVE_RESULT_LABEL,
  SCORE_INPUT_PROBLEM,
  START_MATCH_LABEL,
  UNLOCKED_CHANGES_STATEMENT,
  scoreLabel,
  AVAILABILITY_CLEARED_STATEMENT,
  AVAILABILITY_SAVED_STATEMENT,
  CLEAR_AVAILABILITY_LABEL,
  GUEST_LABEL,
  YOU_LABEL,
  availabilityCellLabel,
  bestDayStatement,
  CONFIRM_HEADING,
  JOIN_MATCH_LABEL,
  LEAVE_MATCH_LABEL,
  MOST_PLAYERS_LABEL,
  CONFIRM_LABEL,
  CONFIRM_DAY_BUTTON_LABEL,
  CONFIRM_FEW_PLAYERS_WARNING,
  confirmDialogBody,
  confirmDialogTitle,
  MATCH_NOT_FOUND_STATEMENT,
  PARTICIPANTS_HEADING,
  RELOCK_TEAMS_LABEL,
  TEAM_SHEET_HEADING,
  TEAMS_HEADING,
  REJECTION_MESSAGES,
  SAVE_AVAILABILITY_LABEL,
  tallyCountLabel,
  STATE_LABEL,
  MATCH_FLOW_STEPS_LABEL,
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
  SQUAD_NAME,
  fakeMatchesApi,
  matchDetail,
  renderAtRoute,
  success,
  tally,
  teamSheet,
  workingTeams,
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

/** The caller's own grid cell for a candidate day. */
async function ownDay(dayIndex: number): Promise<HTMLInputElement> {
  return screen.findByRole('checkbox', { name: availabilityCellLabel(YOU_LABEL, formatDay(DAY_MS[dayIndex])) });
}

/** The day totals under the grid, in day order. */
async function dayTotals(): Promise<HTMLElement[]> {
  return within(await screen.findByRole('table')).findAllByText(/^\d+ can play(, .*)?$/);
}

describe('MatchScreen while gathering availability', () => {
  it('names the match and its state', async () => {
    renderScreen();

    expect(await screen.findByRole('heading', { level: 1, name: 'Riverside 5s, pitch 2' })).toBeTruthy();
    expect(screen.getByText(MATCH_STATE_LABELS.GatheringAvailability)).toBeTruthy();
  });

  it('shows an organiser the flow at step 2 under the squad name', async () => {
    renderScreen();

    const steps = await screen.findByRole('list', { name: MATCH_FLOW_STEPS_LABEL });
    expect(steps.querySelector('[aria-current="step"]')?.textContent).toBe('2. Availability');
    expect(screen.getByText(SQUAD_NAME)).toBeTruthy();
  });

  it('shows a member no flow steps', async () => {
    renderScreen(fakeMatchesApi({ getSquadStanding: async () => success(MEMBER) }));

    await dayTotals();
    expect(screen.queryByRole('list', { name: MATCH_FLOW_STEPS_LABEL })).toBeNull();
  });

  it('ticks the days the caller already marked', async () => {
    renderScreen();

    // The caller's own row; an organiser also has a row per guest.
    const own = await Promise.all([0, 1, 2].map(ownDay));
    expect(own.map((box) => box.checked)).toEqual([false, true, false]);
  });

  it('saves the ticked days as the exact candidate instants, then re-reads', async () => {
    const api = renderScreen();

    await userEvent.click(await ownDay(2));
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
    const own = await Promise.all([0, 1, 2].map(ownDay));
    expect(own.every((box) => !box.checked)).toBe(true);
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

    await userEvent.click(await ownDay(0));
    await userEvent.click(screen.getByRole('button', { name: SAVE_AVAILABILITY_LABEL }));
    expect(await screen.findByText(REJECTION_MESSAGES['invalid-state'])).toBeTruthy();
  });

  it('shows how many can make each day, in words, marking the best-attended day', async () => {
    renderScreen();

    const tallied = await dayTotals();
    expect(tallied.map((day) => day.textContent)).toEqual([
      tallyCountLabel(4),
      `${tallyCountLabel(10)}, ${MOST_PLAYERS_LABEL}`,
      tallyCountLabel(0),
    ]);
    expect(screen.getByText(bestDayStatement([formatDay(DAY_MS[1])]))).toBeTruthy();
  });

  it('offers an organiser every day, defaulting to the best-attended, and confirms the one chosen', async () => {
    const api = renderScreen();

    const panel = (await screen.findByRole('heading', { name: CONFIRM_HEADING })).closest(
      'section',
    ) as HTMLElement;
    const choices = within(panel).getAllByRole('radio') as HTMLInputElement[];
    expect(choices).toHaveLength(3);
    expect(choices.map((choice) => choice.checked)).toEqual([false, true, false]);

    // A day with fewer players can still be chosen; the dialog names it and warns it is short.
    await userEvent.click(choices[0]!);
    await userEvent.click(within(panel).getByRole('button', { name: CONFIRM_DAY_BUTTON_LABEL }));
    const dialog = screen.getByRole('dialog', { name: confirmDialogTitle(formatDay(DAY_MS[0])) });
    expect(within(dialog).getByText(confirmDialogBody(4))).toBeTruthy();
    expect(within(dialog).getByText(CONFIRM_FEW_PLAYERS_WARNING)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: CONFIRM_LABEL }));

    expect(api.confirmMatch).toHaveBeenCalledWith(
      SQUAD_ID,
      MATCH_ID,
      DAY_ISO[0],
      expect.any(AbortSignal),
    );
    await expect.poll(() => api.getMatch.mock.calls.length).toBe(2);
  });

  it('offers a member no confirm step', async () => {
    renderScreen(fakeMatchesApi({ getSquadStanding: async () => success(MEMBER) }));

    await dayTotals();
    expect(screen.queryByRole('heading', { name: CONFIRM_HEADING })).toBeNull();
  });

  it('lets an organiser confirm even when nobody has marked any day', async () => {
    renderScreen(fakeMatchesApi({ getAvailabilityTally: async () => success(tally([0, 0, 0])) }));

    await userEvent.click(await screen.findByRole('button', { name: CONFIRM_DAY_BUTTON_LABEL }));
    expect(screen.getByRole('dialog').querySelector('button')).toBeTruthy();
    expect(screen.getByRole('button', { name: CONFIRM_LABEL })).toBeTruthy();
    expect(screen.queryByText(MOST_PLAYERS_LABEL)).toBeNull();
  });

  it('states a confirm the backend refuses', async () => {
    renderScreen(
      fakeMatchesApi({
        confirmMatch: async () => ({ kind: 'rejected', reason: 'invalid-state' }),
      }),
    );

    await userEvent.click(await screen.findByRole('button', { name: CONFIRM_DAY_BUTTON_LABEL }));
    await userEvent.click(screen.getByRole('button', { name: CONFIRM_LABEL }));
    expect(await screen.findByText(REJECTION_MESSAGES['invalid-state'])).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("lets an organiser mark a guest's days, then re-reads the match and the tally", async () => {
    const api = renderScreen();

    await userEvent.click(
      await screen.findByRole('checkbox', { name: availabilityCellLabel('Guest Gary', formatDay(DAY_MS[0])) }),
    );
    await userEvent.click(screen.getByRole('button', { name: SAVE_AVAILABILITY_LABEL }));

    expect(api.setGuestAvailability).toHaveBeenCalledWith(
      SQUAD_ID,
      MATCH_ID,
      '0198e2a7-6666-7a5e-9c2f-6b1d4a5e7f01',
      [DAY_ISO[0]],
      expect.any(AbortSignal),
    );
    await expect.poll(() => api.getMatch.mock.calls.length).toBe(2);
    await expect.poll(() => api.getAvailabilityTally.mock.calls.length).toBe(2);
  });

  it("shows a member no guests' availability, and reads no guest list", async () => {
    const api = renderScreen(fakeMatchesApi({ getSquadStanding: async () => success(MEMBER) }));

    await dayTotals();
    expect(screen.queryByText('Guest Gary')).toBeNull();
    expect(api.getSquadPlayers).not.toHaveBeenCalled();
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
    expect(
      within(players)
        .getAllByRole('listitem')
        .map((item) => item.querySelector('.pm-player__name')?.textContent),
    ).toEqual(['Alex', `Robin${GUEST_LABEL}`]);
    expect(screen.getByText(formatDay(DAY_MS[1]))).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('heading', { name: TEAMS_HEADING })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
    expect(api.getAvailabilityTally).not.toHaveBeenCalled();
    expect(api.getWorkingTeams).not.toHaveBeenCalled();
    expect(api.getSquadPlayers).not.toHaveBeenCalled();
  });

  it('lets a member who is not playing join a confirmed match, then re-reads it', async () => {
    const api = renderScreen(
      fakeMatchesApi({
        getSquadStanding: async () => success(MEMBER),
        getMatch: async () => success(confirmedMatch(2)),
      }),
    );

    await userEvent.click(await screen.findByRole('button', { name: JOIN_MATCH_LABEL }));

    expect(api.joinMatch).toHaveBeenCalledWith(SQUAD_ID, MATCH_ID, expect.any(AbortSignal));
    await expect.poll(() => api.getMatch.mock.calls.length).toBe(2);
  });

  it('lets a member who is playing leave instead', async () => {
    const api = renderScreen(
      fakeMatchesApi({
        getSquadStanding: async () => success(MEMBER),
        getMatch: async () => success(confirmedMatch(2, { callerIsParticipant: true })),
      }),
    );

    await userEvent.click(await screen.findByRole('button', { name: LEAVE_MATCH_LABEL }));

    expect(api.leaveMatch).toHaveBeenCalledWith(SQUAD_ID, MATCH_ID, expect.any(AbortSignal));
    expect(screen.queryByRole('button', { name: JOIN_MATCH_LABEL })).toBeNull();
  });

  it('gives an organiser the players and the teams editor', async () => {
    const api = renderScreen(fakeMatchesApi({ getMatch: async () => success(confirmedMatch()) }));

    expect(await screen.findByRole('heading', { name: TEAMS_HEADING })).toBeTruthy();
    expect(await screen.findByRole('checkbox', { name: 'Player 1' })).toBeChecked();
    await expect.poll(() => api.getWorkingTeams.mock.calls[0]?.[0]).toBe(MATCH_ID);
    await expect.poll(() => api.getSquadPlayers.mock.calls[0]?.[0]).toBe(SQUAD_ID);
  });

  it('shows a member the team sheet once locked, in place of the player list', async () => {
    const api = renderScreen(
      fakeMatchesApi({
        getSquadStanding: async () => success(MEMBER),
        getMatch: async () => success(confirmedMatch(10, { state: 'TeamsRolled' })),
      }),
    );

    expect(await screen.findByRole('heading', { name: new RegExp(`^${TEAM_SHEET_HEADING}`) })).toBeTruthy();
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
      expect(await screen.findByRole('heading', { name: new RegExp(`^${TEAM_SHEET_HEADING}`) })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: TEAMS_HEADING })).toBeNull();
      unmount();
    }
  });

  it('re-reads the sheet after an organiser re-locks', async () => {
    const api = renderScreen(
      fakeMatchesApi({ getMatch: async () => success(confirmedMatch(10, { state: 'TeamsRolled' })) }),
    );

    await screen.findByRole('heading', { name: new RegExp(`^${TEAM_SHEET_HEADING}`) });
    await userEvent.click(await screen.findByRole('button', { name: RELOCK_TEAMS_LABEL }));

    await expect.poll(() => api.getTeamSheet.mock.calls.length).toBe(2);
  });

  it('stops offering participant changes once the teams are locked', async () => {
    const api = renderScreen(
      fakeMatchesApi({ getMatch: async () => success(confirmedMatch(10, { state: 'TeamsRolled' })) }),
    );

    expect(await screen.findByRole('heading', { name: TEAMS_HEADING })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Player 1' })).toBeNull();
    expect(api.getSquadPlayers).not.toHaveBeenCalled();
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

describe('MatchScreen from kick-off to the final score', () => {
  /**
   * A fake whose match moves on as the organiser acts: start puts it in play,
   * a saved score is kept on the match, and completion stamps it final.
   */
  function playedMatchApi(overrides: Partial<MatchesApi> = {}) {
    let detail: MatchDetail = confirmedMatch(10, { state: 'TeamsRolled' });
    const api = fakeMatchesApi({
      getMatch: async () => success(detail),
      startMatch: async () => {
        detail = { ...detail, state: 'InProgress' };
        return success(undefined);
      },
      recordResult: async (_matchId, teamScores) => {
        detail = { ...detail, recordedResult: { fidelity: 'Basic', teamScores: [...teamScores] } };
        return success(undefined);
      },
      completeMatch: async () => {
        detail = { ...detail, state: 'Completed', completedAtMs: DAY_MS[1] + 3_600_000 };
        return success(undefined);
      },
      cancelMatch: async () => {
        detail = { ...detail, state: 'Cancelled' };
        return success(undefined);
      },
      ...overrides,
    });
    return api;
  }

  it('starts, scores, corrects and completes a match, then shows the final score', async () => {
    const user = userEvent.setup();
    const api = renderScreen(playedMatchApi());
    const [red, blue] = teamSheet().teams;

    await user.click(await screen.findByRole('button', { name: START_MATCH_LABEL }));
    expect(await screen.findByText(MATCH_STATE_LABELS.InProgress)).toBeTruthy();
    expect(screen.queryByRole('button', { name: COMPLETE_MATCH_LABEL })).toBeNull();
    expect(screen.getByText(COMPLETE_NEEDS_RESULT_STATEMENT)).toBeTruthy();

    // An unreadable score is refused before anything is sent.
    await user.type(screen.getByLabelText(scoreLabel(red.teamName, red.bibFlag)), 'x');
    await user.type(screen.getByLabelText(scoreLabel(blue.teamName, blue.bibFlag)), '2');
    await user.click(screen.getByRole('button', { name: SAVE_RESULT_LABEL }));
    expect(screen.getByText(SCORE_INPUT_PROBLEM)).toBeTruthy();
    expect(screen.getByLabelText(scoreLabel(red.teamName, red.bibFlag)).getAttribute('aria-invalid')).toBe('true');
    expect(api.recordResult).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText(scoreLabel(red.teamName, red.bibFlag)));
    await user.type(screen.getByLabelText(scoreLabel(red.teamName, red.bibFlag)), '3');
    await user.click(screen.getByRole('button', { name: SAVE_RESULT_LABEL }));
    expect(await screen.findByText(RESULT_SAVED_STATEMENT)).toBeTruthy();
    expect(api.recordResult).toHaveBeenLastCalledWith(
      MATCH_ID,
      [
        { teamId: red.teamId, score: 3 },
        { teamId: blue.teamId, score: 2 },
      ],
      expect.anything(),
    );
    expect(await screen.findByText(PROVISIONAL_RESULT_LABEL)).toBeTruthy();

    // Completion asks twice, then the score is final and nothing is left to change.
    await user.click(await screen.findByRole('button', { name: COMPLETE_MATCH_LABEL }));
    await user.click(screen.getByRole('button', { name: CONFIRM_COMPLETE_LABEL }));
    expect(await screen.findByText(FINAL_RESULT_LABEL)).toBeTruthy();
    expect(within(screen.getByText(STATE_LABEL).nextElementSibling as HTMLElement).getByText(MATCH_STATE_LABELS.Completed)).toBeTruthy();
    expect(screen.getByText(OUTCOME_LABELS.win)).toBeTruthy();
    expect(screen.getByText(OUTCOME_LABELS.loss)).toBeTruthy();
    expect(screen.queryByRole('button', { name: SAVE_RESULT_LABEL })).toBeNull();
    expect(api.completeMatch).toHaveBeenCalledTimes(1);
  });

  it('does not start a match whose teams were changed after locking, and says why', async () => {
    const changed = workingTeams();
    const api = renderScreen(
      playedMatchApi({
        getWorkingTeams: async () =>
          success({ ...changed, teams: [{ ...changed.teams[0], teamName: 'Renamed' }, changed.teams[1]] }),
      }),
    );

    await userEvent.click(await screen.findByRole('button', { name: START_MATCH_LABEL }));

    expect(await screen.findByText(UNLOCKED_CHANGES_STATEMENT)).toBeTruthy();
    expect(api.startMatch).not.toHaveBeenCalled();
  });

  it('cancels a match only on a second, explicit activation', async () => {
    const user = userEvent.setup();
    const api = renderScreen(playedMatchApi());

    await user.click(await screen.findByRole('button', { name: CANCEL_MATCH_LABEL }));
    await user.click(screen.getByRole('button', { name: KEEP_MATCH_LABEL }));
    expect(api.cancelMatch).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: CANCEL_MATCH_LABEL }));
    await user.click(screen.getByRole('button', { name: CONFIRM_CANCEL_LABEL }));

    expect(await screen.findByText(MATCH_CANCELLED_STATEMENT)).toBeTruthy();
    expect(screen.queryByRole('button', { name: CANCEL_MATCH_LABEL })).toBeNull();
    expect(screen.queryByRole('heading', { name: new RegExp(`^${TEAM_SHEET_HEADING}`) })).toBeNull();
  });

  it('shows a member the score, not yet final while in play, and no controls', async () => {
    const [red, blue] = teamSheet().teams;
    renderScreen(
      fakeMatchesApi({
        getSquadStanding: async () => success(MEMBER),
        getMatch: async () =>
          success(
            confirmedMatch(10, {
              state: 'InProgress',
              recordedResult: {
                fidelity: 'Basic',
                teamScores: [
                  { teamId: blue.teamId, score: 1 },
                  { teamId: red.teamId, score: 1 },
                ],
              },
            }),
          ),
      }),
    );

    expect(await screen.findByText(PROVISIONAL_RESULT_LABEL)).toBeTruthy();
    expect(screen.getAllByText(OUTCOME_LABELS.draw)).toHaveLength(2);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
