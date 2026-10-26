/**
 * The Matches_Feature through the real assembled router: the squad screen's
 * matches section is filled by the feature, its entries open the match screen
 * inside the shell frame, and the new routes sit behind the Route_Guard.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { RouteObject } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LOG_IN_ROUTE } from '../features/auth';
import { type ShellDestinationContent } from '../features/app-shell';
import { matchPath, newMatchPath } from '../features/matches';
import { squadPath } from '../features/squads';
import {
  MATCHES_FIXTURE,
  SQUADS_FIXTURE,
  assembleRoutes,
  authenticatedSessionManager,
  flush,
  installViewport,
  renderAt,
  resetThemeAttribute,
  restoreViewport,
  squadsApiClient,
  unauthenticatedSessionManager,
} from './appRouterTestHarness';

const CONTENT_WITHOUT_HOME: ShellDestinationContent = {
  profile: <h1>a profile body</h1>,
};

function assemble(
  overrides: Parameters<typeof assembleRoutes>[0] = {},
): { readonly routes: RouteObject[]; readonly requests: string[] } {
  const { client, requests } = squadsApiClient();
  const routes = assembleRoutes({
    sessionManager: authenticatedSessionManager(),
    apiClient: client,
    destinationContent: CONTENT_WITHOUT_HOME,
    ...overrides,
  });
  return { routes, requests };
}

const MATCH_ADDRESS = matchPath(SQUADS_FIXTURE.squadId, MATCHES_FIXTURE.matchId);

beforeEach(() => {
  installViewport(1024);
});

afterEach(() => {
  restoreViewport();
  resetThemeAttribute();
});

describe('the Matches_Feature in the assembled router', () => {
  it('fills the squad screen’s matches section and opens a match from it', async () => {
    const { routes, requests } = assemble();
    const router = await renderAt(routes, squadPath(SQUADS_FIXTURE.squadId));

    const entry = await screen.findByRole('link', { name: MATCHES_FIXTURE.location });
    expect(requests).toContain('GET /squads/{squadId}/matches');

    fireEvent.click(entry);
    await flush();

    expect(router.state.location.pathname).toBe(MATCH_ADDRESS);
    await waitFor(() => {
      expect(
        within(screen.getByRole('main')).getByRole('heading', {
          level: 1,
          name: MATCHES_FIXTURE.location,
        }),
      ).toBeInTheDocument();
    });
    expect(requests).toContain('GET /matches/{matchId}');
  });

  it('renders the match screen inside the shell frame when addressed directly', async () => {
    const { routes } = assemble();
    await renderAt(routes, MATCH_ADDRESS);

    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(
      await within(screen.getByRole('main')).findByText('3 can play'),
    ).toBeInTheDocument();
  });

  it('resolves "new" to the create-match screen, not a match identity', async () => {
    const { routes, requests } = assemble();
    await renderAt(routes, newMatchPath(SQUADS_FIXTURE.squadId));

    // The fixture caller is a member, so the screen explains rather than offering the form.
    expect(await screen.findByText('Only squad admins can create matches.')).toBeInTheDocument();
    expect(requests).not.toContain('GET /matches/{matchId}');
  });

  it('turns both match routes away while unauthenticated', async () => {
    for (const address of [MATCH_ADDRESS, newMatchPath(SQUADS_FIXTURE.squadId)]) {
      const { routes } = assemble({ sessionManager: unauthenticatedSessionManager() });
      const router = await renderAt(routes, address);
      expect(router.state.location.pathname).toBe(LOG_IN_ROUTE);
      document.body.innerHTML = '';
    }
  });
});
