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
import { LOCATION_LABEL, SUBMIT_DRAFT_LABEL } from './lib/messages';
import { MATCH_ROUTE, NEW_MATCH_ROUTE, matchPath, newMatchPath } from './lib/routePaths';
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
  });

  it('the match screen while gathering availability', async () => {
    applyThemeAttribute(theme);
    renderAtRoute(<MatchScreen api={fakeMatchesApi()} />, MATCH_ROUTE, matchPath(SQUAD_ID, MATCH_ID));
    await screen.findAllByText(/needed$/);
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
    await screen.findByText('Alex');
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
