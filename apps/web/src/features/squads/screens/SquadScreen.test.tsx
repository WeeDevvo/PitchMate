/**
 * Worked examples for the Squad_Screen (task 13.1).
 *
 * The quantified claims about this screen live in their own files: the
 * Not_Found_Treatment's identity across causes (Property 13), the ambiguous
 * leaderboard (Property 23), admin affordance visibility (Property 26), the issued
 * call multiset (Property 34), and the heading outlines (Property 43). What is
 * pinned here is what a property would only obscure — the four states of the
 * `detail` slot as rendered surfaces, the fixed section order, the caller's role
 * label, the degraded rating column, and the single Squad_Scope publication.
 *
 * Two seams are supplied and one is replaced:
 *
 *  - a `SquadsApi` answering with settled `CallResult` values, and a
 *    `SessionManager` reporting `authenticated`;
 *  - the App_Shell's `usePublishSquadScopeFromRoute`, which throws outside the
 *    shell's own provider. It is replaced by a counting stand-in so the screen can
 *    be rendered on its own *and* so "called exactly once" is observable at all.
 *    The real publication is exercised where the real router is assembled.
 *
 * The screen runs inside a real `MemoryRouter` at the real `SQUAD_ROUTE`, so the
 * `squadId` parameter arrives the way the router delivers it and a navigation is
 * observed as a location change rather than as a spy call.
 *
 * Requirements: 6.3, 6.4, 6.7, 6.8, 6.9, 6.10, 7.10, 7.13, 10.3, 15.1
 */
