/**
 * Unit tests for the Player_Stats_Feature's route table (task 11.2).
 *
 * What is pinned here is the *shape* of what the feature hands the application
 * router, because that is the whole of what the factory does:
 *
 *   - the table carries exactly one route, expressed **relative** to the
 *     App_Shell's `/app` layout route, so nesting it puts the Player_Stats_Screen
 *     behind the Route_Guard and inside the frame (Requirement 1.1);
 *   - that relative path rejoins the shell's prefix to give exactly the
 *     `PLAYER_STATS_ROUTE` pattern the Squads_Feature's barrel owns — the
 *     derivation cannot drift from the pattern the Player_Rows build their paths
 *     from (Requirement 1.2);
 *   - the dynamic segments keep the names the pattern gives them, which is what
 *     lets the screen read its subject from the route alone and publish the
 *     Squad_Scope with no argument (Requirements 1.4, 1.5); and
 *   - the injected Player_Stats_Api reaches the screen untouched, the feature
 *     constructing no client of its own (Requirement 12.1).
 *
 * The element is inspected rather than rendered. Rendering it means standing up
 * the App_Shell's providers, the Auth_State, and the transport seam, which is
 * what the routing integration tests through the assembled real router do;
 * duplicating it here would test the screen again rather than the table.
 *
 * Feature: web-player-stats-screen
 * Requirements: 1.1, 1.2, 1.7, 14.7
 */
import { isValidElement, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { HOME_ROUTE } from '../app-shell';
import { PLAYER_STATS_ROUTE, SQUAD_ROUTE } from '../squads';
import type { PlayerStatsApi } from './api/playerStatsApi';
import { createPlayerStatsShellRoutes } from './playerStatsRoutes';
import {
  PlayerStatsScreen,
  type PlayerStatsScreenProps,
} from './screens/PlayerStatsScreen';

/**
 * A Player_Stats_Api stand-in.
 *
 * No test here issues a call: a route table pairs a pattern with an element and
 * settles nothing, so the facade only has to be the value that is threaded
 * through. The screen's own tests exercise it with settled `CallResult`s.
 */
const api = {} as PlayerStatsApi;

describe('createPlayerStatsShellRoutes', () => {
  it('registers exactly one route, relative to the shell prefix', () => {
    const routes = createPlayerStatsShellRoutes({ api });

    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe('squads/:squadId/players/:membershipId');
    expect(routes[0].path?.startsWith('/')).toBe(false);
    expect(routes[0].children).toBeUndefined();
    expect(routes[0].index).toBeUndefined();
  });

  it('derives a child path that rejoins the shell prefix as the Player_Stats_Route', () => {
    const [route] = createPlayerStatsShellRoutes({ api });

    expect(`${HOME_ROUTE}/${route.path}`).toBe(PLAYER_STATS_ROUTE);
  });

  it('keeps the dynamic segment names the imported pattern gives them', () => {
    const [route] = createPlayerStatsShellRoutes({ api });

    // 1.4, 1.5: the screen reads `squadId` and `membershipId` from the route's
    // own parameters, and the shell's scope publication reads `squadId` under
    // that exact spelling.
    expect(route.path?.split('/')).toEqual([
      'squads',
      ':squadId',
      'players',
      ':membershipId',
    ]);
  });

  it('registers no absolute pattern and no Squad_Route', () => {
    const paths = createPlayerStatsShellRoutes({ api }).map((route) => route.path);

    expect(paths).not.toContain(PLAYER_STATS_ROUTE);
    expect(paths).not.toContain(SQUAD_ROUTE);
    expect(paths).not.toContain(HOME_ROUTE);
    expect(paths).not.toContain('');
  });

  it('renders the Player_Stats_Screen with the injected api', () => {
    const [route] = createPlayerStatsShellRoutes({ api });

    expect(isValidElement(route.element)).toBe(true);
    const element = route.element as ReactElement<PlayerStatsScreenProps>;

    expect(element.type).toBe(PlayerStatsScreen);
    expect(element.props.api).toBe(api);
  });

  it('builds an equal table on every activation, holding no state', () => {
    const first = createPlayerStatsShellRoutes({ api });
    const second = createPlayerStatsShellRoutes({ api });

    expect(second).toHaveLength(first.length);
    expect(second[0].path).toBe(first[0].path);
  });
});
