/**
 * Unit tests for the Squads_Feature's two route tables (task 15.1).
 *
 * What is pinned here is the *shape* of what the feature hands the application
 * router, because that is the whole of what these factories do:
 *
 *   - the shell table carries exactly one route, expressed **relative** to the
 *     App_Shell's `/app` layout route, so nesting it puts the Squad_Screen behind
 *     the Route_Guard and inside the frame (Requirement 18.5);
 *   - that relative path rejoins the shell's prefix to give exactly the
 *     `SQUAD_ROUTE` pattern `lib/routePaths.ts` owns — the derivation cannot drift
 *     from the pattern the path builders and the later player-stats registration
 *     use;
 *   - the public table carries exactly the top-level `INVITE_LANDING_ROUTE`, with
 *     no guard and no frame around it (Requirement 18.5);
 *   - neither table registers the Squads_Home (it is the shell's injected
 *     Home_Slot content, Requirement 18.6) nor the Player_Stats_Route (a seam a
 *     later feature fills, Requirement 9.6); and
 *   - the two Placeholder_Section bodies are threaded to the Squad_Screen
 *     untouched, so a later feature fills them without editing a squads file
 *     (Requirement 15.3).
 *
 * The elements are inspected rather than rendered. Rendering them means standing up
 * the App_Shell's providers, the Auth_State, and the transport seam, which is what
 * the routing integration tests through the assembled real router do (task 15.4);
 * duplicating it here would test the screens again rather than the tables.
 *
 * Feature: web-squads-screens
 * Requirements: 9.6, 15.3, 18.4, 18.5, 18.6
 */
import { isValidElement, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { HOME_ROUTE } from '../app-shell';
import type { SquadsApi } from './api/squadsApi';
import { INVITE_LANDING_ROUTE, PLAYER_STATS_ROUTE, SQUAD_ROUTE } from './lib/routePaths';
import {
  InviteLandingScreen,
  type InviteLandingScreenProps,
} from './screens/InviteLandingScreen';
import { SquadScreen, type SquadScreenProps } from './screens/SquadScreen';
import { createSquadsPublicRoutes, createSquadsShellRoutes } from './squadsRoutes';

/**
 * A Squads_Api stand-in.
 *
 * No test here issues a call: a route table pairs a pattern with an element and
 * settles nothing, so the facade only has to be the value that is threaded
 * through. The screens' own tests exercise it with settled `CallResult`s.
 */
const api = {} as SquadsApi;

describe('createSquadsShellRoutes', () => {
  it('registers exactly one route, relative to the shell prefix', () => {
    const routes = createSquadsShellRoutes({ api });

    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe('squads/:squadId');
    expect(routes[0].children).toBeUndefined();
    expect(routes[0].index).toBeUndefined();
  });

  it('derives a child path that rejoins the shell prefix as the Squad_Route', () => {
    const [route] = createSquadsShellRoutes({ api });

    expect(`${HOME_ROUTE}/${route.path}`).toBe(SQUAD_ROUTE);
  });

  it('registers no Player_Stats_Route and no Squads_Home route', () => {
    const paths = createSquadsShellRoutes({ api }).map((route) => route.path);

    expect(paths).not.toContain(PLAYER_STATS_ROUTE);
    expect(paths).not.toContain('squads/:squadId/players/:membershipId');
    expect(paths).not.toContain(HOME_ROUTE);
    expect(paths).not.toContain('');
  });

  it('renders the Squad_Screen with the injected api', () => {
    const [route] = createSquadsShellRoutes({ api });

    expect(isValidElement(route.element)).toBe(true);
    const element = route.element as ReactElement<SquadScreenProps>;

    expect(element.type).toBe(SquadScreen);
    expect(element.props.api).toBe(api);
  });

  it('threads both Placeholder_Section bodies through untouched', () => {
    const matchesContent = <p>Matches go here</p>;
    const statsContent = <p>Stats go here</p>;

    const [route] = createSquadsShellRoutes({ api, matchesContent, statsContent });
    const element = route.element as ReactElement<SquadScreenProps>;

    expect(element.props.matchesContent).toBe(matchesContent);
    expect(element.props.statsContent).toBe(statsContent);
  });

  it('leaves both Placeholder_Section bodies absent where none is supplied', () => {
    const [route] = createSquadsShellRoutes({ api });
    const element = route.element as ReactElement<SquadScreenProps>;

    expect(element.props.matchesContent).toBeUndefined();
    expect(element.props.statsContent).toBeUndefined();
  });
});

describe('createSquadsPublicRoutes', () => {
  it('registers exactly the top-level Invite_Landing_Route', () => {
    const routes = createSquadsPublicRoutes({ api });

    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe(INVITE_LANDING_ROUTE);
    expect(routes[0].path?.startsWith('/')).toBe(true);
    expect(routes[0].children).toBeUndefined();
  });

  it('renders the Invite_Landing_Screen with the injected api', () => {
    const [route] = createSquadsPublicRoutes({ api });

    expect(isValidElement(route.element)).toBe(true);
    const element = route.element as ReactElement<InviteLandingScreenProps>;

    expect(element.type).toBe(InviteLandingScreen);
    expect(element.props.api).toBe(api);
  });

  it('registers nothing beneath the shell prefix', () => {
    const paths = createSquadsPublicRoutes({ api }).map((route) => route.path ?? '');

    for (const path of paths) {
      expect(path.startsWith(`${HOME_ROUTE}/`)).toBe(false);
      expect(path).not.toBe(HOME_ROUTE);
    }
  });
});