import { type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { AuthProvider, type AuthState, type SessionManager } from '../../auth';
import type { CallResult, SquadsApi } from '../api/squadsApi';
import { ADMIN_SECTION_SELECTOR } from '../components/AdminSection';
import { FAILURE_NOTICE_SELECTOR } from '../components/FailureNotice';
import { LOADING_INDICATION_SELECTOR } from '../components/LoadingIndication';
import { NOT_FOUND_TREATMENT_SELECTOR } from '../components/NotFoundTreatment';
import { PLAYER_LIST_SELECTOR } from '../components/PlayerList';
import {
  PLAYER_ROW_MEMBERSHIP_ID_ATTRIBUTE,
  PLAYER_ROW_SELECTOR,
} from '../components/PlayerRow';
import {
  ADMIN_SECTION_HEADING,
  MATCHES_SECTION_HEADING,
  MEMBER_ROLE_LABEL,
  NO_ROLE_RECORDED_LABEL,
  OWNER_ROLE_LABEL,
  PLAYERS_SECTION_HEADING,
  RATING_UNAVAILABLE_LABEL,
  SQUAD_DETAIL_SECTION_HEADING,
  SQUAD_SCREEN_HEADING,
  SQUADS_RETRY_LABEL,
  STATS_SECTION_HEADING,
} from '../lib/messages';
import type { DisplayRatingLeaderboard } from '../lib/parse/leaderboard';
import type { SquadDetail, SquadMember } from '../lib/parse/squadDetail';
import type { SquadSummary } from '../lib/parse/squadSummary';
import { PLAYER_STATS_ROUTE, SQUAD_ROUTE, playerStatsPath, squadPath } from '../lib/routePaths';
import {
  CALLER_ROLE_SELECTOR,
  PLAYERS_SECTION_SELECTOR,
  SQUAD_DETAIL_SECTION_SELECTOR,
  SquadScreen,
} from './SquadScreen';

// --- the App_Shell seam -------------------------------------------------------

/**
 * How many times the screen published the Squad_Scope.
 *
 * `usePublishSquadScopeFromRoute` reads the shell's publish context and throws
 * where none is above it, which is correct for the application — the Squad_Route
 * is a child of the shell's `/app` layout route — and unusable for a screen
 * rendered on its own. Only that one export is replaced; `HOME_ROUTE` and the
 * parameter name stay the shell's own.
 */
const { publishSpy } = vi.hoisted(() => ({ publishSpy: vi.fn<() => string | null>() }));

vi.mock('../../app-shell', async () => {
  const actual =
    await vi.importActual<typeof import('../../app-shell')>('../../app-shell');

  return {
    ...actual,
    usePublishSquadScopeFromRoute: () => {
      publishSpy();
      return null;
    },
  };
});

// --- fixtures -----------------------------------------------------------------

const SQUAD_ID = '4b1c3e6a-9d2f-4a55-8b7e-1f2c3d4e5f60';
const OTHER_SQUAD_ID = '7c2d4f8b-1e3a-4b66-9c8f-2a3b4c5d6e71';
const MEMBERSHIP_ID = '11111111-2222-4333-8444-555555555555';
const SECOND_MEMBERSHIP_ID = '99999999-8888-4777-8666-555555555554';

function member(overrides: Partial<SquadMember> = {}): SquadMember {
  return {
    membershipId: MEMBERSHIP_ID,
    displayName: 'Ada',
    role: 'Member',
    state: 'Active',
    isGuest: false,
    appearances: 12,
    ratingState: 'Established',
    ...overrides,
  };
}

function detail(overrides: Partial<SquadDetail> = {}): SquadDetail {
  return {
    squadId: SQUAD_ID,
    name: 'Thursday Ballers',
    members: [member()],
    features: [],
    ...overrides,
  };
}

function summary(overrides: Partial<SquadSummary> = {}): SquadSummary {
  return {
    squadId: SQUAD_ID,
    name: 'Thursday Ballers',
    role: 'Member',
    state: 'Active',
    ...overrides,
  };
}

function leaderboard(value = 1200): DisplayRatingLeaderboard {
  return {
    entries: [{ membershipId: MEMBERSHIP_ID, displayName: 'Ada', value }],
  };
}

/** A promise that never settles — the awaiting-first-response state. */
function pending<T>(): Promise<CallResult<T>> {
  return new Promise<CallResult<T>>(() => undefined);
}

// --- the seams ----------------------------------------------------------------

/** A method the screen must not call in a given example. */
function unavailable(name: string): () => never {
  return () => {
    throw new Error(`${name} must not be called`);
  };
}

interface ApiCallLog {
  listMySquadsCalls: number;
  getSquadCalls: number;
  leaderboardCalls: number;
  listInvitesCalls: number;
}

interface FakeApiOptions {
  /** One outcome per `getSquad` call; the last is reused once exhausted. */
  readonly detailOutcomes: readonly (
    | CallResult<SquadDetail>
    | Promise<CallResult<SquadDetail>>
  )[];
  readonly leaderboardOutcome?:
    | CallResult<DisplayRatingLeaderboard>
    | Promise<CallResult<DisplayRatingLeaderboard>>;
  readonly summaries?: readonly SquadSummary[];
  /** Supplied only where the caller holds Admin_Authority. */
  readonly invitesAvailable?: boolean;
}

/**
 * A Squads_Api answering the calls this screen's subtree can issue and refusing
 * the rest, so a call the screen has no business making fails loudly.
 */
function createFakeApi(options: FakeApiOptions): {
  readonly api: SquadsApi;
  readonly log: ApiCallLog;
} {
  const log: ApiCallLog = {
    listMySquadsCalls: 0,
    getSquadCalls: 0,
    leaderboardCalls: 0,
    listInvitesCalls: 0,
  };

  const {
    detailOutcomes,
    leaderboardOutcome = { kind: 'transport-failure' } as CallResult<DisplayRatingLeaderboard>,
    summaries = [],
    invitesAvailable = false,
  } = options;

  const api: SquadsApi = {
    listMySquads: () => {
      log.listMySquadsCalls += 1;
      return Promise.resolve({ kind: 'success', value: summaries });
    },
    getSquad: () => {
      const index = Math.min(log.getSquadCalls, detailOutcomes.length - 1);
      log.getSquadCalls += 1;
      return Promise.resolve(detailOutcomes[index]);
    },
    getDisplayRatingLeaderboard: () => {
      log.leaderboardCalls += 1;
      return Promise.resolve(leaderboardOutcome);
    },
    listInvites: () => {
      log.listInvitesCalls += 1;
      if (!invitesAvailable) {
        throw new Error('listInvites must not be called');
      }
      return Promise.resolve({ kind: 'success', value: [] });
    },
    createSquad: unavailable('createSquad'),
    redeemInvite: unavailable('redeemInvite'),
    previewInvite: unavailable('previewInvite'),
    generateInvite: unavailable('generateInvite'),
    revokeInvite: unavailable('revokeInvite'),
    createGuest: unavailable('createGuest'),
    editGuest: unavailable('editGuest'),
    promoteToAdmin: unavailable('promoteToAdmin'),
    getFeatureFlags: unavailable('getFeatureFlags'),
    setFeatureFlag: unavailable('setFeatureFlag'),
  };

  return { api, log };
}

/** A `SessionManager` reporting one fixed Auth_State. */
function sessionManager(state: AuthState = 'authenticated'): SessionManager {
  return {
    bootstrap: () => state,
    establish: () => undefined,
    getState: () => state,
    getAccessTokenForRequest: () => Promise.resolve({ token: 'test-token' }),
    signOut: () => Promise.resolve(),
    subscribe: () => () => undefined,
  };
}

/** Reports the rendered path, so a navigation is observable as a change. */
function LocationProbe(): ReactElement {
  const location = useLocation();

  return <output data-testid="location">{location.pathname}</output>;
}

/** The screen at its real route, inside a real router and a real AuthProvider. */
function screenTree(api: SquadsApi, requestedSquadId: string): ReactElement {
  return (
    <AuthProvider manager={sessionManager()}>
      <MemoryRouter initialEntries={[squadPath(requestedSquadId)]}>
        <Routes>
          <Route path={SQUAD_ROUTE} element={<SquadScreen api={api} />} />
          <Route path={PLAYER_STATS_ROUTE} element={<p>player stats</p>} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </AuthProvider>
  );
}

function renderScreen(
  api: SquadsApi,
  requestedSquadId: string = SQUAD_ID,
): { readonly rerender: () => void } {
  const { rerender } = render(screenTree(api, requestedSquadId));

  // A *fresh* element each time, so React re-renders rather than bailing out on
  // an unchanged element identity — which is what makes the publication count
  // below observable.
  return { rerender: () => rerender(screenTree(api, requestedSquadId)) };
}

function headingTexts(level: number): readonly string[] {
  return screen
    .getAllByRole('heading', { level })
    .map((heading) => heading.textContent ?? '');
}

function renderedPath(): string {
  return screen.getByTestId('location').textContent ?? '';
}

// --- the examples -------------------------------------------------------------

describe('SquadScreen — the states of the detail slot', () => {
  // Requirements: 6.9
  it('renders a busy state and neither the Player_List nor the Admin_Section while awaiting the first response', async () => {
    const { api } = createFakeApi({ detailOutcomes: [pending<SquadDetail>()] });

    renderScreen(api);

    await waitFor(() => {
      expect(document.querySelector(LOADING_INDICATION_SELECTOR)).not.toBeNull();
    });

    const busy = document.querySelector(LOADING_INDICATION_SELECTOR);
    expect(busy?.getAttribute('aria-busy')).toBe('true');

    // A fixed noun stands in for the name that has not arrived, so the screen
    // still holds exactly one level-one heading (Requirement 19.1).
    expect(headingTexts(1)).toEqual([SQUAD_SCREEN_HEADING]);
    expect(document.querySelector(PLAYER_LIST_SELECTOR)).toBeNull();
    expect(document.querySelector(PLAYERS_SECTION_SELECTOR)).toBeNull();
    expect(document.querySelector(ADMIN_SECTION_SELECTOR)).toBeNull();
    expect(document.querySelector(FAILURE_NOTICE_SELECTOR)).toBeNull();
  });

  // Requirements: 6.3, 6.8, 15.1
  it('renders the parsed Squad_Name as its one level-one heading and the five sections in order', async () => {
    const { api } = createFakeApi({
      detailOutcomes: [{ kind: 'success', value: detail() }],
      leaderboardOutcome: { kind: 'success', value: leaderboard() },
      summaries: [summary({ role: 'Owner' })],
      invitesAvailable: true,
    });

    renderScreen(api);

    await screen.findByRole('heading', { level: 1, name: 'Thursday Ballers' });

    expect(headingTexts(1)).toEqual(['Thursday Ballers']);

    // 6.8: the document order, each section introduced by exactly one `h2`.
    expect(headingTexts(2)).toEqual([
      SQUAD_DETAIL_SECTION_HEADING,
      PLAYERS_SECTION_HEADING,
      MATCHES_SECTION_HEADING,
      STATS_SECTION_HEADING,
      ADMIN_SECTION_HEADING,
    ]);
  });

  // Requirements: 6.4
  it('renders the Not_Found_Treatment alone for a not-found result', async () => {
    const { api } = createFakeApi({
      detailOutcomes: [{ kind: 'not-found' }],
      summaries: [summary({ role: 'Owner' })],
    });

    renderScreen(api);

    await waitFor(() => {
      expect(document.querySelector(NOT_FOUND_TREATMENT_SELECTOR)).not.toBeNull();
    });

    expect(screen.queryByText('Thursday Ballers')).toBeNull();
    expect(document.querySelector(PLAYER_LIST_SELECTOR)).toBeNull();
    expect(document.querySelector(ADMIN_SECTION_SELECTOR)).toBeNull();
    expect(document.querySelector(SQUAD_DETAIL_SECTION_SELECTOR)).toBeNull();
    expect(document.querySelector(FAILURE_NOTICE_SELECTOR)).toBeNull();
    // No section heading at all: the treatment is the whole screen.
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);
  });

  // Requirements: 6.6
  it('renders the Not_Found_Treatment and issues no call for a malformed squad identity', async () => {
    const { api, log } = createFakeApi({
      detailOutcomes: [{ kind: 'success', value: detail() }],
    });

    renderScreen(api, 'not-an-identifier');

    await waitFor(() => {
      expect(document.querySelector(NOT_FOUND_TREATMENT_SELECTOR)).not.toBeNull();
    });

    expect(log.getSquadCalls).toBe(0);
    expect(log.leaderboardCalls).toBe(0);
  });

  // Requirements: 6.7
  it('renders the generic failure with a retry that issues exactly one further GetSquad, and never the not-found treatment', async () => {
    const user = userEvent.setup();
    const { api, log } = createFakeApi({
      detailOutcomes: [
        { kind: 'transport-failure' },
        { kind: 'success', value: detail() },
      ],
    });

    renderScreen(api);

    await waitFor(() => {
      expect(document.querySelector(FAILURE_NOTICE_SELECTOR)).not.toBeNull();
    });

    expect(document.querySelector(NOT_FOUND_TREATMENT_SELECTOR)).toBeNull();
    expect(document.querySelector(PLAYER_LIST_SELECTOR)).toBeNull();
    expect(log.getSquadCalls).toBe(1);

    await user.click(screen.getByRole('button', { name: SQUADS_RETRY_LABEL }));

    await screen.findByRole('heading', { level: 1, name: 'Thursday Ballers' });
    expect(log.getSquadCalls).toBe(2);
    expect(document.querySelector(FAILURE_NOTICE_SELECTOR)).toBeNull();
  });
});

