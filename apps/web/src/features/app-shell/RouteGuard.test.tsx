/**
 * Unit tests for the Route_Guard — the authenticated boundary.
 *
 * What is pinned here:
 *
 *   - an authenticated request renders the wrapped subtree and issues no
 *     navigation at all (Requirement 2.1);
 *   - an unauthenticated request renders nothing of the shell and lands on the
 *     Auth_Feature's Log_In_Route carrying the requested path — query string and
 *     fragment included — as one percent-encoded parameter that decodes back
 *     character-for-character (Requirements 2.2, 2.5, 2.6);
 *   - a session ending while a shell route is displayed stops rendering the
 *     content and every value it displayed (Requirement 2.3);
 *   - a requested path above 2048 characters is dropped rather than truncated,
 *     while one of exactly 2048 characters is still carried (Requirements 2.5,
 *     2.7);
 *   - the navigation replaces the current history entry, so the back control does
 *     not return to the requested shell path (Requirement 2.8).
 *
 * The guard is exercised through a real client-side router and a real
 * `AuthProvider`, so the Auth_State arrives the way it does in the running app.
 * The `SessionManager` beneath the provider is a controllable fake: the provider
 * reads only `getState()` and `subscribe()`, and driving those two directly is
 * what lets a test move the session from `authenticated` to `unauthenticated`
 * mid-screen without a backend.
 *
 * Property 2 (task 14.2) covers the boundary across generated paths; these are
 * the worked examples beside it.
 *
 * Feature: app-shell
 */
import { type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
  createMemoryRouter,
  RouterProvider,
  type RouteObject,
} from 'react-router-dom';

import {
  AuthProvider,
  LOG_IN_ROUTE,
  REDIRECT_PARAM_NAME,
  type AuthState,
  type SessionManager,
} from '../auth';
import { RouteGuard } from './RouteGuard';
import { MAX_CAPTURED_PATH_LENGTH } from './lib/redirectCapture';

/** A shell path the guard is asked to admit. */
const SHELL_PATH = '/app/settings';

/** Text only ever rendered inside the guarded subtree. */
const PROTECTED_HEADING = 'Squad settings';

/** A value the guarded content displays, which must vanish with the session. */
const PROTECTED_VALUE = 'Rating 1284';

/** Text only ever rendered by the Log_In_Route stand-in. */
const LOG_IN_HEADING = 'Log in';

/** Text only ever rendered by the public landing stand-in. */
const LANDING_TEXT = 'PitchMate landing';

/**
 * A {@link SessionManager} whose Auth_State a test can move.
 *
 * Only `getState` and `subscribe` carry behaviour — they are the two the
 * `AuthProvider` uses — so the remaining methods are inert. `set` notifies
 * subscribers exactly as the real manager does on a transition.
 */
