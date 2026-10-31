/**
 * Routing integration tests for the Player_Stats_Feature, through the
 * **assembled real router** (task 11.4).
 *
 * The feature registers nothing itself (Requirement 14.7): it hands over one
 * table of children and `src/app/appRouter.tsx` nests them into the App_Shell's
 * `/app` layout route, which is what puts the screen behind the Route_Guard and
 * inside the Shell_Frame (Requirement 1.1). None of that is visible from inside
 * the feature, and none of it is visible from the route table alone:
 *
 * | Claim | Requirement |
 * | --- | --- |
 * | `/app/squads/:squadId/players/:membershipId` resolves the Player_Stats_Screen inside the frame | 1.1 |
 * | the address is **no longer** answered by the shell's `/app/*` not-found | 1.1 |
 * | an unauthenticated visitor is sent to log in and sees no profile value | 1.8 |
 * | activating a Player_Row on the Squad_Screen arrives at the screen for that row's membership | 1.3 |
 * | every path of the assembled table is still registered exactly once | 1.1 |
 *
 * The regression in the middle is why this feature exists. Before the route was
 * registered, the Squads_Feature's Player_Rows navigated to a pattern nothing
 * claimed, so `react-router` handed the address to the App_Shell's `/app/*`
 * splat and the player list led to a not-found. That failure is silent — a
 * missing registration looks exactly like a working one until the address is
 * entered — so it is asserted here rather than left to the eye.
 *
 * ### How the screen is identified
 *
 * By **data this test supplied**, as the sibling squads file does: the harness's
 * Api_Client stand-in answers `GetPlayerProfile` with a Player_Display_Name
 * built from the membership identity the request carried, and the screen heads
 * itself with the name it parsed. So a heading of
 * `playerProfileName(membershipId)` is evidence of three things at once — this
 * screen resolved, it issued its one call, and it issued it for *that* subject.
 * That is what Requirement 1.3's "for that row's membership identity" needs, and
 * it is a stronger claim than matching fixed copy would be. It also keeps this
 * application-level file out of the feature's internals: no message module, no
 * component selector, and no `data-` attribute of the feature is read here.
 *
 * The recorded request log is the second discriminator, and the sharper one for
 * the negative claims: the shell's not-found issues no `GetPlayerProfile` and
 * the Squad_Screen issues no profile call at all, so counting calls separates
 * the three surfaces that can occupy this address.
 *
 * ### How "no full-document reload" is asserted
 *
 * The Player_Row is a `<button>` calling the router's `navigate`, so there is no
 * default action to prevent and `fireEvent`'s return value says nothing. Three
 * signals stand in, following the squads file:
 *
 * 1. **The Shell_Header keeps its DOM node** — a reload would rebuild the
 *    document, so the same element instance surviving the navigation also shows
 *    the Player_Stats_Route really is nested *inside* the shell's `/app` layout
 *    route rather than a sibling that re-creates the frame.
 * 2. **The document element is the same instance**, which no reload preserves.
 * 3. **The router pushed**, so exactly one history entry was added rather than
 *    the current one being replaced. The two-sided measurement of that clause —
 *    a back step returning to where the activation started — belongs to the
 *    feature's own Property 37, which drives it over generated entries.
 *
 * ### The injected seams
 *
 * The table is the production `createAppRoutes`, assembled through
 * `appRouterTestHarness` with only the outside world replaced: the session
 * model, the Api_Client, and the auth backend facade. The Destination_Content
 * supplies **no Home body**, so the Home Destination falls back to the real
 * Squads_Home as the application does — which is what makes the Squad_Screen
 * reachable for the Player_Row journey.
 *
 * Feature: web-player-stats-screen
 * Requirements: 1.1, 1.3, 1.8
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { RouteObject } from 'react-router-dom';

import {
  LOG_IN_HEADING,
  LOG_IN_ROUTE,
  REDIRECT_PARAM_NAME,
} from '../features/auth';
import { HOME_ROUTE, type ShellDestinationContent } from '../features/app-shell';
import {
  PLAYER_STATS_ROUTE,
  SQUAD_ROUTE,
  playerStatsPath,
  squadPath,
} from '../features/squads';
import { APP_NOT_FOUND_CONTROL_LABEL } from './AppNotFound';
import { APP_CATCH_ALL_ROUTE, LANDING_ROUTE } from './appRoutePaths';
import {
  PLAYER_STATS_FIXTURE,
  PLAYER_STATS_REQUESTS,
  SQUADS_FIXTURE,
  SQUADS_REQUESTS,
  assembleRoutes,
  authenticatedSessionManager,
  flush,
  installViewport,
  playerProfileName,
  registeredPaths,
  renderAt,
  resetThemeAttribute,
  restoreViewport,
  squadsApiClient,
  unauthenticatedSessionManager,
} from './appRouterTestHarness';

// --- Assembling the router ---------------------------------------------------

/**
 * The Destination bodies the application injects, **without** Home.
 *
 * Omitting it lets `createAppRoutes` fall back to the real `SquadsHome`, the way
 * the application does — which is how the Squad_Screen is reachable at all, and
 * therefore how the Player_Row journey of Requirement 1.3 can start where a
 * person really starts it.
 */