describe('SquadScreen — the caller’s own standing', () => {
  // Requirements: 6.3, 6.10
  it('names the caller’s Member_Role from the ListMySquads summary for this squad', async () => {
    const { api } = createFakeApi({
      detailOutcomes: [{ kind: 'success', value: detail() }],
      summaries: [summary({ role: 'Owner' })],
      invitesAvailable: true,
    });

    renderScreen(api);

    await waitFor(() => {
      expect(
        document.querySelector(CALLER_ROLE_SELECTOR)?.textContent,
      ).toBe(OWNER_ROLE_LABEL);
    });
  });

  // Requirements: 6.10, 10.3
  it('states no role and renders no Admin_Section where no summary identifies the caller', async () => {
    const { api } = createFakeApi({
      detailOutcomes: [{ kind: 'success', value: detail() }],
      summaries: [summary({ squadId: OTHER_SQUAD_ID })],
    });

    renderScreen(api);

    await screen.findByRole('heading', { level: 1, name: 'Thursday Ballers' });

    expect(document.querySelector(CALLER_ROLE_SELECTOR)?.textContent).toBe(
      NO_ROLE_RECORDED_LABEL,
    );
    expect(document.querySelector(ADMIN_SECTION_SELECTOR)).toBeNull();
  });

  // Requirements: 10.3
  it('renders no Admin_Section for a member, and the Player_List unchanged', async () => {
    const { api } = createFakeApi({
      detailOutcomes: [{ kind: 'success', value: detail() }],
      summaries: [summary({ role: 'Member' })],
    });

    renderScreen(api);

    await screen.findByRole('heading', { level: 1, name: 'Thursday Ballers' });

    expect(document.querySelector(CALLER_ROLE_SELECTOR)?.textContent).toBe(
      MEMBER_ROLE_LABEL,
    );
    expect(document.querySelector(ADMIN_SECTION_SELECTOR)).toBeNull();
    expect(document.querySelectorAll(PLAYER_ROW_SELECTOR)).toHaveLength(1);
    expect(headingTexts(2)).toEqual([
      SQUAD_DETAIL_SECTION_HEADING,
      PLAYERS_SECTION_HEADING,
      MATCHES_SECTION_HEADING,
      STATS_SECTION_HEADING,
    ]);
  });
});