function controllableManager(initial: AuthState): {
  readonly manager: SessionManager;
  readonly set: (next: AuthState) => void;
} {
  let state = initial;
  const listeners = new Set<(next: AuthState) => void>();

  const manager: SessionManager = {
    bootstrap: (): AuthState => state,
    establish: vi.fn(),
    getState: (): AuthState => state,
    getAccessTokenForRequest: vi.fn(async () => ({
      error: 'unauthenticated' as const,
    })),
    signOut: vi.fn(async () => {}),
    subscribe: (listener: (next: AuthState) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return {
    manager,
    set: (next: AuthState) => {
      state = next;
      for (const listener of listeners) {
        listener(next);
      }
    },
  };
}

/** The guarded content: a heading and a value, both private to the session. */
function ProtectedContent(): ReactElement {
  return (
    <>
      <h1>{PROTECTED_HEADING}</h1>
      <p>{PROTECTED_VALUE}</p>
    </>
  );
}

/**
 * Mount the guard behind a real router, at `initialPath`.
 *
 * `entries` seeds the history so a back navigation has somewhere to go, which is
 * what the replace-versus-push assertion needs.
 */
function renderGuard(options: {
  readonly state: AuthState;
  readonly initialPath?: string;
  readonly entries?: readonly string[];
  readonly children?: ReactNode;
}) {
  const { manager, set } = controllableManager(options.state);
  const initialPath = options.initialPath ?? SHELL_PATH;
  const entries = options.entries ?? [initialPath];

  const routes: RouteObject[] = [
    { path: '/', element: <p>{LANDING_TEXT}</p> },
    { path: LOG_IN_ROUTE, element: <h1>{LOG_IN_HEADING}</h1> },
    {
      path: '/app/*',
      element: (
        <RouteGuard>{options.children ?? <ProtectedContent />}</RouteGuard>
      ),
    },
  ];

  const router = createMemoryRouter(routes, {
    initialEntries: [...entries],
    initialIndex: entries.length - 1,
  });

  render(
    <AuthProvider manager={manager}>
      <RouterProvider router={router} />
    </AuthProvider>,
  );

  return { router, set };
}

/** The captured Redirect_Capture value of the router's current location. */
function capturedRedirect(search: string): string | null {
  return new URLSearchParams(search).get(REDIRECT_PARAM_NAME);
}

describe('RouteGuard — authenticated requests (Req 2.1)', () => {
  it('renders the wrapped subtree and issues no navigation', () => {
    const { router } = renderGuard({ state: 'authenticated' });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      PROTECTED_HEADING,
    );
    expect(screen.getByText(PROTECTED_VALUE)).toBeInTheDocument();
    // Still on the requested shell path: nothing navigated anywhere.
    expect(router.state.location.pathname).toBe(SHELL_PATH);
    expect(router.state.location.search).toBe('');
    expect(screen.queryByText(LOG_IN_HEADING)).not.toBeInTheDocument();
  });
});

describe('RouteGuard — unauthenticated requests (Req 2.2, 2.5, 2.6)', () => {
  it('renders no guarded content and navigates to the log-in route', () => {
    const { router } = renderGuard({ state: 'unauthenticated' });

    expect(screen.queryByText(PROTECTED_HEADING)).not.toBeInTheDocument();
    expect(screen.queryByText(PROTECTED_VALUE)).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe(LOG_IN_ROUTE);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      LOG_IN_HEADING,
    );
  });

  it('carries the requested path, query string, and fragment as one encoded value', () => {
    const requested = `${SHELL_PATH}?tab=appearance&q=a%20b#section`;
    const { router } = renderGuard({
      state: 'unauthenticated',
      initialPath: requested,
    });

    const captured = capturedRedirect(router.state.location.search);
    // Decoding yields the requested path character-for-character (Req 2.5).
    expect(captured).toBe(requested);
    // The parameter name is the Auth_Feature's, not a shell-local copy (Req 2.6).
    expect(router.state.location.search).toContain(`${REDIRECT_PARAM_NAME}=`);
  });

  it('captures a requested path of exactly the maximum length', () => {
    const requested = `/app/${'a'.repeat(MAX_CAPTURED_PATH_LENGTH - '/app/'.length)}`;
    expect(requested).toHaveLength(MAX_CAPTURED_PATH_LENGTH);

    const { router } = renderGuard({
      state: 'unauthenticated',
      initialPath: requested,
    });

    expect(router.state.location.pathname).toBe(LOG_IN_ROUTE);
    expect(capturedRedirect(router.state.location.search)).toBe(requested);
  });

  it('omits the redirect entirely above the maximum length (Req 2.7)', () => {
    const requested = `/app/${'a'.repeat(MAX_CAPTURED_PATH_LENGTH)}`;
    expect(requested.length).toBeGreaterThan(MAX_CAPTURED_PATH_LENGTH);

    const { router } = renderGuard({
      state: 'unauthenticated',
      initialPath: requested,
    });

    expect(router.state.location.pathname).toBe(LOG_IN_ROUTE);
    expect(router.state.location.search).toBe('');
    expect(capturedRedirect(router.state.location.search)).toBeNull();
  });

  it('replaces the requested shell path in history rather than pushing (Req 2.8)', async () => {
    const { router } = renderGuard({
      state: 'unauthenticated',
      entries: ['/', SHELL_PATH],
    });

    expect(router.state.location.pathname).toBe(LOG_IN_ROUTE);

    await act(async () => {
      await router.navigate(-1);
    });

    // The shell path was replaced, so back reaches what preceded it. Had the
    // guard pushed, back would land on the shell path and redirect again.
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByText(LANDING_TEXT)).toBeInTheDocument();
  });
});

describe('RouteGuard — a session ending mid-screen (Req 2.3, 2.4)', () => {
  it('stops rendering the content and its values when the state changes', async () => {
    const { router, set } = renderGuard({ state: 'authenticated' });

    expect(screen.getByText(PROTECTED_VALUE)).toBeInTheDocument();

    await act(async () => {
      set('unauthenticated');
    });

    expect(screen.queryByText(PROTECTED_HEADING)).not.toBeInTheDocument();
    expect(screen.queryByText(PROTECTED_VALUE)).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe(LOG_IN_ROUTE);
    expect(capturedRedirect(router.state.location.search)).toBe(SHELL_PATH);
  });
});
