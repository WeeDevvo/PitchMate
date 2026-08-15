/**
 * Routing integration tests for the auth feature's route table (task 18.2).
 *
 * `createAuthRoutes` (task 18.1) registers the five distinct, non-overlapping
 * authentication routes plus the unmatched-route fallback as a single subtree
 * that the app router spreads into its `react-router-dom` route list. These
 * tests drive that subtree through `createMemoryRouter` / `RouterProvider` — the
 * same client-side router the app uses — with injected, framework-free fakes for
 * the screen dependencies (`authApi`, `sessionManager`, the Google flow seam).
 *
 * They cover Requirement 1's observable routing behaviours:
 *
 *   - **Direct navigation (Requirements 1.1, 1.2, 1.3).** Pointing the router's
 *     `initialEntries` at each registered path renders exactly that screen with
 *     no prior in-app navigation. All five paths are distinct and
 *     non-overlapping, so `/reset-password` and `/reset-password/confirm` each
 *     resolve to their own screen.
 *   - **Client-side Sign_Up ⇄ Log_In switch (Requirement 1.4).** Activating the
 *     in-app link control from the Log_In_Screen to the Sign_Up_Screen changes
 *     the router location and swaps the rendered screen without a full-document
 *     reload — asserted via router state and the rendered heading (no page
 *     reload occurs under `RouterProvider`, which navigates client-side).
 *   - **Unmatched fallback (Requirement 1.7).** Any unregistered auth path
 *     renders `AuthNotFound`, which presents a control that navigates
 *     (client-side) to the Log_In_Screen.
 *
 * Feature: web-auth-screens
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.7
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import {
  createAuthRoutes,
  SIGN_UP_ROUTE,
  LOG_IN_ROUTE,
  RESET_REQUEST_ROUTE,
  RESET_CONFIRM_ROUTE,
  VERIFY_EMAIL_ROUTE,
  type AuthRouteDeps,
} from './authRoutes'
import type { AuthApiFacade } from './api/authApi'
import type { AuthState, SessionManager } from './session/SessionManager'
import { SIGN_UP_HEADING } from './SignUpScreen'
import { LOG_IN_HEADING } from './LogInScreen'
import { RESET_REQUEST_HEADING } from './ResetRequestScreen'
import { RESET_CONFIRM_HEADING } from './ResetConfirmScreen'
import { VERIFY_EMAIL_HEADING } from './VerifyEmailScreen'
import { AUTH_NOT_FOUND_HEADING, BACK_TO_LOG_IN_LABEL } from './AuthNotFound'

/**
 * A minimal fake {@link SessionManager} for the {@link AuthProvider} wrapped
 * around the screens. The provider only reads `getState()` and `subscribe()`;
 * this feature under test performs no session transitions, so the remaining
 * methods are inert stubs. It reports `unauthenticated`, which is all the
 * routing behaviours here depend on.
 */
function fakeSessionManager(): SessionManager {
  return {
    bootstrap: vi.fn((): AuthState => 'unauthenticated'),
    establish: vi.fn(),
    getState: vi.fn((): AuthState => 'unauthenticated'),
    getAccessTokenForRequest: vi.fn(async () => ({
      error: 'unauthenticated' as const,
    })),
    signOut: vi.fn(async () => {}),
    subscribe: vi.fn(() => () => {}),
  }
}

/**
 * A fake typed Api_Client facade. None of the routing behaviours under test
 * invoke a backend call (direct navigation just renders; the Verify_Email_Screen
 * makes no call when opened with no token), but the screens still need a facade
 * shaped like {@link AuthApiFacade}, so every method is a harmless stub.
 */
function fakeAuthApi(): AuthApiFacade {
  const noop = vi.fn()
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
  } as unknown as AuthApiFacade
}

/** Build the injected route dependencies with per-test overrides. */
function makeDeps(overrides: Partial<AuthRouteDeps> = {}): AuthRouteDeps {
  return {
    sessionManager: fakeSessionManager(),
    authApi: fakeAuthApi(),
    requestGoogleAssertion: vi.fn(async () => null),
    onSession: vi.fn(),
    ...overrides,
  }
}

/**
 * Render the auth route subtree through the real client-side router, starting
 * at `initialPath`. Returns the router so tests can assert on its location.
 */
function renderAt(initialPath: string, deps: AuthRouteDeps = makeDeps()) {
  const router = createMemoryRouter(createAuthRoutes(deps), {
    initialEntries: [initialPath],
  })
  render(<RouterProvider router={router} />)
  return { router }
}

/** The single `h1` for the currently rendered screen. */
function heading() {
  return screen.getByRole('heading', { level: 1 })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createAuthRoutes — direct navigation renders each screen (Req 1.1, 1.2, 1.3)', () => {
  it.each([
    [SIGN_UP_ROUTE, SIGN_UP_HEADING],
    [LOG_IN_ROUTE, LOG_IN_HEADING],
    [RESET_REQUEST_ROUTE, RESET_REQUEST_HEADING],
    [RESET_CONFIRM_ROUTE, RESET_CONFIRM_HEADING],
    [VERIFY_EMAIL_ROUTE, VERIFY_EMAIL_HEADING],
  ])(
    'renders the screen registered at %s on direct navigation',
    async (path, expectedHeading) => {
      renderAt(path)

      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
        expectedHeading,
      )
    },
  )

  it('registers reset-request and reset-confirm as distinct, non-overlapping routes', async () => {
    // `/reset-password` and `/reset-password/confirm` must resolve to different
    // screens (Requirement 1.2), proving they do not overlap.
    renderAt(RESET_REQUEST_ROUTE)
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      RESET_REQUEST_HEADING,
    )
    expect(screen.queryByText(RESET_CONFIRM_HEADING)).not.toBeInTheDocument()
  })
})

describe('createAuthRoutes — Sign_Up ⇄ Log_In client-side switch (Req 1.4)', () => {
  it('navigates from the Log_In_Screen to the Sign_Up_Screen without a full-document reload', async () => {
    const user = userEvent.setup()
    const { router } = renderAt(LOG_IN_ROUTE)

    // Start on the Log_In_Screen.
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      LOG_IN_HEADING,
    )

    // Activate the in-app link control that switches to the Sign_Up_Screen.
    await user.click(screen.getByRole('link', { name: /create an account/i }))

    // The target screen renders and the router location changed to /signup —
    // a client-side navigation, not a full-document reload (RouterProvider
    // never reloads the document; the switch is proven by router state + the
    // swapped heading).
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(SIGN_UP_ROUTE),
    )
    expect(heading()).toHaveTextContent(SIGN_UP_HEADING)
    expect(screen.queryByText(LOG_IN_HEADING)).not.toBeInTheDocument()
  })
})

describe('createAuthRoutes — unmatched route renders AuthNotFound (Req 1.7)', () => {
  it('renders the not-found screen for an unregistered auth path', async () => {
    renderAt('/nonexistent-auth-route')

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      AUTH_NOT_FOUND_HEADING,
    )
    // And it presents a control back to the Log_In_Screen.
    expect(
      screen.getByRole('link', { name: BACK_TO_LOG_IN_LABEL }),
    ).toBeInTheDocument()
  })

  it('navigates from AuthNotFound to the Log_In_Screen via its control (client-side)', async () => {
    const user = userEvent.setup()
    const { router } = renderAt('/nonexistent-auth-route')

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      AUTH_NOT_FOUND_HEADING,
    )

    await user.click(screen.getByRole('link', { name: BACK_TO_LOG_IN_LABEL }))

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(LOG_IN_ROUTE),
    )
    expect(heading()).toHaveTextContent(LOG_IN_HEADING)
  })
})
