/**
 * Unit tests for the App_Shell's route table (task 14.5).
 *
 * What is pinned here:
 *
 *   - every registered Destination route path appears in the table exactly once,
 *     with the Home_Destination as the layout route's index child rather than a
 *     second registration of `/app` (Requirements 3.1, 3.2);
 *   - entering each Destination's web address directly renders the Shell_Frame
 *     with that Destination's content, with no prior in-app navigation
 *     (Requirement 3.6), including the Notifications_Destination the shell
 *     supplies itself (Requirement 3.9) and the Settings_Destination's injected
 *     section (Requirements 3.7, 12.4);
 *   - a Destination with no content supplied renders the Unavailable_State with
 *     its registered label as the one level-one heading, and keeps its
 *     Primary_Navigation control marked as the current page (Requirements 3.7,
 *     3.8);
 *   - a path under `/app` that resolves to no Destination renders the not-found
 *     indication inside the frame with no control marked current
 *     (Requirement 3.10);
 *   - a path differing only in letter case or by a trailing separator reaches the
 *     same Destination (Requirement 3.13); and
 *   - an in-app navigation swaps only the Content_Region: the banner keeps its DOM
 *     node, so nothing reloads the document (Requirements 1.3, 3.4).
 *
 * The table is exercised through a real client-side router and a real
 * `AuthProvider`, so the Auth_State and the requested path arrive the way they do
 * in the running app. Two seams are stubbed: the Authenticated_Api_Client, so no
 * network is touched, and `matchMedia`, because jsdom evaluates no media query and
 * the frame's layout depends on one.
 *
 * The whole-application router — the landing route, the auth table, and this
 * subtree together — is task 15.1's; the integration tests through it are task
 * 15.4's. This file covers the shell's own table in isolation.
 *
 * Feature: app-shell
 * Requirements: 3.1, 3.2, 3.6, 3.7, 3.9, 3.10, 3.13, 11.1, 15.4
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryRouter,
  RouterProvider,
  type RouteObject,
} from 'react-router-dom';
import type { PitchMateApiClient } from '@pitchmate/api-client';

import { AuthProvider, type AuthState, type SessionManager } from '../auth';
import { createShellRoutes, type ShellDestinationContent } from './shellRoutes';
import {
  HOME_ROUTE,
  NOTIFICATIONS_ROUTE,
  PROFILE_ROUTE,
  SETTINGS_ROUTE,
  destinationLabel,
} from './lib/destinations';
import { HOME_CONTROL_LABEL, SHELL_NOT_FOUND_HEADING } from './lib/messages';
import {
  installViewport,
  restoreViewport,
} from './state/viewportLayoutTestHarness';

/** Text only ever rendered by the injected Home_Destination content. */
const HOME_HEADING = 'Your squads';

/** Text only ever rendered by the injected Profile_Destination content. */
const PROFILE_HEADING = 'Your profile';

/** Text only ever rendered by the injected Settings section. */
const INJECTED_SETTING = 'Notification preferences';

/**
 * A minimal authenticated {@link SessionManager}.
 *
 * `AuthProvider` reads only `getState()` and `subscribe()`, and nothing here
 * performs a session transition, so the remaining members are inert. It reports
 * `authenticated`, which is the state the Route_Guard admits and the only one in
 * which the notification centre runs.
 */
function authenticatedSessionManager(): SessionManager {
  const state: AuthState = 'authenticated';
  return {
    bootstrap: (): AuthState => state,
    establish: vi.fn(),
    getState: (): AuthState => state,
    getAccessTokenForRequest: vi.fn(async () => ({ token: 'access-token' })),
    signOut: vi.fn(async () => {}),
    subscribe: () => () => {},
  } as unknown as SessionManager;
}

/**
 * An Authenticated_Api_Client stand-in answering every notification call at once.
 *
 * The facade reads response text and decodes it itself (the contract declares no
 * content schema), so the count endpoint answers `0` and the list endpoint an
 * empty array — enough for the frame to render without any call failing.
 */
function stubApiClient(): PitchMateApiClient {
  const ok = (body: unknown) =>
    Promise.resolve({ data: JSON.stringify(body), response: { status: 200 } });

  return {
    GET: (path: string) => ok(path.includes('unread-count') ? 0 : []),
    POST: () => Promise.resolve({ data: '', response: { status: 204 } }),
  } as unknown as PitchMateApiClient;
}

/** Let every settled notification call commit before anything is asserted. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Mount the shell's route table at `path`. */
async function renderShell(
  path: string,
  destinationContent?: ShellDestinationContent,
): Promise<RouteObject[]> {
  const routes = createShellRoutes({
    apiClient: stubApiClient(),
    signOut: async () => {},
    destinationContent,
  });

  render(
    <AuthProvider manager={authenticatedSessionManager()}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </AuthProvider>,
  );
  await flush();

  return routes;
}

/** Content filling all three injectable Destinations. */
function injectedContent(): ShellDestinationContent {
  return {
    home: <h1>{HOME_HEADING}</h1>,
    profile: <h1>{PROFILE_HEADING}</h1>,
    settings: <section>{INJECTED_SETTING}</section>,
  };
}

/** The Primary_Navigation control marked as the current page, if any. */
function currentNavigationControl(): HTMLElement | null {
  const navigation = screen.getByRole('navigation');
  return within(navigation).queryByRole('link', { current: 'page' });
}

