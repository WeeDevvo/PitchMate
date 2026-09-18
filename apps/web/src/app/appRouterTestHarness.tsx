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
 * not-found, squads Property 48 path uniqueness), and a second copy of the stubs
 * is a second thing to keep in step. The same reasoning puts
 * {@link registeredPaths} here: more than one property reads the assembled
 * table's paths, and two copies of that flattening could drift into disagreeing
 * about what "registered once" means. It follows the existing `…TestHarness.ts`
 * convention of the shell's `state/` directory: a plain module, not matched by the
 * test-file glob, imported only by tests.
 *
 * Requirements: 15.6, 15.9, squads 18.10
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

// --- The squads feature's own seam -------------------------------------------

/**
 * The identities and copy the squads-aware Api_Client below answers with.
 *
 * Everything a routing test identifies a squads screen by is **data it supplied**
 * rather than fixed copy read out of the feature: the Squad_Screen heads itself
 * with the parsed {@link squadName}, each Squad_Card names it, each Player_Row
 * names {@link playerName}, and the Invite_Landing_Route renders the preview's own
 * {@link invitePreviewMessage}. That is what lets `src/app` assert *which* screen
 * resolved without importing a message module from inside the feature — and it is
 * a stronger claim than matching fixed copy would be, because a value only
 * reaches the surface if the screen actually issued its call and parsed the answer.
 *
 * {@link invitePreviewMessage} is deliberately unlike the screen's own fixed
 * instruction, so "the preview settled" cannot be confused with "the preview was
 * never issued".
 *
 * The squad and membership identities are well-formed GUIDs because the
 * Squad_Screen short-circuits a malformed one to its Not_Found_Treatment without
 * issuing a call.
 */
export const SQUADS_FIXTURE = {
  squadId: '4b1c3e6a-9d2f-4a55-8b7e-1f2c3d4e5f60',
  squadName: 'Thursday Ballers',
  membershipId: '11111111-2222-4333-8444-555555555555',
  playerName: 'Ada Lovelace',
  inviteSecret: 'pitchmate-invite-secret',
  invitePreviewMessage: 'This invite needs an account before it can be used.',
} as const;

/**
 * The squads endpoint paths, as the generated contract keys them — the same
 * strings `features/squads/api/squadsApi.ts` hands the client, which is why a
 * request can be recognised by one.
 */
const SQUADS_LIST_PATH = '/squads';
const SQUAD_DETAIL_PATH = '/squads/{squadId}';
const SQUAD_LEADERBOARD_PATH = '/squads/{squadId}/leaderboard';
const SQUAD_INVITES_PATH = '/squads/{squadId}/invites';
const SQUAD_FEATURES_PATH = '/squads/{squadId}/features';
const INVITE_PREVIEW_PATH = '/squads/invites/preview';
const REDEEM_INVITE_PATH = '/squads/invites/redeem';

/**
 * The entries {@link SquadsApiClientStub.requests} records for the calls a
 * routing test counts, so the count is written against the same strings the stub
 * records rather than against a second copy of each path.
 */
export const SQUADS_REQUESTS = {
  listMySquads: `GET ${SQUADS_LIST_PATH}`,
  getSquad: `GET ${SQUAD_DETAIL_PATH}`,
  leaderboard: `GET ${SQUAD_LEADERBOARD_PATH}`,
  previewInvite: `GET ${INVITE_PREVIEW_PATH}`,
  redeemInvite: `POST ${REDEEM_INVITE_PATH}`,
} as const;

/**
 * The `ListMySquads` body: one summary for the fixture squad.
 *
 * The enum fields are **numeric codes**, as the backend serialises them today —
 * `3` is the member role and `1` the active membership state in the feature's own
 * `lib/enumCodes.ts`, which is the single place that mapping is declared. A member
 * rather than an owner keeps the Squad_Screen's Admin_Section out of these
 * routing tests: the administration surface has its own tests, and a caller
 * without Admin_Authority issues no admin call.
 */
const SQUAD_SUMMARIES_BODY: unknown = [
  {
    squadId: SQUADS_FIXTURE.squadId,
    name: SQUADS_FIXTURE.squadName,
    role: 3,
    state: 1,
  },
];

/** The `GetSquad` body: the fixture squad with one active, non-guest member. */
const SQUAD_DETAIL_BODY: unknown = {
  squadId: SQUADS_FIXTURE.squadId,
  name: SQUADS_FIXTURE.squadName,
  members: [
    {
      membershipId: SQUADS_FIXTURE.membershipId,
      displayName: SQUADS_FIXTURE.playerName,
      role: 3,
      state: 1,
      isGuest: false,
    },
  ],
  features: [],
};

/** The `GetSquadLeaderboard` body for the Display_Rating statistic. */
const LEADERBOARD_BODY: unknown = {
  entries: [
    {
      membershipId: SQUADS_FIXTURE.membershipId,
      displayName: SQUADS_FIXTURE.playerName,
      value: 1204,
    },
  ],
};