const CONTENT_WITHOUT_HOME: ShellDestinationContent = {
  profile: <h1>a profile body</h1>,
};

/** The real assembled table over the harness's client, with its request log. */
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

/** The address of the Player_Row's own profile, as the row builds it. */
const SUBJECT_PATH = playerStatsPath(
  SQUADS_FIXTURE.squadId,
  SQUADS_FIXTURE.membershipId,
);

/** The name the stand-in answers for the Player_Row's membership. */
const SUBJECT_NAME = playerProfileName(SQUADS_FIXTURE.membershipId);

// --- Reading the rendered surface --------------------------------------------

/** The level-one headings currently rendered, in document order. */
function levelOneHeadings(): string[] {
  return screen
    .getAllByRole('heading', { level: 1 })
    .map((heading) => heading.textContent?.trim() ?? '');
}

/** Assert the Shell_Frame's landmarks are rendered, and hand back its banner. */
function expectShellFrame(): HTMLElement {
  expect(document.querySelector('.shell-frame')).not.toBeNull();
  expect(screen.getByRole('main')).toBeInTheDocument();
  return screen.getByRole('banner');
}

/**
 * Assert no part of the Shell_Frame reached the DOM.
 *
 * The frame's own wrapper and its banner and main landmarks. The navigation
 * landmark is deliberately not among them: the Log_In_Screen renders a
 * navigation region of its own, so its absence would not distinguish the two.
 */
function expectNoShellFrame(): void {
  expect(document.querySelector('.shell-frame')).toBeNull();
  expect(screen.queryByRole('banner')).toBeNull();
  expect(screen.queryByRole('main')).toBeNull();
}

/** How many times `entry` — a `METHOD path` pair — was issued. */
function issued(requests: readonly string[], entry: string): number {
  return requests.filter((request) => request === entry).length;
}

/** The one link inside the shell's main region, whichever surface rendered it. */
function mainLink(): HTMLElement {
  return within(screen.getByRole('main')).getByRole('link');
}

/** Activate a control and let every settled call commit. */
async function activate(control: HTMLElement): Promise<void> {
  fireEvent.click(control);
  await flush();
}

beforeEach(() => {
  // The Wide_Layout, so every Primary_Navigation control is directly reachable
  // rather than collapsed behind the Compact_Layout disclosure.
  installViewport(1024);
});

afterEach(() => {
  restoreViewport();
  // Both Theme_Providers apply the resolved Theme to the document element, which
  // outlives an unmount.
  resetThemeAttribute();
});

// --- Entered directly: inside the frame, behind the guard (1.1, 1.8) --------

