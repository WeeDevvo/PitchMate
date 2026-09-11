/**
 * The one application router: the marketing landing route, the Auth_Feature's
 * route table, and the App_Shell's routes, registered together, each path exactly
 * once (Requirement 15.6).
 *
 * Before this module existed, `main.tsx` registered only `/` and the auth route
 * table was built but never mounted, so `/login` resolved to no registered route.
 * This is the single place that composition happens, and the single place the
 * session-shaped values every feature needs are constructed.
 *
 * ### The registered routes
 *
 * | Route path | Element | Requirement |
 * | --- | --- | --- |
 * | `/` | `LandingPage` | 15.6 |
 * | `/signup`, `/login`, `/reset-password`, `/reset-password/confirm`, `/verify-email` | the Auth_Feature table via `createWiredAuthRoutes` | 15.6 |
 * | `/app`, `/app/notifications`, `/app/settings`, `/app/profile`, `/app/*` | the App_Shell table via `createShellRoutes` | 3.1, 3.9, 3.10, 15.4 |
 * | `*` | {@link AppNotFound} | 15.9 |
 *
 * The auth subtree is registered ahead of the shell subtree, and the
 * application-level catch-all last.
 *
 * ### Why the auth table's own `*` child is not registered here
 *
 * The Auth_Feature's route table carries a `*` child inside its **pathless**
 * layout route (its own feature-level not-found). A pathless parent contributes
 * nothing to the matched path, so that child registers the path `*` — the same
 * path as this router's application-level catch-all. `react-router` scores the two
 * identically and breaks the tie by registration order, so leaving it in place
 * would (a) register `*` twice, which Requirement 15.6 rules out, and (b) hand
 * every unmatched address to the auth feature's screen, which Requirement 15.9
 * rules out — it requires the not-found surface to render no Auth_Feature screen
 * and to offer the marketing landing route. This was confirmed by mounting both
 * and observing the auth fallback win.
 *
 * {@link withoutFeatureCatchAll} therefore drops that one child as the auth
 * subtree is registered, leaving {@link AppNotFound} as the application's single
 * `*`. The Auth_Feature's own fallback remains part of its table and its own
 * tests; it is simply not the *application's* not-found surface. The App_Shell's
 * `*` child is untouched, because it sits under the `/app` path and so registers
 * `/app/*` — a different, more specific path that Requirement 3.10 wants reached.
 *
 * ### What is constructed once, here
 *
 * The shell constructs no Api_Client and holds no session logic (Requirements
 * 11.1, 15.1, 15.2), so this module builds, exactly once per router:
 *
 * - the {@link AuthConfig} (routes, timeouts, Google client id);
 * - the unauthenticated auth Api_Client facade the auth screens call;
 * - the {@link SessionManager} over browser storage, bootstrapped **before** the
 *   router is created so a directly addressed `/app` sees the restored Session on
 *   its first render rather than bouncing through the Route_Guard;
 * - the Authenticated_Api_Client (the same manager's bearer middleware), which is
 *   what every notification call goes through (Requirement 11.1);
 * - the wired auth navigation, whose `signOut` the shell's Sign_Out_Control and
 *   session-expiry handover delegate to (Requirements 8.9, 9.4).
 *
 * ### Why the shell subtree carries the auth providers
 *
 * `AuthProvider` is supplied by the auth table for the auth screens only, so the
 * shell subtree is wrapped in its own `AuthProvider` over the **same**
 * {@link SessionManager} — one session model, two subtrees observing it — which is
 * what `RouteGuard`'s `useAuth()` reads (Requirement 2.1). The
 * `AuthNavigationBinder` is mounted alongside it so the Auth_Feature's navigation
 * controller has the router's `navigate` installed while a shell route is
 * displayed; without it, a sign-out started from the shell would have nowhere to
 * navigate on a session that never rendered an auth screen.
 *
 * Requirements: 11.1, 15.4, 15.6, 15.9
 */
import { Outlet, createBrowserRouter, type RouteObject } from 'react-router-dom';
import type { ClientOptions, PitchMateApiClient } from '@pitchmate/api-client';

