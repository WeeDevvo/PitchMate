/**
 * Routing integration tests for the Squads_Feature, through the **assembled real
 * router** (task 15.4).
 *
 * The feature registers nothing itself (Requirement 18.4): it hands over two route
 * tables and one slot component, and `src/app/appRouter.tsx` places them on
 * opposite sides of the App_Shell (Requirement 18.5). Everything interesting about
 * that arrangement is therefore invisible from inside the feature, and invisible
 * from the route table alone:
 *
 * | Claim | Requirement |
 * | --- | --- |
 * | `/app` resolves the Squads_Home as the shell's Home_Slot content, inside the frame | 18.6 |
 * | `/app/squads/:squadId` resolves the Squad_Screen behind the Route_Guard and inside the frame | 18.5 |
 * | `/app/squads/:squadId/players/:membershipId` is registered by nobody and falls to the shell's `/app` not-found | 9.6, 9.7 |
 * | `/join/:code` resolves outside the guard and outside the frame | 18.5 |
 * | every feature screen is reachable at its registered path | 20.12 |
 * | in-app navigation performs no full-document reload | 9.4, 20.12 |
 *
 * The neighbouring properties hold what quantifies: Property 48 that every path is
 * registered exactly once, the app-shell's Property 37 that each registered path
 * reaches its own screen, Property 38 the application not-found. What is left is
 * the handful of concrete placements above, none of which varies with an input —
 * so they are examples, not properties.
 *
 * ### How a screen is identified
 *
 * By **data this test supplied**, not by fixed copy read out of the feature: the
 * Squad_Screen heads itself with the parsed Squad_Name, each Squad_Card names it,
 * each Player_Row names its player, and the Invite_Landing_Route renders the
 * anonymous preview's own instruction. A value only reaches the surface if the
 * screen issued its call and its parser accepted the answer, so matching one is a
 * stronger claim than matching a string constant would be — and it keeps this
 * application-level file out of the feature's internals, which is the same reason
 * the app-shell integration file finds the brand control structurally rather than
 * by its shell-internal label.
 *
 * The recorded request log is the second discriminator, and the sharper one for a
 * negative claim: the Squad_Screen cannot resolve without a `GetSquad`, so an
 * address that issues none rendered something else. That is precisely what
 * Requirement 9.6 says about the Player_Stats_Route.
 *
 * ### How "no full-document reload" is asserted
 *
 * The Squad_Card and the Player_Row control are `<button>`s calling the router's
 * `navigate` rather than anchors, so there is no default action to prevent and the
 * `fireEvent` return value says nothing. Two signals remain, and both are stronger
 * for this feature's purposes:
 *
 * 1. **The Shell_Header keeps its DOM node.** A reload would rebuild the document,
 *    so the same element instance surviving the navigation shows the frame was
 *    never re-created — which also demonstrates the Squad_Route really is *inside*
 *    the shell's `/app` layout route rather than a sibling that re-mounts it.
 * 2. **The document element is the same instance**, which no reload could preserve.
 *
 * ### The injected seams
 *
 * The table is the production `createAppRoutes`, assembled through
 * `appRouterTestHarness` with only the outside world replaced: the session model,
 * the Api_Client (squads-aware here), and the auth backend facade. The
 * Destination_Content deliberately supplies **no Home body**, so the Home
 * Destination falls back to the real Squads_Home the way the application does
 * (Requirement 18.6) instead of to the harness's placeholder heading.
 *
 * Feature: web-squads-screens
 * Requirements: 9.4, 9.6, 9.7, 18.4, 18.5, 18.6, 20.12
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
  INVITE_LANDING_ROUTE,
  PLAYER_STATS_ROUTE,
  SQUAD_ROUTE,
  inviteLandingPath,
  playerStatsPath,
  squadPath,
} from '../features/squads';
import { APP_NOT_FOUND_CONTROL_LABEL } from './AppNotFound';
import {
  assembleRoutes,
  authenticatedSessionManager,
  flush,
  installViewport,
  registeredPaths,
  renderAt,
  resetThemeAttribute,
  restoreViewport,
  SQUADS_FIXTURE,
  SQUADS_REQUESTS,
  squadsApiClient,
  unauthenticatedSessionManager,
} from './appRouterTestHarness';

// --- Assembling the router ---------------------------------------------------

/**
 * The Destination bodies the application injects, **without** Home.
 *
 * Omitting it is the whole point: `createAppRoutes` falls back to the real
 * `SquadsHome` for the Home_Slot (Requirement 18.6), which is the arrangement
 * every claim about `/app` below is about. A supplied body would render the
 * harness's placeholder heading instead and quietly make those claims vacuous.
 */
