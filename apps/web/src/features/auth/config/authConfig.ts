/**
 * AuthConfig — the single configuration record for the web auth feature.
 *
 * The auth feature is deliberately parameterised rather than hard-coded: the
 * post-authentication routes, the token timeouts/margins, and the Google OIDC
 * public client id all live here so the pure logic (`resolveRedirectTarget`,
 * `isRefreshRequired`, the {@link SessionManager}, and the Api_Client facade)
 * receives its knobs from one place (design: "Configuration model"). This keeps
 * the framework-free logic testable and lets the running app, tests, and future
 * environments supply their own values.
 *
 * This module is framework-free (no React, no DOM). It exposes:
 *
 * - {@link AuthConfig} — the config record shape (design "Configuration model").
 * - {@link createAuthConfig} — build a config from partial overrides, applying
 *   the mandated defaults and clamping the tunables into their valid ranges
 *   (Renewal_Margin into 15..300s per Requirement 9.1; the sign-out timeout to
 *   at most 5s per Requirement 10.3).
 * - {@link redirectResolutionConfigFromAuthConfig} — derive the
 *   {@link RedirectResolutionConfig} that `resolveRedirectTarget` consumes
 *   (Requirements 11.2, 11.3, 11.5), so the redirect resolver and the router
 *   share one source of truth for the default route and the auth-route list.
 *
 * Requirements: 9.1, 10.3, 11.2, 11.3, 11.5
 */

import {
  clampRenewalMargin,
  RENEWAL_MARGIN_DEFAULT_MS,
} from '../lib/accessTokenExpiry';
import type { RedirectResolutionConfig } from '../lib/redirectTarget';
import { AUTH_ROUTE_PATHS } from '../authRoutes';

/**
 * The configuration record for the web auth feature (design "Configuration
 * model"). Route paths, timeouts, and the Google client id are configuration —
 * never hard-coded in the pure logic.
 */
export interface AuthConfig {
  /**
   * Default_Authenticated_Route — the same-origin in-app route navigated to
   * after authentication when no valid Redirect_Target is available
   * (Requirement 11.2).
   */
  readonly defaultAuthenticatedRoute: string;
  /**
   * Public_Post_Sign_Out_Route — the public (unauthenticated) route navigated
   * to once a sign-out completes (Requirement 10.4).
   */
  readonly publicPostSignOutRoute: string;
  /**
   * The registered authentication route paths, used to reject a captured
   * Redirect_Target that resolves to an auth route (Requirement 11.5).
   */
  readonly authRoutePaths: readonly string[];
  /**
   * Renewal_Margin in milliseconds: the lead time before Access_Token expiry at
   * which a refresh is triggered. Defaults to 60s, clamped to 15..300s
   * (Requirement 9.1).
   */
  readonly renewalMarginMs: number;
  /** Per-attempt refresh timeout in ms; defaults to 10s (Requirement 9.4). */
  readonly refreshTimeoutMs: number;
  /** Sign-out call timeout in ms; capped at 5s (Requirement 10.3). */
  readonly signOutTimeoutMs: number;
  /** General Api_Client call timeout in ms; defaults to 30s (Requirement 12.5). */
  readonly callTimeoutMs: number;
  /** Google OIDC public client id (not a secret). */
  readonly googleClientId: string;
}

/** The maximum accepted length of a captured Redirect_Target (Requirement 11.3). */
export const REDIRECT_TARGET_MAX_LENGTH = 2048;

/** Default refresh per-attempt timeout in ms (Requirement 9.4). */
export const REFRESH_TIMEOUT_DEFAULT_MS = 10_000;
/** Maximum permitted sign-out timeout in ms (Requirement 10.3). */
export const SIGN_OUT_TIMEOUT_MAX_MS = 5_000;
/** Default general Api_Client call timeout in ms (Requirement 12.5). */
export const CALL_TIMEOUT_DEFAULT_MS = 30_000;

/** The default Default_Authenticated_Route when none is configured. */
export const DEFAULT_AUTHENTICATED_ROUTE = '/app';
/** The default Public_Post_Sign_Out_Route when none is configured. */
export const DEFAULT_PUBLIC_POST_SIGN_OUT_ROUTE = '/';

/**
 * Clamp the sign-out timeout to at most {@link SIGN_OUT_TIMEOUT_MAX_MS}
 * (Requirement 10.3), and to a strictly positive value so a non-sensical
 * non-positive input cannot disable the bound entirely.
 */
export function clampSignOutTimeout(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) {
    return SIGN_OUT_TIMEOUT_MAX_MS;
  }
  return Math.min(ms, SIGN_OUT_TIMEOUT_MAX_MS);
}

/**
 * Build an {@link AuthConfig} from partial overrides, applying the mandated
 * defaults and clamping the tunables into their valid ranges.
 *
 * - `renewalMarginMs` is clamped into 15..300s via {@link clampRenewalMargin}
 *   (Requirement 9.1).
 * - `signOutTimeoutMs` is capped at 5s via {@link clampSignOutTimeout}
 *   (Requirement 10.3).
 * - `authRoutePaths` defaults to the feature's registered routes
 *   ({@link AUTH_ROUTE_PATHS}) so the redirect resolver rejects auth routes
 *   without duplicating the list (Requirement 11.5).
 *
 * Requirements: 9.1, 10.3, 11.2, 11.5, 12.5
 */
export function createAuthConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    defaultAuthenticatedRoute:
      overrides.defaultAuthenticatedRoute ?? DEFAULT_AUTHENTICATED_ROUTE,
    publicPostSignOutRoute:
      overrides.publicPostSignOutRoute ?? DEFAULT_PUBLIC_POST_SIGN_OUT_ROUTE,
    authRoutePaths: overrides.authRoutePaths ?? AUTH_ROUTE_PATHS,
    renewalMarginMs: clampRenewalMargin(
      overrides.renewalMarginMs ?? RENEWAL_MARGIN_DEFAULT_MS,
    ),
    refreshTimeoutMs: overrides.refreshTimeoutMs ?? REFRESH_TIMEOUT_DEFAULT_MS,
    signOutTimeoutMs: clampSignOutTimeout(
      overrides.signOutTimeoutMs ?? SIGN_OUT_TIMEOUT_MAX_MS,
    ),
    callTimeoutMs: overrides.callTimeoutMs ?? CALL_TIMEOUT_DEFAULT_MS,
    googleClientId: overrides.googleClientId ?? '',
  };
}

/**
 * Derive the {@link RedirectResolutionConfig} consumed by `resolveRedirectTarget`
 * from an {@link AuthConfig}, so the redirect resolver and the router share one
 * source of truth for the default route and the auth-route list.
 *
 * Requirements: 11.2, 11.3, 11.5
 */
export function redirectResolutionConfigFromAuthConfig(
  config: AuthConfig,
): RedirectResolutionConfig {
  return {
    defaultAuthenticatedRoute: config.defaultAuthenticatedRoute,
    authRoutePaths: config.authRoutePaths,
    maxLength: REDIRECT_TARGET_MAX_LENGTH,
  };
}