describe('SquadScreen — the Player_List and the leaderboard', () => {
  // Requirements: 7.2, 7.13
  it('renders one Player_Row per parsed Squad_Member and opens that player’s stats', async () => {
    const user = userEvent.setup();
    const { api } = createFakeApi({
      detailOutcomes: [
        {
          kind: 'success',
          value: detail({
            members: [
              member(),
              member({
                membershipId: SECOND_MEMBERSHIP_ID,
                displayName: 'Grace',
              }),
            ],
          }),
        },
      ],
      leaderboardOutcome: { kind: 'success', value: leaderboard() },
      summaries: [summary()],
    });

    renderScreen(api);

    await waitFor(() => {
      expect(document.querySelectorAll(PLAYER_ROW_SELECTOR)).toHaveLength(2);
    });

    expect(
      Array.from(document.querySelectorAll(PLAYER_ROW_SELECTOR)).map((row) =>
        row.getAttribute(PLAYER_ROW_MEMBERSHIP_ID_ATTRIBUTE),
      ),
    ).toEqual([MEMBERSHIP_ID, SECOND_MEMBERSHIP_ID]);

    await user.click(screen.getByRole('button', { name: 'Grace' }));

    expect(renderedPath()).toBe(playerStatsPath(SQUAD_ID, SECOND_MEMBERSHIP_ID));
  });

  // Requirements: 7.10, 7.13
  it('renders every row with Rating_Unavailable while the leaderboard is unavailable, and no failure in place of the list', async () => {
    const { api } = createFakeApi({
      detailOutcomes: [{ kind: 'success', value: detail() }],
      leaderboardOutcome: { kind: 'timeout' },
      summaries: [summary()],
    });

    renderScreen(api);

    await waitFor(() => {
      expect(document.querySelectorAll(PLAYER_ROW_SELECTOR)).toHaveLength(1);
    });

    const row = document.querySelector(PLAYER_ROW_SELECTOR) as HTMLElement;

    await waitFor(() => {
      expect(within(row).getByText(RATING_UNAVAILABLE_LABEL)).not.toBeNull();
    });

    // 7.10: the degraded rating column is not a failed screen.
    expect(document.querySelector(FAILURE_NOTICE_SELECTOR)).toBeNull();
    expect(document.querySelector(PLAYER_LIST_SELECTOR)).not.toBeNull();
  });

  // Requirements: 7.13
  it('renders Rating_Unavailable while the leaderboard call is still awaiting a response', async () => {
    const { api } = createFakeApi({
      detailOutcomes: [{ kind: 'success', value: detail() }],
      leaderboardOutcome: pending<DisplayRatingLeaderboard>(),
      summaries: [summary()],
    });

    renderScreen(api);

    const row = (await waitFor(() => {
      const found = document.querySelector(PLAYER_ROW_SELECTOR);
      expect(found).not.toBeNull();
      return found;
    })) as HTMLElement;

    expect(within(row).getByText(RATING_UNAVAILABLE_LABEL)).not.toBeNull();
  });
});

describe('SquadScreen — the Squad_Scope', () => {
  // Requirements: 6.1
  it('publishes the Squad_Scope from the route, from exactly one call site', async () => {
    publishSpy.mockClear();

    const { api } = createFakeApi({
      detailOutcomes: [{ kind: 'success', value: detail() }],
      leaderboardOutcome: { kind: 'success', value: leaderboard() },
      summaries: [summary()],
    });

    const { rerender } = renderScreen(api);

    await screen.findByRole('heading', { level: 1, name: 'Thursday Ballers' });

    expect(publishSpy.mock.calls.length).toBeGreaterThan(0);

    // "Called once" is a statement about call *sites*: a render pass that changes
    // nothing publishes exactly once more. A second call site — a component below
    // the screen also publishing — would add a second call to the same pass.
    const beforeRerender = publishSpy.mock.calls.length;
    rerender();

    expect(publishSpy.mock.calls.length).toBe(beforeRerender + 1);
  });
});
