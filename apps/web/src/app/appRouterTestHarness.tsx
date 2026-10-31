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
 * The notifications facade takes the client's decoded `data`, so this stand-in
 * supplies decoded bodies as the generated client would: the unread-count
 * endpoint answers the named `{ count: 0 }` envelope and the list endpoint an
 * empty array — enough for the frame to render with no call failing and nothing
 * reaching the network. A `204` carries no body, so `data` is absent.
 */
export function stubApiClient(): PitchMateApiClient {
  const ok = (body: unknown) => Promise.resolve({ data: body, response: { status: 200 } });

  return {
    GET: (path: string) => ok(path.includes('unread-count') ? { count: 0 } : []),
    POST: () => Promise.resolve({ data: undefined, response: { status: 204 } }),
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
 * The `GetPlayerProfile` path, as the generated contract keys it — the same
 * string `features/player-stats/api/playerStatsApi.ts` hands the client.
 *
 * It lives beside the squads paths because the same Api_Client stand-in answers
 * it: the Player_Stats_Route is nested into the shell's `/app` layout route
 * alongside the Squad_Route, so a routing test that follows a Player_Row from
 * one screen to the other needs both features answered by one client.
 */
const PLAYER_PROFILE_PATH = '/squads/{squadId}/members/{membershipId}/profile';

/**
 * The match the squads-aware client lists in the fixture squad, and the paths
 * the Matches_Feature reads it through. The squad screen's matches section is
 * the Matches_Feature's injected content, so one client answers both features.
 */
export const MATCHES_FIXTURE = {
  matchId: '7c0d2e1f-3a4b-4c5d-8e6f-708192a3b4c5',
  location: 'Riverside Astro, pitch 3',
  candidateDay: '2030-03-02T19:00:00.000Z',
} as const;

const SQUAD_MATCHES_PATH = '/squads/{squadId}/matches';
const MATCH_DETAIL_PATH = '/matches/{matchId}';
const MATCH_TALLY_PATH = '/squads/{squadId}/matches/{matchId}/availability/tally';

const MATCH_LIST_BODY: unknown = {
  matches: [
    {
      matchId: MATCHES_FIXTURE.matchId,
      state: 'GatheringAvailability',
      location: MATCHES_FIXTURE.location,
      confirmedDay: null,
      candidateDays: [MATCHES_FIXTURE.candidateDay],
      participantCount: 0,
      lockedTeams: [],
      recordedResult: null,
      completedAt: null,
    },
  ],
  truncated: false,
};

const MATCH_DETAIL_BODY: unknown = {
  matchId: MATCHES_FIXTURE.matchId,
  squadId: SQUADS_FIXTURE.squadId,
  state: 'GatheringAvailability',
  location: MATCHES_FIXTURE.location,
  candidateDays: [MATCHES_FIXTURE.candidateDay],
  confirmedDay: null,
  participantCount: 0,
  participants: [],
  callerIsParticipant: false,
  callerAvailability: { hasStoredResponse: false, markedDays: [] },
  recordedResult: null,
  completedAt: null,
  guestAvailability: [],
};

const MATCH_TALLY_BODY: unknown = {
  days: [{ day: MATCHES_FIXTURE.candidateDay, availableMemberIds: [], count: 3 }],
};

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
 * The entry {@link SquadsApiClientStub.requests} records for the one call the
 * Player_Stats_Feature makes.
 *
 * Which call a rendered address produced is the sharpest discriminator a routing
 * test has, and it is sharper still here: the Player_Stats_Screen cannot resolve
 * without a `GetPlayerProfile`, and the App_Shell's `/app/*` not-found — the
 * surface that answered this address before the route existed — issues none. So
 * counting this entry tells "the screen registered here resolved" from "the
 * shell's not-found resolved" without either surface's copy being read.
 */
export const PLAYER_STATS_REQUESTS = {
  getPlayerProfile: `GET ${PLAYER_PROFILE_PATH}`,
} as const;

/**
 * The `ListMySquads` body: one summary for the fixture squad.
 *
 * The enum fields are **member names**, as the backend serialises them: `Member`
 * is the role and `Active` the membership state, the C# member name verbatim. A
 * member rather than an owner keeps the Squad_Screen's Admin_Section out of these
 * routing tests: the administration surface has its own tests, and a caller
 * without Admin_Authority issues no admin call.
 */
const SQUAD_SUMMARIES_BODY: unknown = [
  {
    squadId: SQUADS_FIXTURE.squadId,
    name: SQUADS_FIXTURE.squadName,
    role: 'Member',
    state: 'Active',
    playerCount: 1,
    nextMatch: null,
    recentForm: [],
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
      role: 'Member',
      state: 'Active',
      isGuest: false,
      appearances: 12,
      ratingState: 'Established',
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

// --- The player-stats feature's own seam ------------------------------------

/**
 * What the answered Player_Profile is built from.
 *
 * {@link SQUADS_FIXTURE} already carries the squad and the membership a
 * Player_Row links to; what this adds is a **second** membership of the same
 * squad, so a routing test can tell "the screen resolved for the row's
 * membership" from "the screen resolved for some membership".
 */
export const PLAYER_STATS_FIXTURE = {
  /**
   * A second membership of the fixture squad, named by no Squad_Member — so an
   * address carrying it reaches a profile the Squad_Screen never linked to.
   */
  otherMembershipId: '99999999-8888-4777-8666-555544443333',
  /** What {@link playerProfileName} prefixes a membership identity with. */
  namePrefix: 'Profile of ',
} as const;

/**
 * The Player_Display_Name the stand-in answers for one membership.
 *
 * Keyed on the identity rather than fixed, which is what makes the rendered
 * surface say *which subject* resolved: the screen heads itself with the parsed
 * display name (player-stats Requirement 5.1), so a heading built from the
 * membership in the address is direct evidence that the call was issued for that
 * membership and its answer parsed — a stronger claim than a fixed name, which
 * would read the same for every subject.
 *
 * It is deliberately unlike {@link SQUADS_FIXTURE.playerName}: the squads
 * routing tests assert that no squads screen resolved at this address by
 * checking that name is absent, and a profile that echoed it would make that
 * check pass for the wrong reason.
 */
export function playerProfileName(membershipId: string): string {
  return `${PLAYER_STATS_FIXTURE.namePrefix}${membershipId}`;
}

/**
 * The `GetPlayerProfile` body for one membership, in the shape the feature's
 * Response_Parser accepts.
 *
 * The enum fields are **member names**, as the backend serialises them, exactly
 * as the squads bodies above spell theirs. The five collections are empty and
 * `rich` is absent, which keeps the resolved screen to one link (the control
 * back to the squad) and one level-one heading — the two discriminators the
 * routing tests read — without any section being missing: an empty
 * Pairwise_Section and an absent rich block are states the screen states in
 * words. The wire's rating-model members are omitted because the parser never
 * names them, so sending them would demonstrate nothing here.
 */
function playerProfileBody(membershipId: string): unknown {
  return {
    membershipId,
    displayName: playerProfileName(membershipId),
    state: 'Active',
    isGuest: false,
    record: { appearances: 12, wins: 7, draws: 2, losses: 3 },
    winPercentage: 58.3,
    rating: { state: 'Established', displayRating: 1204 },
    progression: [
      { completedAt: '2026-01-08T19:30:00.000Z', displayRating: 1180 },
      { completedAt: '2026-01-15T19:30:00.000Z', displayRating: 1204 },
    ],
    winStreak: 3,
    unbeatenStreak: 5,
    mostPlayedWith: [],
    mostPlayedAgainst: [],
    bestPartnerships: [],
    bogeyOpponents: [],
    bibAppearances: 4,
    rich: null,
  };
}

/**
 * The membership identity a `GetPlayerProfile` request carries.
 *
 * `openapi-fetch` takes path parameters under `params.path`, which is how the
 * transport seam hands over the two identities — the recorded request itself
 * carries only the contract's path *template*, so this is the one place the
 * resolved subject is visible. Read defensively: a request shaped otherwise
 * yields the empty string, which answers a profile named for no membership
 * rather than throwing inside the client stand-in.
 */
function requestedMembershipId(init: unknown): string {
  const params = (
    init as { params?: { path?: Record<string, unknown> } } | undefined
  )?.params?.path;
  const membershipId = params?.['membershipId'];

  return typeof membershipId === 'string' ? membershipId : '';
}

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
 * Bodies are handed over **already decoded** on `data`, with a plain
 * `{ status }` response. That is what the real generated client now does: the
 * squads responses carry a declared content schema, so `openapi-fetch` decodes
 * the JSON itself and the transport seam takes the typed `data` value rather
 * than reading and decoding response text. An absent `data` is what a `204` —
 * and a `200` carrying nothing, the shape a no-op redemption answers with —
 * looks like from the client.
 *
 * The notification endpoints are answered by the same stub and read by the
 * App_Shell's own seam, which accepts an already-decoded `data` as well as text.
 *
 * `GetPlayerProfile` is answered here too, for the same reason: the
 * Player_Stats_Route is nested into the shell's `/app` layout route beside the
 * Squad_Route, so following a Player_Row from one screen to the other crosses
 * both features and one client has to answer both. An unanswered profile call
 * would leave that address rendering the feature's generic failure, which would
 * make every "this screen resolved here" assertion fail for a reason that has
 * nothing to do with routing.
 */
export function squadsApiClient(): SquadsApiClientStub {
  const requests: string[] = [];

  const json = (body: unknown) =>
    Promise.resolve({ data: body, response: { status: 200 } });

  /** An accepted call carrying no body — the shape a no-op redemption answers with. */
  const accepted = () =>
    Promise.resolve({ data: undefined, response: { status: 204 } });

  const answerGet = (path: string, init: unknown) => {
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
      case SQUAD_MATCHES_PATH:
        return json(MATCH_LIST_BODY);
      case MATCH_DETAIL_PATH:
        return json(MATCH_DETAIL_BODY);
      case MATCH_TALLY_PATH:
        return json(MATCH_TALLY_BODY);
      case PLAYER_PROFILE_PATH:
        // Answered for whichever membership the request names, so the resolved
        // screen's own heading says which subject it loaded.
        return json(playerProfileBody(requestedMembershipId(init)));
      default:
        // The notification endpoints, exactly as `stubApiClient` answers them.
        return json(path.includes('unread-count') ? { count: 0 } : []);
    }
  };

  const record = (method: string, path: string): void => {
    requests.push(`${method} ${path}`);
  };

  const client = {
    GET: (path: string, init?: unknown) => {
      record('GET', path);
      return answerGet(path, init);
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
