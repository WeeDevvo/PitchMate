/**
 * Integration tests for the wired auth navigation (task 19.2).
 *
 * `createWiredAuthRoutes` (task 19.1) composes the auth route table with the
 * post-authentication redirect wiring (`createAuthNavigation` over a single-use
 * `RedirectTargetStore` and a `NavigationController`) and mounts the
 * `AuthNavigationBinder` inside the auth providers so the pre-auth
 * Redirect_Target is captured from the URL and client-side navigation reaches
 * the router. These tests exercise that whole assembly through the real
 * client-side router (`createMemoryRouter` / `RouterProvider`) — the same router
 * the app uses — with a real `SessionManager` and injected, framework-free fakes
 * for the backend seams. They avoid unit-level shortcuts so the capture →
 * resolve → navigate → clear round-trip is proven end-to-end.
 *
 * They cover the two navigation behaviours the requirements place at the app
 * edge:
 *
 *   - **Single-use Redirect_Target (Requirement 11.6).** A candidate captured
 *     from `/login?redirect=/squads/123` is used exactly once on authentication:
 *     the router navigates there, the store is cleared, and a SUBSEQUENT
 *     authentication (with no fresh capture) falls back to the
 *     Default_Authenticated_Route rather than reusing the stale target.
 *   - **Post-sign-out navigation (Requirement 10.4).** After a Session is
 *     established, invoking the wired `signOut` (the trigger the app-shell
 *     control calls) ends the Session unauthenticated and navigates to the
 *     configured Public_Post_Sign_Out_Route.
 *
 * Destination routes (`/app`, `/goodbye`, `/squads/:id`) are added as children
 * of the auth layout route so the `AuthNavigationBinder` stays mounted across
 * every navigation — mirroring how the app spreads these auth routes alongside
 * its own routes under a shared shell — which keeps the installed navigate
 * delegate live for the assertions.
 *
 * Feature: web-auth-screens
 * Validates: Requirements 11.6, 10.4
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createMemoryRouter,
  RouterProvider,
  type RouteObject,
} from 'react-router-dom'
import { createWiredAuthRoutes } from './authWiring'
import { createAuthConfig } from './config/authConfig'
import { createSessionManager, type AuthApi } from './session/SessionManager'
import { createInMemorySessionStore } from './session/SessionStore'
import { LOG_IN_HEADING } from './LogInScreen'
import type {
  AuthApiFacade,
  AuthSessionPayload,
  AuthSessionResult,
} from './api/authApi'

/** Valid credentials that pass the Log_In_Screen's non-empty validation. */
const VALID_EMAIL = 'player@pitch-mate.co.uk'
const VALID_PASSWORD = 'a-very-strong-password'

/** The session payload a successful sign-in returns. */
const SESSION: AuthSessionPayload = {
  accessToken: 'access-token-abc',
  refreshToken: 'refresh-token-xyz',
  expiresAtMs: 1_900_000_000_000,
}

/**
 * A no-op backend {@link AuthApi} for the real {@link SessionManager}. Sign-out
 * reports success (the SessionManager clears state regardless); refresh is never
 * reached in these flows.
 */
function backendApi(): AuthApi {
  return {
    refresh: vi.fn(async () => ({ kind: 'transport-failure' as const })),
    signOut: vi.fn(async () => ({ kind: 'success' as const })),
  }
}

/** Build a real {@link SessionManager} over in-memory storage. */
function buildSessionManager(api: AuthApi) {
  return createSessionManager({
    storage: createInMemorySessionStore(),
    api,
    now: () => 1_000,
    renewalMarginMs: 60_000,
    refreshTimeoutMs: 10_000,
    signOutTimeoutMs: 5_000,
    onUnauthenticated: () => {},
  })
}

/**
 * A fake typed Api_Client facade whose `signIn` returns a Session by default.
 * The wiring only routes the returned payload; the other methods are stubs.
 */