describe('the Player_Stats_Route entered directly', () => {
  it('renders the Player_Stats_Screen inside the shell frame while authenticated', async () => {
    const { routes, requests } = assemble();

    const router = await renderAt(routes, SUBJECT_PATH);

    // 1.1: inside the frame — the shell's navigation, notification surface, and
    // account menu are present around the screen.
    expectShellFrame();
    expect(router.state.location.pathname).toBe(SUBJECT_PATH);

    // The heading only reads this way if the screen resolved, issued its one
    // call for the membership in the address, and parsed the answer.
    await waitFor(() => {
      expect(levelOneHeadings()).toEqual([SUBJECT_NAME]);
    });
    expect(issued(requests, PLAYER_STATS_REQUESTS.getPlayerProfile)).toBe(1);

    // And it is this screen rather than a squads one: neither squads call was
    // issued, so neither the Squad_Screen nor the Squads_Home resolved here.
    expect(issued(requests, SQUADS_REQUESTS.getSquad)).toBe(0);
    expect(issued(requests, SQUADS_REQUESTS.leaderboard)).toBe(0);

    // Inside the frame: the screen's content sits in the shell's main region.
    expect(
      within(screen.getByRole('main')).getByRole('heading', {
        level: 1,
        name: SUBJECT_NAME,
      }),
    ).toBeInTheDocument();
  });

  it('resolves the subject the address names, not some other membership', async () => {
    const { routes } = assemble();
    const otherPath = playerStatsPath(
      SQUADS_FIXTURE.squadId,
      PLAYER_STATS_FIXTURE.otherMembershipId,
    );

    await renderAt(routes, otherPath);

    // The same registered pattern, a different membership segment: the subject
    // comes from the path and from nothing else, so a second address inside the
    // same squad resolves a different profile.
    await waitFor(() => {
      expect(levelOneHeadings()).toEqual([
        playerProfileName(PLAYER_STATS_FIXTURE.otherMembershipId),
      ]);
    });
    expect(screen.queryByText(SUBJECT_NAME)).toBeNull();
  });

  it('is no longer answered by the shell’s /app not-found', async () => {
    const { routes, requests } = assemble();

    await renderAt(routes, SUBJECT_PATH);
    await flush();

    // The regression this feature exists to fix. Three independent signals, each
    // of which the shell's `/app/*` not-found would fail:
    //
    // 1. a `GetPlayerProfile` was issued — the not-found surface calls nothing;
    await waitFor(() => {
      expect(issued(requests, PLAYER_STATS_REQUESTS.getPlayerProfile)).toBe(1);
    });

    // 2. the one link in the main region leads back to the squad the address
    //    names, where the shell's not-found offers the Home_Destination;
    expect(mainLink()).toHaveAttribute(
      'href',
      squadPath(SQUADS_FIXTURE.squadId),
    );
    expect(mainLink()).not.toHaveAttribute('href', HOME_ROUTE);

    // 3. nor did the *application* catch-all claim it, which would have offered
    //    the marketing landing route and rendered no frame at all.
    expect(
      screen.queryByRole('link', { name: APP_NOT_FOUND_CONTROL_LABEL }),
    ).toBeNull();
    expectShellFrame();
  });

  it('leaves the path one segment short of it to the shell’s /app not-found', async () => {
    const { routes, requests } = assemble();
    // One segment short of the Player_Stats_Route and one past the Squad_Route,
    // so it matches no registered pattern under `/app`.
    const unregistered = `${squadPath(SQUADS_FIXTURE.squadId)}/players`;

    const router = await renderAt(routes, unregistered);
    await flush();

    // The contrast that makes the claim above about *registration* rather than
    // about the splat having been removed: the shell's `/app/*` handling is
    // alive and still answers an unregistered path beneath `/app` — inside the
    // frame, with a control to the Home_Destination — while issuing no call of
    // this feature.
    expectShellFrame();
    expect(router.state.location.pathname).toBe(unregistered);
    expect(mainLink()).toHaveAttribute('href', HOME_ROUTE);
    expect(issued(requests, PLAYER_STATS_REQUESTS.getPlayerProfile)).toBe(0);
    expect(screen.queryByText(SUBJECT_NAME)).toBeNull();
  });

  it('is turned away to the registered Log_In_Route while unauthenticated', async () => {
    const { routes, requests } = assemble({
      sessionManager: unauthenticatedSessionManager(),
    });

    const router = await renderAt(routes, SUBJECT_PATH);
    await flush();

    // 1.1: behind the Route_Guard. The guard's own behaviour is the shell's
    // property; what is integration-only is that this route sits behind it at
    // all, and that the route it hands over to is one this table registers.
    expect(router.state.location.pathname).toBe(LOG_IN_ROUTE);
    expect(levelOneHeadings()).toEqual([LOG_IN_HEADING]);

    const captured = new URLSearchParams(router.state.location.search).get(
      REDIRECT_PARAM_NAME,
    );
    expect(decodeURIComponent(captured ?? '')).toBe(SUBJECT_PATH);

    // 1.8: no Player_Stats_Api call was issued and no Player_Profile value
    // reached the surface — the screen never mounted, so the question of its own
    // Auth_State gate never arose.
    expect(issued(requests, PLAYER_STATS_REQUESTS.getPlayerProfile)).toBe(0);
    expect(screen.queryByText(SUBJECT_NAME)).toBeNull();
    expectNoShellFrame();
  });
});

// --- Arriving from the Squad_Screen (1.3) -----------------------------------

