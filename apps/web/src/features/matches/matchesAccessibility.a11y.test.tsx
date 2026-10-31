/**
 * WCAG 2.1 A and AA audits of every Matches_Feature surface, in both themes.
 *
 * Colour contrast is not audited here: jsdom computes no styles, and the
 * feature declares no colours of its own, taking them from the app-shell's
 * contrast-tested theme tokens.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SQUAD_ROUTE, squadPath } from '../squads';
import { THEME_ATTRIBUTE, applyThemeAttribute, type Theme } from '../../theme';
import { MatchesSection } from './components/MatchesSection';
import {
  CANCEL_MATCH_LABEL,
  CONFIRM_DAY_BUTTON_LABEL,
  COMPLETE_MATCH_LABEL,
  FINAL_RESULT_LABEL,
  LOCATION_LABEL,
  PROVISIONAL_RESULT_LABEL,
  RESULT_FORM_HEADING,
  SAVE_RESULT_LABEL,
  SUBMIT_DRAFT_LABEL,
  addTimeLabel,
  scoreLabel,
} from './lib/messages';
import { MATCH_ROUTE, NEW_MATCH_ROUTE, matchPath, newMatchPath } from './lib/routePaths';
import { upcomingDates } from './lib/candidateSlots';
import { CreateMatchScreen } from './screens/CreateMatchScreen';
import { MatchScreen } from './screens/MatchScreen';
import {
  DAY_MS,
  MATCH_ID,
  NOW_MS,
  SQUAD_ID,
  fakeMatchesApi,
  matchDetail,
  renderAtRoute,
  success,
  teamSheet,
} from './testing/matchesFixtures';

vi.mock('../app-shell', async () => {
  const actual = await vi.importActual<typeof import('../app-shell')>('../app-shell');
  return { ...actual, usePublishSquadScopeFromRoute: (): string | null => null };
});

const WCAG_A_AND_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const THEMES: readonly Theme[] = ['dark', 'light'];

async function expectNoWcagViolations(container: HTMLElement): Promise<void> {
  const results = await axe(container, {
    runOnly: { type: 'tag', values: WCAG_A_AND_AA_TAGS },
  });

  // Guard against a vacuous pass from a tag list that evaluated nothing.
  expect(results.passes.length + results.incomplete.length + results.violations.length).toBeGreaterThan(0);
  expect(results).toHaveNoViolations();
}

afterEach(() => {
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
});

describe.each(THEMES)('in the %s theme', (theme) => {
  it('the matches section', async () => {
    applyThemeAttribute(theme);
    renderAtRoute(<MatchesSection api={fakeMatchesApi()} />, SQUAD_ROUTE, squadPath(SQUAD_ID));
    await screen.findByRole('list');
    await expectNoWcagViolations(document.body);
  });

  it('the create-match form, including its problems', async () => {
    applyThemeAttribute(theme);
    renderAtRoute(
      <CreateMatchScreen api={fakeMatchesApi()} now={() => NOW_MS} />,
      NEW_MATCH_ROUTE,
      newMatchPath(SQUAD_ID),
    );
    await screen.findByLabelText(LOCATION_LABEL);
    await expectNoWcagViolations(document.body);

    await userEvent.click(screen.getByRole('button', { name: SUBMIT_DRAFT_LABEL }));
    await expectNoWcagViolations(document.body);

    // A picked day with two kick-offs, neither set: each time field is flagged.
    const [, tomorrow] = upcomingDates(NOW_MS);
    await userEvent.click(screen.getByRole('checkbox', { name: tomorrow.label }));
    await userEvent.click(screen.getByRole('button', { name: addTimeLabel(tomorrow.label) }));
    await userEvent.click(screen.getByRole('button', { name: SUBMIT_DRAFT_LABEL }));
    await expectNoWcagViolations(document.body);
  });

  it('the match screen while gathering availability', async () => {
    applyThemeAttribute(theme);
    renderAtRoute(<MatchScreen api={fakeMatchesApi()} />, MATCH_ROUTE, matchPath(SQUAD_ID, MATCH_ID));
    await screen.findAllByText(/^\d+ can play$/);
    // The organiser's grid, with a guest's row loaded and a day ticked since the last save.
    const [guestDay] = await screen.findAllByRole('checkbox', { name: /^Guest Gary, / });
    await userEvent.click(guestDay);
    await expectNoWcagViolations(document.body);

    // The confirm dialog, open on the chosen day with its short-of-players warning.
    await userEvent.click(screen.getByRole('button', { name: CONFIRM_DAY_BUTTON_LABEL }));
    await screen.findByRole('dialog');
    await expectNoWcagViolations(document.body);
  });

  it('the match screen once confirmed', async () => {
    applyThemeAttribute(theme);
    const api = fakeMatchesApi({
      getMatch: async () =>
        success(
          matchDetail({
            state: 'Confirmed',
            confirmedDayMs: DAY_MS[0],
            participantCount: 1,
            participants: [
              { membershipId: MATCH_ID, displayName: 'Alex', isGuest: true, rosterPosition: 0 },
            ],
          }),
        ),
    });
    renderAtRoute(<MatchScreen api={api} />, MATCH_ROUTE, matchPath(SQUAD_ID, MATCH_ID));
    await screen.findByRole('checkbox', { name: 'Alex' });
    await expectNoWcagViolations(document.body);
  });

  it('the match screen with its team sheet and teams editor', async () => {
    applyThemeAttribute(theme);
    const api = fakeMatchesApi({
      getMatch: async () =>
        success(
          matchDetail({
            state: 'TeamsRolled',
            confirmedDayMs: DAY_MS[0],
            participantCount: 1,
            participants: [
              { membershipId: MATCH_ID, displayName: 'Alex', isGuest: false, rosterPosition: 0 },
            ],
          }),
        ),
    });
    renderAtRoute(<MatchScreen api={api} />, MATCH_ROUTE, matchPath(SQUAD_ID, MATCH_ID));
    await screen.findByRole('heading', { name: /^Team sheet/ });
    await screen.findByRole('heading', { name: 'Predicted result' });
    await expectNoWcagViolations(document.body);
  });

  it('the match screen in play, with the score form, its problem, and the complete step', async () => {
    applyThemeAttribute(theme);
    const [red, blue] = teamSheet().teams;
    const api = fakeMatchesApi({
      getMatch: async () =>
        success(
          matchDetail({
            state: 'InProgress',
            confirmedDayMs: DAY_MS[0],
            recordedResult: {
              fidelity: 'Basic',
              teamScores: [
                { teamId: red.teamId, score: 1 },
                { teamId: blue.teamId, score: 0 },
              ],
            },
          }),
        ),
    });
    renderAtRoute(<MatchScreen api={api} />, MATCH_ROUTE, matchPath(SQUAD_ID, MATCH_ID));
    await screen.findByRole('heading', { name: RESULT_FORM_HEADING });
    await screen.findByText(PROVISIONAL_RESULT_LABEL);
    await expectNoWcagViolations(document.body);

    await userEvent.clear(screen.getByLabelText(scoreLabel(red.teamName, red.bibFlag)));
    await userEvent.click(screen.getByRole('button', { name: SAVE_RESULT_LABEL }));
    await userEvent.click(screen.getByRole('button', { name: COMPLETE_MATCH_LABEL }));
    await expectNoWcagViolations(document.body);
  });

  it('the match screen once completed, and the cancel confirmation before kick-off', async () => {
    applyThemeAttribute(theme);
    const [red, blue] = teamSheet().teams;
    const completed = renderAtRoute(
      <MatchScreen
        api={fakeMatchesApi({
          getMatch: async () =>
            success(
              matchDetail({
                state: 'Completed',
                confirmedDayMs: DAY_MS[0],
                recordedResult: {
                  fidelity: 'Basic',
                  teamScores: [
                    { teamId: red.teamId, score: 2 },
                    { teamId: blue.teamId, score: 2 },
                  ],
                },
                completedAtMs: DAY_MS[0] + 3_600_000,
              }),
            ),
        })}
      />,
      MATCH_ROUTE,
      matchPath(SQUAD_ID, MATCH_ID),
    );
    await screen.findByText(FINAL_RESULT_LABEL);
    await expectNoWcagViolations(document.body);
    completed.unmount();

    renderAtRoute(
      <MatchScreen
        api={fakeMatchesApi({
          getMatch: async () => success(matchDetail({ state: 'TeamsRolled', confirmedDayMs: DAY_MS[0] })),
        })}
      />,
      MATCH_ROUTE,
      matchPath(SQUAD_ID, MATCH_ID),
    );
    await userEvent.click(await screen.findByRole('button', { name: CANCEL_MATCH_LABEL }));
    await expectNoWcagViolations(document.body);
  });

  it('the not-found treatment', async () => {
    applyThemeAttribute(theme);
    const api = fakeMatchesApi({ getMatch: async () => ({ kind: 'not-found' }) });
    renderAtRoute(<MatchScreen api={api} />, MATCH_ROUTE, matchPath(SQUAD_ID, MATCH_ID));
    await screen.findByRole('heading', { level: 1 });
    await expectNoWcagViolations(document.body);
  });
});
