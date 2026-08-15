/**
 * authRoutes — the auth feature's route table (Requirement 1).
 *
 * This module registers the five distinct, non-overlapping authentication
 * routes and the unmatched-route fallback as a single subtree that the app
 * router (`main.tsx`) spreads into its `react-router-dom` route list. Keeping
 * the table here — rather than inline in `main.tsx` — keeps the feature
 * self-contained under `apps/web/src/features/auth/` (Requirement 1.8) and makes
 * the routing independently testable (task 18.2) with injected, framework-free
 * dependencies.
 *
 * Route table (from the design's screen ⇄ path mapping):
 *
 *   | Screen                | Path                       |
 *   |-----------------------|----------------------------|
 *   | Sign_Up_Screen        | `/signup`                  |
 *   | Log_In_Screen         | `/login`                   |
 *   | Reset_Request_Screen  | `/reset-password`          |
 *   | Reset_Confirm_Screen  | `/reset-password/confirm`  |
 *   | Verify_Email_Screen   | `/verify-email`            |
 *   | AuthNotFound          | `*` (unmatched fallback)   |
 *
 * Behaviours satisfied here:
 *
 *   - **Distinct, non-overlapping routes (Requirements 1.1, 1.2).** Each screen
 *     is registered at its own path; `/reset-password` and
 *     `/reset-password/confirm` are separate, non-overlapping entries.
 *   - **Direct navigation (Requirement 1.3).** Because every screen is a
 *     first-class route, entering its address or following an external link
 *     renders it with no prior in-app navigation.
 *   - **Client-side Sign_Up ⇄ Log_In (Requirement 1.4).** The links between
 *     screens use the shared {@link LinkButton}, which navigates client-side
 *     with no full-document reload.
 *   - **Unmatched fallback (Requirement 1.7).** A catch-all `*` route renders
 *     {@link AuthNotFound}, which offers a control back to the Log_In_Screen.
 *
 * The five screens are wrapped once in a pathless layout route that provides the
 * live {@link ThemeProvider} (dark-mode-first theming) and the
 * {@link AuthProvider} (so session-aware screens such as the Verify_Email_Screen
 * can read `useAuth`). This module owns no session logic itself: it only wires
 * injected dependencies to the screens. The post-authentication redirect
 * resolution and sign-out navigation behaviours are layered on by app wiring
 * (task 19); this table just renders each screen with the dependencies it is
 * given.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 1.8
 */
import { Outlet, type RouteObject } from 'react-router-dom'
import type { ReactNode } from 'react'
import { ThemeProvider } from './components/ThemeProvider'
import { AuthProvider } from './session/AuthContext'
import type { SessionManager } from './session/SessionManager'
import type {
  AuthApiFacade,
  AuthSessionPayload,
  FailureOutcome,
} from './api/authApi'
import { SignUpScreen } from './SignUpScreen'
import { LogInScreen } from './LogInScreen'
import { ResetRequestScreen } from './ResetRequestScreen'
import { ResetConfirmScreen } from './ResetConfirmScreen'
import { VerifyEmailScreen } from './VerifyEmailScreen'
import { AuthNotFound } from './AuthNotFound'

// --- Canonical route paths (single source of truth for the route table) -----

/** Route path of the Sign_Up_Screen (Requirement 1.1). */
export const SIGN_UP_ROUTE = '/signup'
/** Route path of the Log_In_Screen (Requirement 1.1). */
export const LOG_IN_ROUTE = '/login'
/** Route path of the Reset_Request_Screen (Requirement 1.2). */
export const RESET_REQUEST_ROUTE = '/reset-password'
/** Route path of the Reset_Confirm_Screen (Requirement 1.2). */
export const RESET_CONFIRM_ROUTE = '/reset-password/confirm'
/** Route path of the Verify_Email_Screen (Requirement 1.2). */
export const VERIFY_EMAIL_ROUTE = '/verify-email'

/**
 * The full set of registered auth route paths, in registration order. Useful
 * for redirect-target auth-route rejection (Requirement 11.5) and for tests.
 */
export const AUTH_ROUTE_PATHS: readonly string[] = [
  SIGN_UP_ROUTE,
  LOG_IN_ROUTE,
  RESET_REQUEST_ROUTE,
  RESET_CONFIRM_ROUTE,
  VERIFY_EMAIL_ROUTE,
]

/**
 * The dependencies the auth screens need to function, injected by app wiring so
 * this route table stays free of session construction and transport concerns.
 */
