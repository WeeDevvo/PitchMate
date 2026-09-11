/**
 * The shared seams for mounting the **real** application router in a test.
 *
 * `createAppRoutes` builds everything it needs unless it is supplied, so a test
 * only has to replace the outside world: browser storage, the network, and the
 * Destination_Content the application injects from outside the shell. This module
 * holds that one set of replacements so every property over the assembled router
 * exercises the same production wiring — the landing route, the Auth_Feature
 * table, the shell subtree, the providers, and both catch-alls are the real thing
 * in each of them.
 *
 * It sits beside the router rather than inside a test file because more than one
 * property mounts the assembled table (Property 37 registration, Property 38
 * not-found), and a second copy of the stubs is a second thing to keep in step.
 * It follows the existing `…TestHarness.ts` convention of the shell's `state/`
 * directory: a plain module, not matched by the test-file glob, imported only by
 * tests.
 *
 * Requirements: 15.6, 15.9
 */
import { act, render } from '@testing-library/react';
import { vi } from 'vitest';
import {
  createMemoryRouter,
  RouterProvider,
  type RouteObject,
} from 'react-router-dom';
import type { PitchMateApiClient } from '@pitchmate/api-client';

import type {
  AuthApiFacade,
  AuthState,
  SessionManager,
} from '../features/auth';
import type { ShellDestinationContent } from '../features/app-shell';
import { createAppRoutes, type AppRoutesOptions } from './appRouter';

/** Text only ever rendered by the injected Home_Destination content. */
export const HOME_CONTENT_HEADING = 'Your squads';

/** Text only ever rendered by the injected Profile_Destination content. */
export const PROFILE_CONTENT_HEADING = 'Your profile';

/**
 * A minimal {@link SessionManager} reporting one fixed Auth_State.
 *
 * `AuthProvider` reads only `getState()` and `subscribe()`, and nothing here
 * performs a session transition, so the remaining members are inert.
 */
export function sessionManagerReporting(state: AuthState): SessionManager {
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
 * A minimal authenticated {@link SessionManager}.
 *
 * `authenticated` is the state the Route_Guard admits — without it every shell
 * path would resolve to the Log_In_Route instead of its Destination.
 */
export function authenticatedSessionManager(): SessionManager {
  return sessionManagerReporting('authenticated');
}

/**
 * A minimal unauthenticated {@link SessionManager}.
 *
 * The state a first-time visitor arrives in: the auth screens render as they
 * normally do, and every shell path is turned away by the Route_Guard.
 */
export function unauthenticatedSessionManager(): SessionManager {
  return sessionManagerReporting('unauthenticated');
}

/**
 * An Authenticated_Api_Client stand-in answering every notification call at once.
 *
 * The notifications facade reads the response text and decodes it itself, so the
 * unread-count endpoint answers `0` and the list endpoint an empty array — enough
 * for the frame to render with no call failing and nothing reaching the network.
 */
export function stubApiClient(): PitchMateApiClient {
  const ok = (body: unknown) =>
    Promise.resolve({ data: JSON.stringify(body), response: { status: 200 } });

  return {
    GET: (path: string) => ok(path.includes('unread-count') ? 0 : []),
    POST: () => Promise.resolve({ data: '', response: { status: 204 } }),
  } as unknown as PitchMateApiClient;
}

/**
 * An inert auth backend facade. No screen under test issues a call on first
 * render — the Verify_Email_Screen makes none when opened with no token — but the
 * screens still need a facade shaped like {@link AuthApiFacade}.
 */
export function stubAuthApi(): AuthApiFacade {
  const noop = vi.fn();
  return {
    register: noop,
    signIn: noop,
    signInGoogle: noop,
    refresh: noop,
    requestPasswordReset: noop,
    redeemPasswordReset: noop,
    redeemEmailVerification: noop,
    requestEmailVerification: noop,
    signOut: noop,
  } as unknown as AuthApiFacade;
}

/** The Destination_Content the application supplies from outside the shell. */
export const destinationContent: ShellDestinationContent = {
  home: <h1>{HOME_CONTENT_HEADING}</h1>,
  profile: <h1>{PROFILE_CONTENT_HEADING}</h1>,
};

/**
 * The real assembled route table, with only the outside world stubbed.
 *
 * `overrides` replaces individual seams — a Session_Manager reporting a different
 * Auth_State, say — and defaults to the authenticated, offline, content-supplied
 * arrangement every property over the assembled router uses.
 */
export function assembleRoutes(overrides: AppRoutesOptions = {}): RouteObject[] {
  return createAppRoutes({
    sessionManager: authenticatedSessionManager(),
    apiClient: stubApiClient(),
    authApi: stubAuthApi(),
    destinationContent,
    ...overrides,
  });
}

/** Let every settled notification call commit before anything is asserted. */
export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/**
 * Mount the assembled table at `path`, as entering that address does, and hand
 * back the router so the resulting Location can be inspected.
 */
export async function renderAt(
  routes: RouteObject[],
  path: string,
): Promise<ReturnType<typeof createMemoryRouter>> {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  await flush();
  return router;
}

/**
 * Clear the Theme attribute the auth table's and the shell's Theme_Providers
 * apply to the document element, which outlives an unmount.
 */
export function resetThemeAttribute(): void {
  document.documentElement.removeAttribute('data-theme');
}

/** jsdom's own `matchMedia`, captured so {@link restoreViewport} can put it back. */
const originalMatchMedia: typeof window.matchMedia | undefined =
  typeof window === 'undefined' ? undefined : window.matchMedia;

/**
 * Report a viewport width to every `min-width` media query the assembled router
 * asks about.
 *
 * jsdom lays nothing out and answers every query as non-matching, so the
 * Shell_Frame would otherwise always render its Compact_Layout with the
 * Primary_Navigation collapsed behind a disclosure control. A test that follows a
 * navigation control wants the Wide_Layout, where every control is directly
 * reachable.
 *
 * The stub parses `min-width` out of whatever query it is handed, so it answers
 * the frame's layout query and reports non-matching for the Theme_Provider's
 * `prefers-color-scheme` query, which carries no width — the dark-mode-first
 * default, which is what an unstubbed jsdom reports too.
 *
 * This is a second, deliberately tiny copy of the App_Shell's own viewport stub:
 * the shell exposes exactly one public entry point and this module is application
 * wiring, so reaching into `features/app-shell/state/` for the original would
 * breach the boundary Requirement 15.4 sets. Nothing here asserts anything, and
 * only the reported width crosses the seam.
 */
export function installViewport(width: number): void {
  const matches = (query: string): boolean => {
    const minWidth = /min-width:\s*(\d+)px/.exec(query);
    return minWidth === null ? false : width >= Number(minWidth[1]);
  };

  window.matchMedia = ((query: string) =>
    ({
      matches: matches(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    }) as unknown as MediaQueryList) as unknown as typeof window.matchMedia;
}

/** Put jsdom's own `matchMedia` back. Belongs in an `afterEach`. */
export function restoreViewport(): void {
  if (originalMatchMedia === undefined) {
    Reflect.deleteProperty(window, 'matchMedia');
    return;
  }
  window.matchMedia = originalMatchMedia;
}
