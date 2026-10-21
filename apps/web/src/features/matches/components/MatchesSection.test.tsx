import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { SQUAD_ROUTE, squadPath } from '../../squads';
import { MATCH_STATE_LABELS } from '../lib/matchState';
import {
  CREATE_MATCH_LABEL,
  GENERIC_MATCHES_FAILURE,
  MATCHES_TRUNCATED_STATEMENT,
  NO_MATCHES_STATEMENT,
  RETRY_LABEL,
} from '../lib/messages';
import { matchPath, newMatchPath } from '../lib/routePaths';
import {
  MATCH_ID,
  MEMBER,
  SQUAD_ID,
  fakeMatchesApi,
  matchList,
  matchSummary,
  renderAtRoute,
  success,
} from '../testing/matchesFixtures';
import { MatchesSection } from './MatchesSection';

function renderSection(api = fakeMatchesApi()) {
  renderAtRoute(<MatchesSection api={api} />, SQUAD_ROUTE, squadPath(SQUAD_ID));
  return api;
}

describe('MatchesSection', () => {
  it('lists each match with its state and player count, linking to its screen', async () => {
    renderSection(
      fakeMatchesApi({
        listMatches: async () =>
          success(matchList([matchSummary({ state: 'Confirmed', participantCount: 12 })])),
      }),
    );

    const link = await screen.findByRole('link', { name: 'Riverside 5s, pitch 2' });
    expect(link.getAttribute('href')).toBe(matchPath(SQUAD_ID, MATCH_ID));

    const entry = link.closest('li') as HTMLElement;
    expect(within(entry).getByText(MATCH_STATE_LABELS.Confirmed)).toBeTruthy();
    expect(within(entry).getByText('12 players')).toBeTruthy();
    expect(within(entry).getByText((_, node) => node?.tagName === 'TIME')).toBeTruthy();
  });

  it('offers an organiser the create-match link', async () => {
    renderSection();

    const create = await screen.findByRole('link', { name: CREATE_MATCH_LABEL });
    expect(create.getAttribute('href')).toBe(newMatchPath(SQUAD_ID));
  });

  it('offers a member no create-match link', async () => {
    renderSection(fakeMatchesApi({ getSquadStanding: async () => success(MEMBER) }));

    await screen.findByRole('link', { name: 'Riverside 5s, pitch 2' });
    expect(screen.queryByRole('link', { name: CREATE_MATCH_LABEL })).toBeNull();
  });

  it('states an empty list and a truncated one', async () => {
    renderSection(fakeMatchesApi({ listMatches: async () => success(matchList([], true)) }));

    expect(await screen.findByText(NO_MATCHES_STATEMENT)).toBeTruthy();
    expect(screen.getByText(MATCHES_TRUNCATED_STATEMENT)).toBeTruthy();
  });

  it('states a failure and retries on request', async () => {
    const api = renderSection(
      fakeMatchesApi({ listMatches: async () => ({ kind: 'transport-failure' }) }),
    );

    expect(await screen.findByText(GENERIC_MATCHES_FAILURE)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: RETRY_LABEL }));
    expect(api.listMatches).toHaveBeenCalledTimes(2);
  });

  it('renders nothing of its own for a squad that is not found', async () => {
    const api = renderSection(fakeMatchesApi({ listMatches: async () => ({ kind: 'not-found' }) }));

    await expect.poll(() => api.listMatches.mock.calls.length).toBe(1);
    expect(screen.queryByText(GENERIC_MATCHES_FAILURE)).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });
});
