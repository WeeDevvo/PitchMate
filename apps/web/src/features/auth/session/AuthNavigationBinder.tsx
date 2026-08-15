/**
 * AuthNavigationBinder — the React adapter that connects the framework-agnostic
 * auth navigation wiring to `react-router-dom`.
 *
 * The auth route table (and the `onSession`/`signOut` closures built over
 * {@link createAuthNavigation}) is constructed before the router mounts, so the
 * wiring navigates through a {@link NavigationController} whose delegate is
 * installed at runtime. This component — rendered once inside the router and the
 * auth providers, alongside the screen `Outlet` — does two jobs on the client:
 *
 * - **Install the navigate delegate.** It reads the router's `useNavigate` and
 *   installs it on the controller, so {@link createAuthNavigation}'s
 *   synchronous, client-side navigation (no full reload) reaches the router
 *   (Requirements 10.4, 11.1, 11.2).
 * - **Capture the pre-auth Redirect_Target.** It reads the current URL query
 *   string via `useLocation` and, when a Redirect_Target candidate is present,
 *   captures it into the {@link RedirectTargetStore} BEFORE authentication so it
 *   is available to resolve once a Session is established (Requirement 11.1).
 *
 * It renders nothing. Because it sits in the persistent layout route it stays
 * mounted across navigation between auth screens, keeping the delegate current
 * and re-capturing whenever the query string changes.
 *
 * Requirements: 10.4, 11.1, 11.2
 */
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  redirectCandidateFromSearch,
  REDIRECT_PARAM_NAME,
  type RedirectTargetStore,
} from './redirectTargetStore';
import type { NavigationController } from './authNavigation';

export interface AuthNavigationBinderProps {
  /** The controller whose navigate delegate is installed from `useNavigate`. */
  readonly controller: NavigationController;
  /** The store a captured pre-auth Redirect_Target candidate is written to. */
  readonly redirectStore: RedirectTargetStore;
  /**
   * The query-string parameter to read the Redirect_Target candidate from;
   * defaults to {@link REDIRECT_PARAM_NAME}.
   */
  readonly redirectParamName?: string;
}

/**
 * Bind the router's navigation and capture the pre-auth Redirect_Target.
 * Renders nothing.
 */
export function AuthNavigationBinder({
  controller,
  redirectStore,
  redirectParamName = REDIRECT_PARAM_NAME,
}: AuthNavigationBinderProps): null {
  const navigate = useNavigate();
  const location = useLocation();

  // Keep the controller's navigate delegate pointed at the current router
  // navigate function (Requirements 10.4, 11.1, 11.2).
  useEffect(() => {
    controller.setDelegate((path: string) => {
      navigate(path);
    });
  }, [controller, navigate]);

  // Capture a pre-auth Redirect_Target candidate from the URL query string,
  // before authentication, whenever the query string changes (Requirement 11.1).
  useEffect(() => {
    const candidate = redirectCandidateFromSearch(
      location.search,
      redirectParamName,
    );
    if (candidate !== null) {
      redirectStore.capture(candidate);
    }
  }, [location.search, redirectStore, redirectParamName]);

  return null;
}

export default AuthNavigationBinder;