const CONTENT_WITHOUT_HOME: ShellDestinationContent = {
  profile: <h1>a profile body</h1>,
};

/** The real assembled table over a squads-aware client, with its request log. */
function assembleWithSquads(
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

// --- Reading the rendered surface --------------------------------------------

/** The level-one headings currently rendered, in document order. */
function levelOneHeadings(): string[] {
  return screen
    .getAllByRole('heading', { level: 1 })
    .map((heading) => heading.textContent?.trim() ?? '');
}

/** Assert the Shell_Frame's landmarks are rendered, and hand back its banner. */
function expectShellFrame(): HTMLElement {
  expect(screen.getByRole('navigation')).toBeInTheDocument();
  expect(screen.getByRole('main')).toBeInTheDocument();
  return screen.getByRole('banner');
}

/**
 * Assert no part of the Shell_Frame reached the DOM.
 *
 * The frame's own wrapper and its banner and main landmarks, following the
 * app-shell integration file's discriminators. The navigation landmark is
 * deliberately **not** among them: the Log_In_Screen renders a navigation region
 * of its own, so its absence would not distinguish the two surfaces. Where the
 * absence of *any* navigation is the claim — the Invite_Landing_Route, which
 * renders none — it is asserted at that site.
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

/** The Squad_Card control for the fixture squad, within the shell's main region. */
function squadCard(): HTMLElement {
  return within(screen.getByRole('main')).getByRole('button', {
    name: new RegExp(SQUADS_FIXTURE.squadName),
  });
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

// --- `/app`: the Squads_Home as the Home_Slot content (Requirement 18.6) -----

describe('the Default_Authenticated_Route', () => {
  it('renders the Squads_Home inside the shell frame, from the shell’s Home_Slot', async () => {
    const { routes, requests } = assembleWithSquads();

    const router = await renderAt(routes, HOME_ROUTE);

    // 18.6: the frame is the shell's, and the body inside it is the feature's.
    expectShellFrame();
    expect(router.state.location.pathname).toBe(HOME_ROUTE);

    // The card only names the squad if the real Squads_Home mounted, issued its
    // one `ListMySquads`, and parsed the answer.
    await waitFor(() => {
      expect(squadCard()).toBeInTheDocument();
    });
    expect(issued(requests, SQUADS_REQUESTS.listMySquads)).toBe(1);

    // 19.1: one level-one heading on the resolved screen, the Squads_Home's own.
    expect(levelOneHeadings()).toHaveLength(1);
  });

  it('registers no route of its own at the Default_Authenticated_Route', () => {
    // 18.6: exactly one screen resolves at `/app`, which holds because the
    // Squads_Home is injected content rather than a competing registration. The
    // Squad_Route beneath it *is* registered, and separately.
    const { routes } = assembleWithSquads();
    const declared = registeredPaths(routes);

    expect(declared.filter((path) => path === HOME_ROUTE)).toHaveLength(1);
    expect(declared.filter((path) => path === SQUAD_ROUTE)).toHaveLength(1);
  });
});

// --- `/app/squads/:squadId`: behind the guard, inside the frame (18.5) -------

describe('the Squad_Route entered directly', () => {
  it('renders the Squad_Screen inside the shell frame while authenticated', async () => {
    const { routes, requests } = assembleWithSquads();
    const requested = squadPath(SQUADS_FIXTURE.squadId);

    const router = await renderAt(routes, requested);

    expectShellFrame();
    expect(router.state.location.pathname).toBe(requested);

    // 6.3: the screen's one level-one heading is the parsed Squad_Name, so this
    // resolved the Squad_Screen and nothing else registered under `/app`.
    await waitFor(() => {
      expect(levelOneHeadings()).toEqual([SQUADS_FIXTURE.squadName]);
    });

    // The two concurrent calls of the screen's own machine, each issued once.
    expect(issued(requests, SQUADS_REQUESTS.getSquad)).toBe(1);
    expect(issued(requests, SQUADS_REQUESTS.leaderboard)).toBe(1);

    // Inside the frame: the screen's content sits in the shell's main region.
    const main = within(screen.getByRole('main'));
    expect(
      main.getByRole('heading', { level: 1, name: SQUADS_FIXTURE.squadName }),
    ).toBeInTheDocument();
  });

  it('is turned away to the registered Log_In_Route while unauthenticated', async () => {
    const { routes, requests } = assembleWithSquads({
      sessionManager: unauthenticatedSessionManager(),
    });
    const requested = squadPath(SQUADS_FIXTURE.squadId);

    const router = await renderAt(routes, requested);

    // 18.5: behind the Route_Guard. The guard's own behaviour is the shell's
    // property; what is integration-only is that the Squad_Route sits behind it
    // at all, and that the route it hands over to is one this table registers.
    expect(router.state.location.pathname).toBe(LOG_IN_ROUTE);
    expect(levelOneHeadings()).toEqual([LOG_IN_HEADING]);

    const captured = new URLSearchParams(router.state.location.search).get(
      REDIRECT_PARAM_NAME,
    );
    expect(decodeURIComponent(captured ?? '')).toBe(requested);

    // The screen never mounted, so it issued neither of its calls.
    expect(issued(requests, SQUADS_REQUESTS.getSquad)).toBe(0);
    expect(issued(requests, SQUADS_REQUESTS.leaderboard)).toBe(0);
    expectNoShellFrame();
  });
});

// --- The Player_Stats_Route seam (Requirements 9.6, 9.7) --------------------

describe('the Player_Stats_Route, which nothing registers', () => {
  it('is registered by no route of the assembled table', () => {
    // 9.6: the pattern is exported as a seam for the later player-stats feature
    // and is deliberately absent from the table.
    const { routes } = assembleWithSquads();

    expect(registeredPaths(routes)).not.toContain(PLAYER_STATS_ROUTE);
  });

  it('falls to the shell’s /app not-found rather than to any feature screen', async () => {
    const { routes, requests } = assembleWithSquads();
    const requested = playerStatsPath(
      SQUADS_FIXTURE.squadId,
      SQUADS_FIXTURE.membershipId,
    );

    const router = await renderAt(routes, requested);
    await flush();

    // 9.7: the App_Shell's own handling for a path beneath `/app` — inside the
    // frame, one heading, and a control to the Home_Destination. `react-router`
    // ranks the dynamic `/app/squads/:squadId` above the splat `/app/*`, and this
    // address matches neither the Squad_Route nor anything else, so the splat wins.
    expectShellFrame();
    expect(router.state.location.pathname).toBe(requested);
    expect(levelOneHeadings()).toHaveLength(1);

    const main = within(screen.getByRole('main'));
    expect(main.getByRole('link')).toHaveAttribute('href', HOME_ROUTE);

    // 9.6: no feature screen resolved. The Squad_Screen would have issued a
    // `GetSquad` and rendered the Squad_Name as its heading; the Squads_Home
    // would have rendered a Squad_Card. Neither happened.
    expect(issued(requests, SQUADS_REQUESTS.getSquad)).toBe(0);
    expect(issued(requests, SQUADS_REQUESTS.leaderboard)).toBe(0);
    expect(screen.queryByText(SQUADS_FIXTURE.squadName)).toBeNull();
    expect(screen.queryByText(SQUADS_FIXTURE.playerName)).toBeNull();

    // Nor did the *application* catch-all claim it: that surface renders no frame
    // and offers the marketing landing route instead of the Home_Destination.
    expect(
      screen.queryByRole('link', { name: APP_NOT_FOUND_CONTROL_LABEL }),
    ).toBeNull();
  });
});

// --- `/join/:code`: outside the guard and outside the frame (18.5) ----------

describe('the Invite_Landing_Route', () => {
  it('renders with no shell chrome and no session, keeping the requested address', async () => {
    const { routes, requests } = assembleWithSquads({
      sessionManager: unauthenticatedSessionManager(),
    });
    const requested = inviteLandingPath(SQUADS_FIXTURE.inviteSecret);

    const router = await renderAt(routes, requested);

    // 18.5: outside the Route_Guard — a visitor with no session stays at the
    // address they asked for and keeps the invite code in it, rather than being
    // bounced to the Log_In_Route where the code would be lost.
    expect(router.state.location.pathname).toBe(requested);
    expect(router.state.location.pathname).not.toBe(LOG_IN_ROUTE);

    // 18.5: outside the frame — no banner, no main region, no navigation of any
    // kind (this screen renders none of its own), and no notification call, which
    // is the frame's own first call.
    expectNoShellFrame();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(
      requests.filter((request) => request.includes('/notifications')),
    ).toEqual([]);

    // The screen resolved, issued its one anonymous preview, and rendered what
    // the preview carried.
    await waitFor(() => {
      expect(
        screen.getByText(SQUADS_FIXTURE.invitePreviewMessage),
      ).toBeInTheDocument();
    });
    expect(issued(requests, SQUADS_REQUESTS.previewInvite)).toBe(1);
    expect(issued(requests, SQUADS_REQUESTS.redeemInvite)).toBe(0);
    expect(levelOneHeadings()).toHaveLength(1);
  });

  it('is registered at the application’s top level, ahead of the catch-all', () => {
    const { routes } = assembleWithSquads();
    const declared = registeredPaths(routes);

    expect(declared.filter((path) => path === INVITE_LANDING_ROUTE)).toHaveLength(
      1,
    );
    // Ahead of the application catch-all, which would otherwise claim the address
    // by matching it equally and winning on registration order.
    expect(declared.indexOf(INVITE_LANDING_ROUTE)).toBeLessThan(
      declared.lastIndexOf('*'),
    );
  });

  it('redeems while authenticated and reaches the Squads_Home without reloading', async () => {
    const { routes, requests } = assembleWithSquads();
    const documentElement = document.documentElement;

    const router = await renderAt(
      routes,
      inviteLandingPath(SQUADS_FIXTURE.inviteSecret),
    );

    // The route works on both sides of the session, being outside the guard: an
    // authenticated arrival redeems instead of handing over, and the redemption
    // that carries no squad identity falls back to the Squads_Home.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(HOME_ROUTE);
    });

    expect(issued(requests, SQUADS_REQUESTS.redeemInvite)).toBe(1);
    expect(issued(requests, SQUADS_REQUESTS.previewInvite)).toBe(0);

    // The Squads_Home is reached inside the shell frame, client-side.
    expectShellFrame();
    await waitFor(() => {
      expect(squadCard()).toBeInTheDocument();
    });
    expect(document.documentElement).toBe(documentElement);
  });
});