export interface AuthRouteDeps {
  /**
   * The session model exposed to session-aware screens through the
   * {@link AuthProvider}. Its lifecycle (bootstrap at startup, sign-out
   * navigation) is owned by app wiring (task 19).
   */
  readonly sessionManager: SessionManager
  /**
   * The typed Api_Client facade every screen calls the backend through
   * (Requirement 12.1). The screens narrow it to the methods they use.
   */
  readonly authApi: AuthApiFacade
  /**
   * The Google (OIDC) browser-flow seam forwarded to the Google_Sign_In_Control
   * on the Sign_Up_Screen and Log_In_Screen. Resolves to a Google_Assertion, or
   * `null` when the flow is cancelled / yields nothing (Requirement 4.4).
   */
  readonly requestGoogleAssertion: () => Promise<string | null>
  /**
   * Called with the established session payload when a sign-in, Google sign-in,
   * or verification-then-continue returns a Session (Requirements 3.5, 4.3). App
   * wiring establishes it through the Session_Manager and navigates to the
   * resolved Redirect_Target (task 19).
   */
  readonly onSession: (session: AuthSessionPayload) => void
  /** Optional: notified when Google sign-in fails (Requirements 4.5, 4.8). */
  readonly onGoogleFailure?: (outcome: FailureOutcome) => void
  /**
   * The resolved same-origin Redirect_Target the Verify_Email_Screen proceeds to
   * on success WHERE a Session is already established (Requirement 7.3). App
   * wiring (task 19) supplies the resolved target; when omitted the screen uses
   * its own safe default.
   */
  readonly redirectTarget?: string
  /**
   * An optional node rendered once inside the theme and auth providers,
   * alongside the screen `Outlet`, in the persistent layout route. App wiring
   * (task 19) uses this to mount the `AuthNavigationBinder`, which installs the
   * router navigation and captures the pre-auth Redirect_Target. It renders no
   * visible UI; when omitted the layout is unchanged.
   */
  readonly withinProviders?: ReactNode
}

/**
 * Build the auth feature's route subtree for the app router (Requirement 1).
 *
 * Returns a single pathless layout route — providing the live theme and auth
 * contexts — whose children are the five screen routes plus the catch-all
 * {@link AuthNotFound}. Spread the result into the app router's top-level route
 * list.
 *
 * @example
 *   const router = createBrowserRouter([
 *     { path: '/', element: <LandingPage /> },
 *     ...createAuthRoutes(deps),
 *   ])
 */
export function createAuthRoutes(deps: AuthRouteDeps): RouteObject[] {
  const {
    sessionManager,
    authApi,
    requestGoogleAssertion,
    onSession,
    onGoogleFailure,
    redirectTarget,
    withinProviders,
  } = deps

  return [
    {
      // Pathless layout route: applies the dark-mode-first theme and the auth
      // context once for every auth screen (and the not-found fallback).
      element: (
        <ThemeProvider>
          <AuthProvider manager={sessionManager}>
            {withinProviders}
            <Outlet />
          </AuthProvider>
        </ThemeProvider>
      ),
      children: [
        {
          path: SIGN_UP_ROUTE,
          element: (
            <SignUpScreen
              authApi={authApi}
              requestGoogleAssertion={requestGoogleAssertion}
              onGoogleSession={onSession}
              onGoogleFailure={onGoogleFailure}
            />
          ),
        },
        {
          path: LOG_IN_ROUTE,
          element: (
            <LogInScreen
              authApi={authApi}
              requestGoogleAssertion={requestGoogleAssertion}
              onSession={onSession}
              onGoogleFailure={onGoogleFailure}
            />
          ),
        },
        {
          path: RESET_REQUEST_ROUTE,
          element: <ResetRequestScreen authApi={authApi} />,
        },
        {
          path: RESET_CONFIRM_ROUTE,
          element: <ResetConfirmScreen authApi={authApi} />,
        },
        {
          path: VERIFY_EMAIL_ROUTE,
          element: (
            <VerifyEmailScreen
              authApi={authApi}
              redirectTarget={redirectTarget}
            />
          ),
        },
        {
          // Requirement 1.7: any unmatched route renders the not-found screen,
          // which presents a control back to the Log_In_Screen.
          path: '*',
          element: <AuthNotFound />,
        },
      ],
    },
  ]
}

export default createAuthRoutes