describe('in-app navigation from the Squad_Screen', () => {
  it('follows a Player_Row to the screen for that row’s membership, without reloading', async () => {
    const { routes, requests } = assemble();

    const router = await renderAt(routes, squadPath(SQUADS_FIXTURE.squadId));

    const documentElement = document.documentElement;
    const banner = expectShellFrame();

    // The row the player list rendered for the fixture squad's one member.
    const row = await waitFor(() =>
      within(screen.getByRole('main')).getByRole('button', {
        name: SQUADS_FIXTURE.playerName,
      }),
    );

    await activate(row);

    // 1.3: at the Player_Stats_Route for that row's membership, within the squad
    // of the Squad_Screen it came from.
    expect(router.state.location.pathname).toBe(SUBJECT_PATH);

    // … and the screen that resolved there loaded *that* membership's profile:
    // the heading is the name the backend answered for the identity in the
    // address, and the Squad_Screen it came from is gone.
    await waitFor(() => {
      expect(levelOneHeadings()).toEqual([SUBJECT_NAME]);
    });
    expect(issued(requests, PLAYER_STATS_REQUESTS.getPlayerProfile)).toBe(1);
    expect(screen.queryByText(SQUADS_FIXTURE.squadName)).toBeNull();

    // 1.3: exactly one history entry — pushed, not replaced …
    expect(router.state.historyAction).toBe('PUSH');

    // … and no full-document reload: the frame was never re-created, so the
    // route really is nested inside the shell's `/app` layout route.
    expect(screen.getByRole('banner')).toBe(banner);
    expect(document.documentElement).toBe(documentElement);
  });

  it('returns to the squad through the screen’s own control, client-side', async () => {
    const { routes } = assemble();

    const router = await renderAt(routes, SUBJECT_PATH);

    const documentElement = document.documentElement;
    const banner = expectShellFrame();

    await waitFor(() => {
      expect(levelOneHeadings()).toEqual([SUBJECT_NAME]);
    });

    // The way out the screen renders in every condition. Asserting it from here
    // rather than from inside the feature is what shows it reaches a route this
    // table actually registers: the Squad_Screen resolves and names the squad.
    await activate(mainLink());

    expect(router.state.location.pathname).toBe(
      squadPath(SQUADS_FIXTURE.squadId),
    );
    await waitFor(() => {
      expect(levelOneHeadings()).toEqual([SQUADS_FIXTURE.squadName]);
    });

    expect(screen.getByRole('banner')).toBe(banner);
    expect(document.documentElement).toBe(documentElement);
  });
});

// --- The assembled table ----------------------------------------------------

describe('the assembled route table', () => {
  it('registers the Player_Stats_Route once, and every other path once too', () => {
    const { routes } = assemble();
    const declared = registeredPaths(routes);

    // 1.1: registered — by this feature's table, nested into the shell's layout
    // route — and registered exactly once. A second registration would mean one
    // of the two contributors under `/app` had restated the other's route, and
    // `react-router` resolves that tie by registration order rather than
    // failing, so the loser would quietly stop being reachable.
    expect(declared.filter((path) => path === PLAYER_STATS_ROUTE)).toHaveLength(
      1,
    );

    // No path of the assembled table is registered twice, this one included.
    // Property 48 makes the same claim over generated assemblies and compares
    // patterns as *match shapes* rather than as strings; this is the concrete
    // check that the one default assembly is still clean.
    const counts = new Map<string, number>();
    for (const path of declared) {
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
    expect([...counts.entries()].filter(([, count]) => count > 1)).toEqual([]);

    // And the neighbours this route sits between are each still there once, so
    // the absence of duplicates is not the absence of routes: the Squad_Route it
    // extends, the shell's `/app/*` splat it out-ranks, the application
    // catch-all, and the landing route.
    for (const path of [
      SQUAD_ROUTE,
      `${HOME_ROUTE}/${APP_CATCH_ALL_ROUTE}`,
      APP_CATCH_ALL_ROUTE,
      LANDING_ROUTE,
    ]) {
      expect(declared.filter((registered) => registered === path)).toHaveLength(
        1,
      );
    }
  });

  it('declares the route through the feature’s barrel, at the published pattern', () => {
    // 1.2, 14.7 by consequence: the registered path is the very value the
    // Squads_Feature's barrel publishes and the Player_Rows build from, so the
    // pattern a row links to and the pattern that answers it cannot drift. No
    // literal of either appears in this file or anywhere under `src/app`.
    const { routes } = assemble();

    expect(registeredPaths(routes)).toContain(PLAYER_STATS_ROUTE);
    expect(SUBJECT_PATH.startsWith(`${squadPath(SQUADS_FIXTURE.squadId)}/`)).toBe(
      true,
    );
  });
});