function fakeFacade(
  signInResult: AuthSessionResult = { ok: true, session: SESSION },
): AuthApiFacade {
  const ack = vi.fn(async () => ({ ok: true }))
  return {
    register: ack,
    signIn: vi.fn(async (): Promise<AuthSessionResult> => signInResult),
    signInGoogle: vi.fn(
      async (): Promise<AuthSessionResult> => ({ ok: true, session: SESSION }),
    ),
    refresh: vi.fn(
      async (): Promise<AuthSessionResult> => ({ ok: true, session: SESSION }),
    ),
    requestPasswordReset: ack,
    redeemPasswordReset: ack,
    redeemEmailVerification: ack,
    requestEmailVerification: ack,
    signOut: ack,
  } as unknown as AuthApiFacade
}

/** A visible destination screen so navigation targets render a real element. */
function Destination({ label }: { label: string }) {
  return <h1>{label}</h1>
}

/**
 * Add the post-auth destination routes as children of the auth layout route so
 * the {@link AuthNavigationBinder} (mounted in that layout) stays mounted across
 * navigation, keeping its installed navigate delegate live.
 */
function withDestinations(routes: RouteObject[]): RouteObject[] {
  const [layout, ...rest] = routes
  const children = layout.children ?? []
  const catchAll = children.filter((child) => child.path === '*')
  const named = children.filter((child) => child.path !== '*')
  return [
    {
      ...layout,
      children: [
        ...named,
        { path: '/app', element: <Destination label="App Home" /> },
        { path: '/goodbye', element: <Destination label="Goodbye" /> },
        { path: '/squads/:id', element: <Destination label="Squad Home" /> },
        ...catchAll,
      ],
    },
    ...rest,
  ]
}

/** Assemble the wired routes and render them through the real router. */
function setup(initialPath: string, facade: AuthApiFacade = fakeFacade()) {
  const backend = backendApi()
  const sessionManager = buildSessionManager(backend)
  const wired = createWiredAuthRoutes({
    config: createAuthConfig({
      defaultAuthenticatedRoute: '/app',
      publicPostSignOutRoute: '/goodbye',
    }),
    sessionManager,
    authApi: facade,
    requestGoogleAssertion: vi.fn(async () => null),
  })
  const router = createMemoryRouter(withDestinations(wired.routes), {
    initialEntries: [initialPath],
  })
  render(<RouterProvider router={router} />)
  return { router, wired, sessionManager, backend }
}

/** Fill and submit the Log_In_Screen credential form. */
async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Email address'), VALID_EMAIL)
  await user.type(screen.getByLabelText('Password'), VALID_PASSWORD)
  await user.click(screen.getByRole('button', { name: /log in/i }))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createWiredAuthRoutes — single-use Redirect_Target (Req 11.6)', () => {
  it('uses a captured target once, clears it, and does not reuse it on the next authentication', async () => {
    const user = userEvent.setup()
    const { router, wired } = setup('/login?redirect=/squads/123')

    // The Log_In_Screen renders and the binder captured the pre-auth candidate.
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      LOG_IN_HEADING,
    )
    await waitFor(() =>
      expect(wired.redirectStore.peek()).toBe('/squads/123'),
    )

    // Authenticate: the wiring resolves and navigates to the captured target…
    await signIn(user)
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/squads/123'),
    )
    // …and clears it (single-use).
    expect(wired.redirectStore.peek()).toBeNull()

    // A subsequent authentication with no fresh capture must fall back to the
    // Default_Authenticated_Route, never reusing the consumed target.
    await act(async () => {
      await router.navigate('/login')
    })
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      LOG_IN_HEADING,
    )
    await signIn(user)

    await waitFor(() => expect(router.state.location.pathname).toBe('/app'))
    expect(router.state.location.pathname).not.toBe('/squads/123')
  })
})

describe('createWiredAuthRoutes — post-sign-out navigation (Req 10.4)', () => {
  it('navigates to the Public_Post_Sign_Out_Route once sign-out completes', async () => {
    const user = userEvent.setup()
    const { router, wired, sessionManager } = setup('/login')

    // Establish a Session first.
    await signIn(user)
    await waitFor(() => expect(router.state.location.pathname).toBe('/app'))
    expect(sessionManager.getState()).toBe('authenticated')

    // The app-shell sign-out control invokes the wired signOut trigger.
    await act(async () => {
      await wired.navigation.signOut()
    })

    await waitFor(() => expect(router.state.location.pathname).toBe('/goodbye'))
    expect(sessionManager.getState()).toBe('unauthenticated')
  })
})
