/**
 * Auth wiring — the top-level composition that assembles the auth route table
 * with post-authentication redirect and post-sign-out navigation (task 19.1).
 *
 * The screens and route table are deliberately session- and navigation-free:
 * they surface an established Session via `onSession` and never navigate
 * themselves. This module is the app edge that supplies those behaviours from
 * an {@link AuthConfig}:
 *
 * - It builds the {@link AuthNavigation} wiring over the {@link SessionManager},
 *   a single-use {@link RedirectTargetStore}, and a {@link NavigationController}
 *   (whose real navigate function the {@link AuthNavigationBinder} installs once
 *   the router mounts).
 * - It passes `onSession` (establish + resolve Redirect_Target + navigate,
 *   clearing the target — Requirements 11.1, 11.2, 11.6) and a resolved
 *   `redirectTarget` for the Verify_Email_Screen into {@link createAuthRoutes}.
 * - It mounts the {@link AuthNavigationBinder} inside the auth providers so the
 *   pre-auth Redirect_Target is captured from the URL and client-side
 *   navigation reaches the router (Requirements 10.4, 11.1).
 * - It exposes the wired {@link AuthNavigation.signOut} for the app-shell
 *   sign-out control to call, which navigates to the Public_Post_Sign_Out_Route
 *   on completion (Requirement 10.4).
 *
 * It also exposes small helpers to derive the {@link SessionManager} tuning and
 * the Api_Client timeout budgets from an {@link AuthConfig}, so the whole
 * feature is configured from one record (routes, timeouts, Google client id).
 *
 * Requirements: 10.4, 11.1, 11.2, 11.6
 */
import type { RouteObject } from 'react-router-dom';
import type { AuthConfig } from './config/authConfig';
import type { AuthApiFacade, AuthApiTimeouts, FailureOutcome } from './api/authApi';
import type { SessionManager } from './session/SessionManager';
import {
  createAuthNavigation,
  createNavigationController,
  type AuthNavigation,
  type NavigationController,
} from './session/authNavigation';
import {
  createRedirectTargetStore,
  REDIRECT_PARAM_NAME,
  type RedirectTargetStore,
} from './session/redirectTargetStore';
import { AuthNavigationBinder } from './session/AuthNavigationBinder';
import { createAuthRoutes } from './authRoutes';

/** Options for {@link createWiredAuthRoutes}. */
export interface WiredAuthRoutesOptions {
  /** The auth configuration (routes, timeouts, Google client id). */
  readonly config: AuthConfig;
  /** The session model whose lifecycle the navigation wiring drives. */
  readonly sessionManager: SessionManager;
  /** The typed Api_Client facade every screen calls the backend through. */
  readonly authApi: AuthApiFacade;
  /**
   * The Google (OIDC) browser-flow seam forwarded to the Google_Sign_In_Control.
   * Resolves to a Google_Assertion, or `null` when cancelled / yielding nothing.
   */
  readonly requestGoogleAssertion: () => Promise<string | null>;
  /** Optional: notified when Google sign-in fails (Requirements 4.5, 4.8). */
  readonly onGoogleFailure?: (outcome: FailureOutcome) => void;
  /**
   * The pre-auth Redirect_Target capture store. Defaults to a fresh in-memory
   * store; injectable so app wiring and tests can observe capture/clear.
   */
  readonly redirectStore?: RedirectTargetStore;
  /**
   * The navigation controller whose delegate the binder installs. Defaults to a
   * fresh controller; injectable so tests can spy on navigation.
   */
  readonly navigationController?: NavigationController;
  /**
   * The query-string parameter carrying the pre-auth Redirect_Target candidate;
   * defaults to {@link REDIRECT_PARAM_NAME}.
   */
  readonly redirectParamName?: string;
}

/** The assembled auth routing plus the navigation triggers the app shell needs. */
export interface WiredAuthRoutes {
  /** The route subtree to spread into the app router. */
  readonly routes: RouteObject[];
  /** The wired navigation (notably `signOut`, for the app-shell control). */
  readonly navigation: AuthNavigation;
  /** The single-use Redirect_Target store (exposed for observation/testing). */
  readonly redirectStore: RedirectTargetStore;
  /** The navigation controller (exposed for observation/testing). */
  readonly navigationController: NavigationController;
}

/**
 * Assemble the auth route subtree with redirect and sign-out navigation wired.
 *
 * Spread {@link WiredAuthRoutes.routes} into the app router's top-level route
 * list, and use {@link WiredAuthRoutes.navigation}`.signOut` from the app-shell
 * sign-out control.
 *
 * Requirements: 10.4, 11.1, 11.2, 11.6
 */
export function createWiredAuthRoutes(
  options: WiredAuthRoutesOptions,
): WiredAuthRoutes {
  const {
    config,
    sessionManager,
    authApi,
    requestGoogleAssertion,
    onGoogleFailure,
    redirectParamName = REDIRECT_PARAM_NAME,
  } = options;

  const redirectStore = options.redirectStore ?? createRedirectTargetStore();
  const navigationController =
    options.navigationController ?? createNavigationController();

  const navigation = createAuthNavigation({
    sessionManager,
    redirectStore,
    config,
    navigator: navigationController,
  });

  const routes = createAuthRoutes({
    sessionManager,
    authApi,
    requestGoogleAssertion,
    onSession: navigation.onSession,
    onGoogleFailure,
    // The Verify_Email_Screen's success-with-session control proceeds to the
    // safe resolved destination; with no captured target this is the default
    // authenticated route (Requirement 7.3).
    redirectTarget: navigation.resolveCapturedTarget(),
    withinProviders: (
      <AuthNavigationBinder
        controller={navigationController}
        redirectStore={redirectStore}
        redirectParamName={redirectParamName}
      />
    ),
  });

  return { routes, navigation, redirectStore, navigationController };
}

/** The {@link SessionManager} tuning derived from an {@link AuthConfig}. */
export interface SessionTuning {
  readonly renewalMarginMs: number;
  readonly refreshTimeoutMs: number;
  readonly signOutTimeoutMs: number;
}

/**
 * Derive the {@link SessionManager} tuning (margins/timeouts) from an
 * {@link AuthConfig}, so the session model is configured from the one record
 * (Requirements 9.1, 9.4, 10.3).
 */
export function sessionTuningFromConfig(config: AuthConfig): SessionTuning {
  return {
    renewalMarginMs: config.renewalMarginMs,
    refreshTimeoutMs: config.refreshTimeoutMs,
    signOutTimeoutMs: config.signOutTimeoutMs,
  };
}

/**
 * Derive the Api_Client timeout budgets from an {@link AuthConfig}: the general
 * call timeout, the refresh timeout, and the sign-out timeout come from config;
 * the reset-request and email-verification-redeem budgets keep their mandated
 * 10-second defaults (Requirement 12.5).
 */
export function authApiTimeoutsFromConfig(
  config: AuthConfig,
): Partial<AuthApiTimeouts> {
  return {
    generalMs: config.callTimeoutMs,
    refreshMs: config.refreshTimeoutMs,
    signOutMs: config.signOutTimeoutMs,
  };
}
