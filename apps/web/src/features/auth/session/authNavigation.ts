/**
 * Auth navigation wiring — the framework-agnostic edge that ties a newly
 * established Session (and an explicit sign-out) to in-app navigation.
 *
 * This is the app-wiring layer the screens delegate to (design: "app wiring
 * (task 19)"). The screens surface an established Session via their `onSession`
 * callback and never navigate themselves; this module owns the two navigation
 * behaviours the requirements place at the app edge:
 *
 * - **Post-authentication redirect (Requirements 11.1, 11.2, 11.6).**
 *   {@link AuthNavigation.onSession} establishes the Session through the
 *   {@link SessionManager}, then TAKES the captured Redirect_Target from the
 *   store (clearing it — single-use, Requirement 11.6), resolves it with
 *   `resolveRedirectTarget` to a safe same-origin path or the configured
 *   default (Requirements 11.1, 11.2), and navigates there synchronously (well
 *   within the 2-second window the requirements allow).
 * - **Post-sign-out navigation (Requirement 10.4).**
 *   {@link AuthNavigation.signOut} runs the {@link SessionManager} sign-out
 *   (which always ends unauthenticated) and then navigates to the configured
 *   Public_Post_Sign_Out_Route.
 *
 * It is deliberately framework-free: navigation happens through an injected
 * {@link NavigationSeam}, so this logic is deterministic and unit-testable
 * without a router. The React adapter (`AuthNavigationBinder`) bridges the
 * router's `useNavigate` onto a {@link NavigationController} that satisfies the
 * seam.
 *
 * Requirements: 10.4, 11.1, 11.2, 11.6
 */

import { resolveRedirectTarget } from '../lib/redirectTarget';
import {
  redirectResolutionConfigFromAuthConfig,
  type AuthConfig,
} from '../config/authConfig';
import type { AuthSessionPayload } from '../api/authApi';
import type { Session, SessionManager } from './SessionManager';
import type { RedirectTargetStore } from './redirectTargetStore';

/**
 * The minimal navigation capability this wiring needs: navigate to an in-app
 * path. Kept as a one-method seam so the wiring is framework-free and testable
 * with a spy; the React adapter delegates to the router's `useNavigate`.
 */
export interface NavigationSeam {
  /** Navigate to a same-origin in-app path (client-side, no full reload). */
  navigate(path: string): void;
}

/**
 * A {@link NavigationSeam} whose underlying navigate function can be set later.
 *
 * The route table (and therefore the `onSession`/`signOut` closures) is built
 * before the router mounts, but `useNavigate` is only available once a screen
 * renders inside the router. This controller bridges that gap: the wiring is
 * built against the controller up front, and the React binder installs the real
 * navigate function via {@link setDelegate} once mounted. Calls made before a
 * delegate is installed are dropped (there is nowhere to navigate yet).
 */
export interface NavigationController extends NavigationSeam {
  /** Install (or replace) the underlying navigate function. */
  setDelegate(navigate: (path: string) => void): void;
}

/**
 * Create a {@link NavigationController} with no delegate installed.
 *
 * Until {@link NavigationController.setDelegate} is called, {@link
 * NavigationController.navigate} is a no-op — there is no router to navigate
 * within yet — so the wiring can be constructed safely before the router
 * mounts.
 */
export function createNavigationController(): NavigationController {
  let delegate: ((path: string) => void) | null = null;

  return {
    setDelegate(navigate: (path: string) => void): void {
      delegate = navigate;
    },
    navigate(path: string): void {
      if (delegate !== null) {
        delegate(path);
      }
    },
  };
}

/** The collaborators {@link createAuthNavigation} wires together. */
export interface AuthNavigationDeps {
  /** The session model whose `establish`/`signOut` this wiring drives. */
  readonly sessionManager: SessionManager;
  /** The pre-auth Redirect_Target capture store (single-use). */
  readonly redirectStore: RedirectTargetStore;
  /** The auth configuration (routes, resolution config source). */
  readonly config: AuthConfig;
  /** Where navigation is performed. */
  readonly navigator: NavigationSeam;
}

/** The navigation triggers the app edge exposes. */
export interface AuthNavigation {
  /**
   * Establish a Session and navigate to the resolved Redirect_Target.
   *
   * Establishes the payload through the {@link SessionManager}, takes and clears
   * the captured Redirect_Target (single-use, Requirement 11.6), resolves it to
   * a safe destination (Requirements 11.1, 11.2), and navigates there.
   */
  onSession(payload: AuthSessionPayload): void;
  /**
   * Sign out and navigate to the Public_Post_Sign_Out_Route (Requirement 10.4).
   * Resolves once the {@link SessionManager} has ended the Session and
   * navigation has been requested.
   */
  signOut(): Promise<void>;
  /**
   * Resolve the CURRENTLY captured Redirect_Target without consuming it, for
   * screens that need to know the safe destination ahead of a Session (e.g. the
   * Verify_Email_Screen's success-with-session control). Returns the configured
   * default when nothing safe is captured.
   */
  resolveCapturedTarget(): string;
}

/**
 * Wire post-authentication redirect and post-sign-out navigation over the
 * injected collaborators.
 *
 * Requirements: 10.4, 11.1, 11.2, 11.6
 */
export function createAuthNavigation(deps: AuthNavigationDeps): AuthNavigation {
  const { sessionManager, redirectStore, config, navigator } = deps;
  const resolutionConfig = redirectResolutionConfigFromAuthConfig(config);

  return {
    onSession(payload: AuthSessionPayload): void {
      // Establish the Session first so the app is authenticated before it
      // navigates into an authenticated destination (Requirement 8.1).
      const session: Session = {
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        expiresAtMs: payload.expiresAtMs,
      };
      sessionManager.establish(session);

      // Take-once: consume and clear the captured candidate so it cannot be
      // reused on a subsequent authentication (Requirement 11.6).
      const candidate = redirectStore.take();
      // Resolve to a safe same-origin path or the configured default
      // (Requirements 11.1, 11.2); never a cross-origin destination.
      const target = resolveRedirectTarget(candidate, resolutionConfig);

      // Synchronous navigation — comfortably within the 2s window the
      // requirements allow (Requirements 11.1, 11.2).
      navigator.navigate(target);
    },

    async signOut(): Promise<void> {
      // Always ends unauthenticated regardless of backend outcome (Req 10.2/10.3).
      await sessionManager.signOut();
      // Then route to the configured public post-sign-out destination (Req 10.4).
      navigator.navigate(config.publicPostSignOutRoute);
    },

    resolveCapturedTarget(): string {
      return resolveRedirectTarget(redirectStore.peek(), resolutionConfig);
    },
  };
}