/** The anonymous `PreviewInvite` body, which names no squad. */
const INVITE_PREVIEW_BODY: unknown = {
  requiresAuthentication: true,
  message: SQUADS_FIXTURE.invitePreviewMessage,
};

/** An Authenticated_Api_Client stand-in together with the requests it received. */
export interface SquadsApiClientStub {
  /** The client to hand to {@link assembleRoutes}. */
  readonly client: PitchMateApiClient;
  /**
   * Every request issued, as `METHOD path` with the contract's own path template,
   * in the order they were issued.
   *
   * Which calls a rendered address produced is the sharpest discriminator a
   * routing test has: the Squad_Screen cannot resolve without a `GetSquad`, so an
   * address that issues none rendered something else — which is exactly what
   * Requirement 9.6 claims about the Player_Stats_Route.
   */
  readonly requests: string[];
}

/**
 * An Authenticated_Api_Client stand-in answering the squads endpoints as well as
 * the notification ones.
 *
 * {@link stubApiClient} is enough for a router assembled with its own
 * Destination_Content, where no squads screen mounts. Once the Home Destination
 * falls back to the real Squads_Home, the squads calls have to be answered with
 * bodies the feature's parsers accept — an unparseable body renders the generic
 * failure, which would make every "this screen resolved here" assertion fail for
 * a reason that has nothing to do with routing.
 *
 * Bodies are handed over as text on `data` with a plain `{ status }` response, the
 * shape {@link stubApiClient} already uses: the transport seam reads a string body
 * itself and decodes it in a guard, and an **empty** body is what the
 * `RedeemInvite` no-op answers with.
 */
export function squadsApiClient(): SquadsApiClientStub {
  const requests: string[] = [];

  const json = (body: unknown) =>
    Promise.resolve({ data: JSON.stringify(body), response: { status: 200 } });

  /** An accepted call carrying no body — the shape a no-op redemption answers with. */
  const accepted = () =>
    Promise.resolve({ data: '', response: { status: 204 } });

  const answerGet = (path: string) => {
    switch (path) {
      case SQUADS_LIST_PATH:
        return json(SQUAD_SUMMARIES_BODY);
      case SQUAD_DETAIL_PATH:
        return json(SQUAD_DETAIL_BODY);
      case SQUAD_LEADERBOARD_PATH:
        return json(LEADERBOARD_BODY);
      case INVITE_PREVIEW_PATH:
        return json(INVITE_PREVIEW_BODY);
      case SQUAD_INVITES_PATH:
        return json([]);
      case SQUAD_FEATURES_PATH:
        return json([]);
      default:
        // The notification endpoints, exactly as `stubApiClient` answers them.
        return json(path.includes('unread-count') ? 0 : []);
    }
  };

  const record = (method: string, path: string): void => {
    requests.push(`${method} ${path}`);
  };

  const client = {
    GET: (path: string) => {
      record('GET', path);
      return answerGet(path);
    },
    POST: (path: string) => {
      record('POST', path);
      return accepted();
    },
    PATCH: (path: string) => {
      record('PATCH', path);
      return accepted();
    },
    PUT: (path: string) => {
      record('PUT', path);
      return accepted();
    },
  } as unknown as PitchMateApiClient;

  return { client, requests };
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

/** Join a parent's resolved path with a relative child path segment. */
function joinPath(parentPath: string, childPath: string): string {
  return `${parentPath.replace(/\/$/, '')}/${childPath}`;
}

/**
 * Every path a route table registers, one entry per matchable route.
 *
 * A route contributes a path only where a screen sits: a layout route with
 * children contributes through its children, an index child contributes the path
 * of the route it indexes, and a pathless layout route contributes its parent's
 * path — which is how `react-router` matches each of them. So `/app`, registered
 * as the shell's layout route plus its index child, counts as **one**
 * registration rather than two, which is what makes "registered exactly once" a
 * claim about matchable paths rather than about route objects.
 *
 * A child path starting with `/` is already absolute (the auth screens and the
 * shell Destinations are registered that way); anything else is joined onto its
 * parent — which is how the squads feature's relative `squads/:squadId` child
 * resolves to `/app/squads/:squadId` — or taken as it stands at the top level,
 * where the application catch-all `*` sits.
 *
 * Over the assembled table it yields exactly: `/`, the five auth paths, `/app`
 * and its three sibling Destination paths, `/app/*`, `/app/squads/:squadId`,
 * `/join/:code`, and `*`.
 */
export function registeredPaths(
  routes: readonly RouteObject[],
  parentPath = '',
): string[] {
  const paths: string[] = [];

  for (const route of routes) {
    const ownPath =
      route.path === undefined
        ? parentPath
        : route.path.startsWith('/') || parentPath === ''
          ? route.path
          : joinPath(parentPath, route.path);

    if (route.children === undefined || route.children.length === 0) {
      paths.push(ownPath);
    } else {
      paths.push(...registeredPaths(route.children, ownPath));
    }
  }

  return paths;
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