import {
  AuthNavigationBinder,
  AuthProvider,
  authApiTimeoutsFromConfig,
  createAuthApi,
  createAuthConfig,
  createAuthenticatedApiClient,
  createLocalStorageSessionStore,
  createNavigationController,
  createSessionManager,
  createWiredAuthRoutes,
  sessionTuningFromConfig,
  LOG_IN_ROUTE,
  type AuthApi,
  type AuthApiFacade,
  type AuthConfig,
  type SessionManager,
} from '../features/auth';
import {
  createShellRoutes,
  type ShellDestinationContent,
} from '../features/app-shell';
import LandingPage from '../features/landing/LandingPage';
import { AppNotFound } from './AppNotFound';
import { APP_CATCH_ALL_ROUTE, LANDING_ROUTE } from './appRoutePaths';

/** What {@link createAppRoutes} builds for itself unless it is supplied. */
export interface AppRoutesOptions {
  /**
   * The auth configuration. Defaults to {@link createAuthConfig} over the build
   * environment, so the mandated route and timeout defaults apply.
   */
  readonly config?: AuthConfig;
  /**
   * The unauthenticated auth backend facade the auth screens call. Defaults to a
   * facade over the configured API base URL.
   */
  readonly authApi?: AuthApiFacade;
  /**
   * The session model. Defaults to one over browser storage. Whatever is used is
   * bootstrapped once, here, before the routes are handed back.
   */
  readonly sessionManager?: SessionManager;
  /**
   * The Authenticated_Api_Client every notification call is issued through.
   * Defaults to the bearer-attaching client over the session model
   * (Requirement 11.1).
   */
  readonly apiClient?: PitchMateApiClient;
  /**
   * The Google (OIDC) browser-flow seam. Defaults to a seam that yields nothing:
   * the browser flow itself is not part of this feature, and the
   * Google_Sign_In_Control already treats "nothing yielded" as an incomplete
   * attempt rather than a failure.
   */
  readonly requestGoogleAssertion?: () => Promise<string | null>;
  /**
   * The Destination_Content injected into the shell's Home, Profile, and Settings
   * Destinations. Omitted bodies render the shell's Unavailable_State
   * (Requirements 3.7, 3.8, 15.4).
   */
  readonly destinationContent?: ShellDestinationContent;
  /** The configured notification Poll_Interval in seconds (Requirement 4.6). */
  readonly pollIntervalSeconds?: number;
  /** The clock behind relative time labels; defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * Read a non-empty build-environment value, or `undefined`.
 *
 * The API base URL and the Google client id are deployment values, not code, so
 * they arrive through Vite's environment. An absent or empty value yields
 * `undefined` so the underlying default applies (a same-origin API for the
 * client, an empty client id for the config) rather than an empty string being
 * passed on as if it were configured.
 */
function environmentValue(key: string): string | undefined {
  const env = import.meta.env as unknown as Record<string, unknown>;
  const value = env[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** The `openapi-fetch` options both clients are built with. */
function clientOptions(): ClientOptions {
  const baseUrl = environmentValue('VITE_API_BASE_URL');
  return baseUrl === undefined ? {} : { baseUrl };
}

/** The Google browser flow is not wired yet; yielding nothing is its "cancelled". */
async function noGoogleAssertion(): Promise<string | null> {
  return null;
}

/**
 * Adapt the auth Api_Client facade onto the narrow refresh/sign-out seam the
 * {@link SessionManager} depends on.
 *
 * The two shapes differ deliberately: the facade speaks `ok`/`outcome` because
 * every screen presents outcomes the same way, while the session model speaks
 * `invalid-or-expired` versus `transport-failure` because those two failures lead
 * to opposite decisions — tear the Session down, or retain it and retry. This is
 * the one place the mapping is made, and it makes no authentication decision of
 * its own: `invalid-or-expired-token` is the only outcome that means the
 * Refresh_Token itself was rejected; everything else is inconclusive and so is
 * reported as a transport failure, which is the outcome the manager retries.
 */
function sessionApiFrom(facade: AuthApiFacade): AuthApi {
  return {
    async refresh(refreshToken: string) {
      const result = await facade.refresh(refreshToken);
      if (result.ok) {
        return { kind: 'success' as const, session: result.session };
      }
      return result.outcome.kind === 'invalid-or-expired-token'
        ? { kind: 'invalid-or-expired' as const }
        : { kind: 'transport-failure' as const };
    },

    async signOut(refreshToken: string) {
      const result = await facade.signOut(refreshToken);
      return result.ok ? { kind: 'success' as const } : { kind: 'failure' as const };
    },
  };
}

/**
 * Drop a feature route table's own top-level `*` child, so the application
 * registers exactly one catch-all (Requirements 15.6, 15.9).
 *
 * See the module note: a `*` child of a pathless layout route registers the path
 * `*`, which is the application catch-all's path, and `react-router` resolves
 * that tie by registration order. The table is copied rather than mutated, so the
 * feature's own array is left as the feature built it.
 */
function withoutFeatureCatchAll(routes: RouteObject[]): RouteObject[] {
  return routes.map((route) =>
    route.children === undefined
      ? route
      : {
          ...route,
          children: route.children.filter(
            (child) => child.path !== APP_CATCH_ALL_ROUTE,
          ),
        },
  );
}

/**
 * Assemble the application's route table.
 *
 * Everything the routes need is constructed here unless it is supplied — see
 * {@link AppRoutesOptions} — so a test can mount the real router with its own
 * session model and its own client.
 *
 * Requirements: 11.1, 15.4, 15.6, 15.9
 */
export function createAppRoutes(options: AppRoutesOptions = {}): RouteObject[] {
  const config =
    options.config ??
    createAuthConfig({
      googleClientId: environmentValue('VITE_GOOGLE_CLIENT_ID') ?? '',
    });

  const authApi =
    options.authApi ??
    createAuthApi({
      clientOptions: clientOptions(),
      timeouts: authApiTimeoutsFromConfig(config),
    });

  // Built before the session model so the model can route to the Log_In_Route
  // when a Session becomes unrecoverable; the binder installs the real navigate
  // function once the router mounts.
  const navigationController = createNavigationController();

  const sessionManager =
    options.sessionManager ??
    createSessionManager({
      storage: createLocalStorageSessionStore(),
      api: sessionApiFrom(authApi),
      now: () => Date.now(),
      ...sessionTuningFromConfig(config),
      onUnauthenticated: (): void => {
        navigationController.navigate(LOG_IN_ROUTE);
      },
    });

  // Restore a persisted Session before the router renders, so a directly
  // addressed `/app` is admitted by the Route_Guard on its first render pass.
  sessionManager.bootstrap();

  // 11.1: one Authenticated_Api_Client, carrying the session model's bearer
  // middleware, handed to the shell. The shell constructs none of its own.
  const apiClient =
    options.apiClient ?? createAuthenticatedApiClient(sessionManager, clientOptions());

  const auth = createWiredAuthRoutes({
    config,
    sessionManager,
    authApi,
    requestGoogleAssertion: options.requestGoogleAssertion ?? noGoogleAssertion,
    navigationController,
  });

  const shellRoutes = createShellRoutes({
    apiClient,
    // 8.9, 9.4: the Auth_Feature owns ending the Session and the navigation that
    // follows it; the shell only triggers it.
    signOut: auth.navigation.signOut,
    destinationContent: options.destinationContent,
    pollIntervalSeconds: options.pollIntervalSeconds,
    now: options.now,
  });

  return [
    { path: LANDING_ROUTE, element: <LandingPage /> },

    // The auth subtree ahead of the shell subtree, without its feature-level
    // catch-all (see the module note).
    ...withoutFeatureCatchAll(auth.routes),

    {
      // A pathless layout route: the same session model the auth screens observe,
      // plus the navigation binder, wrapped around the whole `/app` subtree.
      element: (
        <AuthProvider manager={sessionManager}>
          <AuthNavigationBinder
            controller={auth.navigationController}
            redirectStore={auth.redirectStore}
          />
          <Outlet />
        </AuthProvider>
      ),
      children: shellRoutes,
    },

    // 15.9: the application's single catch-all, reached by any path no route
    // above matched.
    { path: APP_CATCH_ALL_ROUTE, element: <AppNotFound /> },
  ];
}

/**
 * Create the browser router `main.tsx` mounts.
 *
 * Requirements: 15.6, 15.9
 */
export function createAppRouter(
  options: AppRoutesOptions = {},
): ReturnType<typeof createBrowserRouter> {
  return createBrowserRouter(createAppRoutes(options));
}

export default createAppRouter;