// --- In-app navigation between the feature's screens ------------------------

describe('in-app navigation through the feature', () => {
  it('follows a Squad_Card into the Squad_Screen without reloading the document', async () => {
    const { routes, requests } = assembleWithSquads();

    const router = await renderAt(routes, HOME_ROUTE);

    const documentElement = document.documentElement;
    const banner = expectShellFrame();

    await waitFor(() => {
      expect(squadCard()).toBeInTheDocument();
    });

    // 1.8: one control per card, navigating through the router.
    await activate(squadCard());

    expect(router.state.location.pathname).toBe(
      squadPath(SQUADS_FIXTURE.squadId),
    );
    await waitFor(() => {
      expect(levelOneHeadings()).toEqual([SQUADS_FIXTURE.squadName]);
    });
    expect(issued(requests, SQUADS_REQUESTS.getSquad)).toBe(1);

    // The frame was never re-created, so nothing reloaded — and the Squad_Route
    // really is nested inside the shell's `/app` layout route rather than
    // replacing it.
    expect(screen.getByRole('banner')).toBe(banner);
    expect(document.documentElement).toBe(documentElement);
  });

  it('follows a Player_Row control to the Player_Stats_Route, reaching the shell’s not-found', async () => {
    const { routes } = assembleWithSquads();

    const router = await renderAt(routes, squadPath(SQUADS_FIXTURE.squadId));

    const documentElement = document.documentElement;
    const banner = expectShellFrame();

    const control = await waitFor(() =>
      within(screen.getByRole('main')).getByRole('button', {
        name: SQUADS_FIXTURE.playerName,
      }),
    );

    // 9.4: the navigation is the router's, so no full-document reload occurs …
    await activate(control);

    expect(router.state.location.pathname).toBe(
      playerStatsPath(SQUADS_FIXTURE.squadId, SQUADS_FIXTURE.membershipId),
    );
    expect(document.documentElement).toBe(documentElement);
    expect(screen.getByRole('banner')).toBe(banner);

    // … and 9.7: the address it reaches is handled by the shell's `/app`
    // not-found, with no feature-local not-found screen of its own.
    await waitFor(() => {
      expect(
        within(screen.getByRole('main')).getByRole('link'),
      ).toHaveAttribute('href', HOME_ROUTE);
    });
    expect(screen.queryByText(SQUADS_FIXTURE.squadName)).toBeNull();
  });
});