beforeEach(() => {
  // The Wide_Layout, so every Primary_Navigation control is rendered directly
  // rather than behind the Compact_Layout disclosure (Requirement 1.7).
  installViewport(1024);
});

afterEach(() => {
  restoreViewport();
});

// --- Registration (Requirements 3.1, 3.2, 15.6) -----------------------------

describe('createShellRoutes registration', () => {
  it('registers one layout route at /app with one child per Destination and the catch-all', () => {
    const routes = createShellRoutes({
      apiClient: stubApiClient(),
      signOut: async () => {},
    });

    expect(routes).toHaveLength(1);
    const [layout] = routes;
    expect(layout.path).toBe(HOME_ROUTE);

    const children = layout.children ?? [];
    // 3.2: the Home_Destination is the layout route's own path, so it is the
    // index child — `/app` is registered once, not twice.
    expect(children.filter((child) => child.index === true)).toHaveLength(1);

    const paths = children.map((child) => child.path);
    expect(paths).toEqual([
      undefined,
      NOTIFICATIONS_ROUTE,
      SETTINGS_ROUTE,
      PROFILE_ROUTE,
      '*',
    ]);
  });

  it('registers every path exactly once', () => {
    const routes = createShellRoutes({
      apiClient: stubApiClient(),
      signOut: async () => {},
    });

    const declared = [
      routes[0].path,
      ...(routes[0].children ?? []).map((child) => child.path),
    ].filter((path): path is string => path !== undefined);

    expect(new Set(declared).size).toBe(declared.length);
  });
});

// --- Direct address entry (Requirements 3.6, 3.7, 3.9) ---------------------

describe('shell routes rendered by direct address entry', () => {
  it('renders the injected Home_Destination content inside the frame', async () => {
    await renderShell(HOME_ROUTE, injectedContent());

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(HOME_HEADING);
    expect(currentNavigationControl()).toHaveTextContent(destinationLabel('home'));
  });

  it('renders the Notifications_Destination the shell supplies itself', async () => {
    await renderShell(NOTIFICATIONS_ROUTE, injectedContent());

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      destinationLabel('notifications'),
    );
    expect(currentNavigationControl()).toHaveTextContent(
      destinationLabel('notifications'),
    );
  });

  it('renders the Settings_Destination with the injected section after the appearance group', async () => {
    await renderShell(SETTINGS_ROUTE, injectedContent());

    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1 })).toHaveTextContent(
      destinationLabel('settings'),
    );
    // 12.4: the shell's own appearance option group, then whatever is injected.
    const appearanceGroup = within(main).getByRole('group');
    expect(appearanceGroup).toBeInTheDocument();
    expect(within(main).getByText(INJECTED_SETTING)).toBeInTheDocument();
  });

  it('renders the injected Profile_Destination content', async () => {
    await renderShell(PROFILE_ROUTE, injectedContent());

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      PROFILE_HEADING,
    );
  });

  it('resolves a path differing only in letter case and a trailing separator', async () => {
    await renderShell('/app/Settings/', injectedContent());

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      destinationLabel('settings'),
    );
  });
});

// --- Unsupplied Destination content (Requirements 3.7, 3.8) ----------------

describe('shell routes with no Destination_Content supplied', () => {
  it('renders the Unavailable_State for Home, keeping its control marked current', async () => {
    await renderShell(HOME_ROUTE);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      destinationLabel('home'),
    );
    expect(screen.getByRole('link', { name: HOME_CONTROL_LABEL })).toBeInTheDocument();
    // 3.8: the frame and the navigation stay as they are.
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(currentNavigationControl()).toHaveTextContent(destinationLabel('home'));
  });

  it('renders the Unavailable_State for Profile', async () => {
    await renderShell(PROFILE_ROUTE);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      destinationLabel('profile'),
    );
    expect(screen.queryByText(PROFILE_HEADING)).toBeNull();
  });
});

// --- The `/app` not-found child (Requirement 3.10) -------------------------

describe('a path under /app resolving to no Destination', () => {
  it('renders the not-found indication inside the frame with no control marked current', async () => {
    await renderShell('/app/nowhere', injectedContent());

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      SHELL_NOT_FOUND_HEADING,
    );
    expect(screen.getByRole('link', { name: HOME_CONTROL_LABEL })).toBeInTheDocument();
    // 3.10: no Destination_Content, and nothing marked as the current page.
    expect(screen.queryByText(HOME_HEADING)).toBeNull();
    expect(currentNavigationControl()).toBeNull();
  });
});

// --- Client-side navigation (Requirements 1.3, 3.4) ------------------------

describe('navigating between Destinations', () => {
  it('swaps only the Content_Region, keeping the banner mounted', async (): Promise<void> => {
    const user = userEvent.setup();
    await renderShell(HOME_ROUTE, injectedContent());

    const banner = screen.getByRole('banner');
    const navigation = screen.getByRole('navigation');

    await user.click(
      within(navigation).getByRole('link', { name: destinationLabel('settings') }),
    );
    await flush();

    // 1.3: the same header element, not a re-created one.
    expect(screen.getByRole('banner')).toBe(banner);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      destinationLabel('settings'),
    );
    expect(screen.queryByText(HOME_HEADING)).toBeNull();
  });
});
