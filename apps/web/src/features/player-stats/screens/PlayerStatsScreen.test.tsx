/**
 * Worked examples for the Player_Stats_Screen (task 11.1).
 *
 * The quantified claims about this screen live in their own files: one call per
 * subject and the unidentifiable subject (Properties 30 and 31), abandonment
 * (Property 32), graceful degradation across the three tracking conditions
 * (Property 28), and — once task 14 lands — the heading outlines, keyboard
 * reachability, and the axe audit in both Themes (Properties 33 to 35). What is
 * pinned here is what a property would only obscure: the four condition bodies
 * as rendered surfaces, the fixed section order, the single level-one heading in
 * each condition, the way out rendered in all four, and the single Squad_Scope
 * publication.
 *
 * Two seams are supplied and one is replaced:
 *
 *  - a `PlayerStatsApi` answering with settled `CallResult` values, and a
 *    `SessionManager` reporting `authenticated`;
 *  - the App_Shell's `usePublishSquadScopeFromRoute`, which reads the shell's
 *    publish context and throws where none is above it. That is correct for the
 *    application — the Player_Stats_Route is a child of the shell's `/app`
 *    layout route — and unusable for a screen rendered on its own, so it is
 *    replaced by a counting stand-in, which is also what makes "published
 *    exactly once" observable at all. Only that one export is replaced; the
 *    parameter name stays the shell's own.
 *
 * The screen runs inside a real `MemoryRouter` at the real Player_Stats_Route,
 * so both parameters arrive the way the router delivers them.
 *
 * Requirements: 1.4, 1.5, 1.6, 2.2, 2.3, 3.1, 4.1, 4.3, 16.3
 */
import { type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AuthProvider, type AuthState, type SessionManager } from '../../auth';
import { PLAYER_STATS_ROUTE, playerStatsPath, squadPath } from '../../squads';
import type { CallResult, PlayerStatsApi } from '../api/playerStatsApi';
import { FAILURE_NOTICE_SELECTOR } from '../components/FailureNotice';
import { LOADING_INDICATION_SELECTOR } from '../components/LoadingIndication';
import { NOT_FOUND_TREATMENT_SELECTOR } from '../components/NotFoundTreatment';
import { STAT_SECTION_SELECTOR } from '../components/StatSection';
import { MAIN_CONTENT_SELECTOR } from '../components/surfaceFocus';
import {
  BACK_TO_SQUAD_LABEL,
  BEST_PARTNERSHIPS_HEADING,
  BIBS_SECTION_HEADING,
  BOGEY_OPPONENTS_HEADING,
  MOST_PLAYED_AGAINST_HEADING,
  MOST_PLAYED_WITH_HEADING,
  NOT_FOUND_TREATMENT_HEADING,
  PLAYER_STATS_HEADING,
  PROFILE_LOADING_LABEL,
  PROGRESSION_SECTION_HEADING,
  RATING_SECTION_HEADING,
  RECORD_SECTION_HEADING,
  RETRY_LABEL,
  RICH_STATS_SECTION_HEADING,
  STREAKS_SECTION_HEADING,
} from '../lib/messages';
import type { PlayerProfile } from '../lib/parse/playerProfile';
import {
  PLAYER_STATS_SCREEN_SELECTOR,
  PlayerStatsScreen,
  SQUAD_RETURN_CONTROL_SELECTOR,
} from './PlayerStatsScreen';

// --- the App_Shell seam -------------------------------------------------------

/** How many times the screen published the Squad_Scope. */
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

const SQUAD_ID = '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b';
const MEMBERSHIP_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_MEMBERSHIP_ID = '99999999-8888-4777-8666-555555555554';

/**
 * The ten section headings, in the reading order the design fixes: record,
 * rating, progression, streaks, bibs, the four Pairwise_Sections, rich stats.
 * The identity header is not one of them — it carries the `h1`.
 */
const SECTION_HEADINGS: readonly string[] = [
  RECORD_SECTION_HEADING,
  RATING_SECTION_HEADING,
  PROGRESSION_SECTION_HEADING,
  STREAKS_SECTION_HEADING,
  BIBS_SECTION_HEADING,
  MOST_PLAYED_WITH_HEADING,
  MOST_PLAYED_AGAINST_HEADING,
  BEST_PARTNERSHIPS_HEADING,
  BOGEY_OPPONENTS_HEADING,
  RICH_STATS_SECTION_HEADING,
];

function profile(overrides: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    membershipId: MEMBERSHIP_ID,
    displayName: 'Ada',
    state: 'Active',
    isGuest: false,
    record: { appearances: 12, wins: 7, draws: 2, losses: 3 },
    winPercentage: 58.3,
    rating: { state: 'Established', displayRating: 1200 },
    progression: [{ completedAtMs: 1_700_000_000_000, displayRating: 1200 }],
    winStreak: 3,
    unbeatenStreak: 5,
    mostPlayedWith: [
      { membershipId: OTHER_MEMBERSHIP_ID, displayName: 'Grace', count: 9 },
    ],
    mostPlayedAgainst: [],
    bestPartnerships: [
      {
        membershipId: OTHER_MEMBERSHIP_ID,
        displayName: 'Grace',
        value: 72.5,
        qualifyingMatches: 8,
      },
    ],
    bogeyOpponents: [],
    bibAppearances: 4,
    rich: null,
    ...overrides,
  };
}

/** A promise that never settles — the awaiting-first-response state. */
function pending(): Promise<CallResult<PlayerProfile>> {
  return new Promise<CallResult<PlayerProfile>>(() => undefined);
}

// --- the seams ----------------------------------------------------------------

/** What one activation of the one method recorded. */
interface RecordedCall {
  readonly squadId: string;
  readonly membershipId: string;
}

/**
 * A Player_Stats_Api answering with one outcome per call — the last reused once
 * the list is exhausted — and recording every activation, so "no call issued"
 * and "exactly one call" are both observable.
 */
function createFakeApi(
  outcomes: readonly (CallResult<PlayerProfile> | Promise<CallResult<PlayerProfile>>)[],
): { readonly api: PlayerStatsApi; readonly calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];

  return {
    calls,
    api: {
      getPlayerProfile(squadId, membershipId) {
        const index = Math.min(calls.length, outcomes.length - 1);
        calls.push({ squadId, membershipId });

        return Promise.resolve(outcomes[index]);
      },
    },
  };
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

/** The screen at its real route, inside a real router and a real AuthProvider. */
function screenTree(api: PlayerStatsApi, path: string): ReactElement {
  return (
    <AuthProvider manager={sessionManager()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={PLAYER_STATS_ROUTE} element={<PlayerStatsScreen api={api} />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

function renderScreen(
  api: PlayerStatsApi,
  path: string = playerStatsPath(SQUAD_ID, MEMBERSHIP_ID),
): { readonly rerender: () => void } {
  const { rerender } = render(screenTree(api, path));

  // A *fresh* element each time, so React re-renders rather than bailing out on
  // an unchanged element identity — which is what makes the publication count
  // below observable.
  return { rerender: () => rerender(screenTree(api, path)) };
}

function headingTexts(level: number): readonly string[] {
  return screen
    .getAllByRole('heading', { level })
    .map((heading) => heading.textContent ?? '');
}

function sectionHeadings(): readonly string[] {
  return Array.from(document.querySelectorAll(STAT_SECTION_SELECTOR)).map(
    (section) => section.querySelector('h2')?.textContent ?? '',
  );
}

/** The way-out control, whichever condition rendered it. */
function squadReturnControl(): HTMLAnchorElement {
  const control = document.querySelector<HTMLAnchorElement>(
    `${SQUAD_RETURN_CONTROL_SELECTOR}, ${NOT_FOUND_TREATMENT_SELECTOR} a`,
  );

  if (control === null) {
    throw new Error('the screen rendered no control back to the squad');
  }

  return control;
}

// --- the examples -------------------------------------------------------------

describe('PlayerStatsScreen — the four condition bodies', () => {
  // Requirements: 2.2, 16.1
  it('renders the loading indication alone while no profile is held', async () => {
    const { api, calls } = createFakeApi([pending()]);

    renderScreen(api);

    await waitFor(() => {
      expect(document.querySelector(LOADING_INDICATION_SELECTOR)).not.toBeNull();
    });

    const busy = document.querySelector(LOADING_INDICATION_SELECTOR);
    expect(busy?.getAttribute('aria-busy')).toBe('true');
    expect(busy?.textContent).toBe(PROFILE_LOADING_LABEL);

    // A fixed noun stands in for the name that has not arrived, so the screen
    // still holds exactly one level-one heading.
    expect(headingTexts(1)).toEqual([PLAYER_STATS_HEADING]);
    expect(sectionHeadings()).toEqual([]);
    expect(document.querySelector(FAILURE_NOTICE_SELECTOR)).toBeNull();
    expect(document.querySelector(NOT_FOUND_TREATMENT_SELECTOR)).toBeNull();

    // 1.4: the subject came from the route's own two parameters.
    expect(calls).toEqual([{ squadId: SQUAD_ID, membershipId: MEMBERSHIP_ID }]);
  });

  // Requirements: 5.1, 16.1, 16.3
  it('renders the parsed name as its one level-one heading and the ten sections in order', async () => {
    const { api } = createFakeApi([{ kind: 'success', value: profile() }]);

    renderScreen(api);

    await waitFor(() => {
      expect(headingTexts(1)).toEqual(['Ada']);
    });

    expect(sectionHeadings()).toEqual(SECTION_HEADINGS);
    // Each section carries exactly one level-two heading and no other level, so
    // the ten headings above are the whole of the screen's second level.
    expect(headingTexts(2)).toEqual(SECTION_HEADINGS);
    expect(screen.queryAllByRole('heading', { level: 3 })).toEqual([]);

    // Nothing awaits a response, so no busy state sits beside the stack.
    expect(document.querySelector(LOADING_INDICATION_SELECTOR)).toBeNull();
    expect(document.querySelector(FAILURE_NOTICE_SELECTOR)).toBeNull();
    expect(document.querySelector(NOT_FOUND_TREATMENT_SELECTOR)).toBeNull();
  });

  // Requirements: 4.1, 4.3
  it('renders the generic failure with its retry control, and never the not-found treatment', async () => {
    const { api } = createFakeApi([{ kind: 'transport-failure' }]);

    renderScreen(api);

    await waitFor(() => {
      expect(document.querySelector(FAILURE_NOTICE_SELECTOR)).not.toBeNull();
    });

    expect(document.querySelector(NOT_FOUND_TREATMENT_SELECTOR)).toBeNull();
    expect(headingTexts(1)).toEqual([PLAYER_STATS_HEADING]);
    // 4.1: no partially populated profile behind the failure.
    expect(sectionHeadings()).toEqual([]);
    expect(screen.getByRole('button', { name: RETRY_LABEL })).toBeVisible();
  });

  // Requirements: 2.8
  it('issues exactly one further call when the retry control is activated', async () => {
    const { api, calls } = createFakeApi([
      { kind: 'timeout' },
      { kind: 'success', value: profile() },
    ]);

    renderScreen(api);

    await waitFor(() => {
      expect(document.querySelector(FAILURE_NOTICE_SELECTOR)).not.toBeNull();
    });

    await userEvent.click(screen.getByRole('button', { name: RETRY_LABEL }));

    await waitFor(() => {
      expect(headingTexts(1)).toEqual(['Ada']);
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ squadId: SQUAD_ID, membershipId: MEMBERSHIP_ID });
  });

  // Requirements: 3.1, 3.6, 4.3
  it('renders the not-found treatment alone for a concealed absence', async () => {
    const { api } = createFakeApi([{ kind: 'not-found' }]);

    renderScreen(api);

    await waitFor(() => {
      expect(document.querySelector(NOT_FOUND_TREATMENT_SELECTOR)).not.toBeNull();
    });

    // 3.6: the condition's own heading, naming neither squad nor player.
    expect(headingTexts(1)).toEqual([NOT_FOUND_TREATMENT_HEADING]);
    expect(sectionHeadings()).toEqual([]);
    expect(document.querySelector(FAILURE_NOTICE_SELECTOR)).toBeNull();
    expect(screen.queryByRole('button', { name: RETRY_LABEL })).toBeNull();
  });

  // Requirements: 1.4, 3.3
  it('issues no call and renders the not-found treatment for a malformed identity', async () => {
    const { api, calls } = createFakeApi([{ kind: 'success', value: profile() }]);

    renderScreen(api, `/app/squads/${SQUAD_ID}/players/not-an-identity`);

    await waitFor(() => {
      expect(document.querySelector(NOT_FOUND_TREATMENT_SELECTOR)).not.toBeNull();
    });

    expect(calls).toEqual([]);
    expect(headingTexts(1)).toEqual([NOT_FOUND_TREATMENT_HEADING]);
  });
});

describe('PlayerStatsScreen — the frame around the bodies', () => {
  // Requirements: 1.6
  it('renders a control to the route squad in every condition', async () => {
    const conditions: readonly CallResult<PlayerProfile>[] = [
      { kind: 'success', value: profile() },
      { kind: 'not-found' },
      { kind: 'transport-failure' },
    ];

    for (const outcome of conditions) {
      const { api } = createFakeApi([outcome]);
      const { unmount } = render(
        screenTree(api, playerStatsPath(SQUAD_ID, MEMBERSHIP_ID)),
      );

      await waitFor(() => {
        expect(squadReturnControl().textContent).toBe(BACK_TO_SQUAD_LABEL);
      });

      // Built by the squads barrel's own builder, so the control cannot drift
      // from where the Squad_Screen is registered.
      expect(squadReturnControl().getAttribute('href')).toBe(squadPath(SQUAD_ID));

      unmount();
    }

    // And in the loading condition, which never settles.
    const { api } = createFakeApi([pending()]);
    renderScreen(api);

    await waitFor(() => {
      expect(squadReturnControl().getAttribute('href')).toBe(squadPath(SQUAD_ID));
    });
  });

  // Requirements: 16.5
  it('wraps the condition body in the programmatically focusable main region', async () => {
    const { api } = createFakeApi([{ kind: 'success', value: profile() }]);

    renderScreen(api);

    await waitFor(() => {
      expect(headingTexts(1)).toEqual(['Ada']);
    });

    const screenRoot = document.querySelector(PLAYER_STATS_SCREEN_SELECTOR);
    const region = document.querySelector(MAIN_CONTENT_SELECTOR);

    expect(screenRoot).not.toBeNull();
    expect(region).not.toBeNull();
    expect(region?.getAttribute('tabindex')).toBe('-1');
    expect(screenRoot?.contains(region ?? null)).toBe(true);
  });

  // Requirements: 1.5
  it('publishes the Squad_Scope once per render and never twice in one', async () => {
    publishSpy.mockClear();

    const { api } = createFakeApi([{ kind: 'success', value: profile() }]);
    const { rerender } = renderScreen(api);

    await waitFor(() => {
      expect(headingTexts(1)).toEqual(['Ada']);
    });

    const afterFirstRender = publishSpy.mock.calls.length;
    rerender();

    // One publication per render of the screen: the hook is called once in the
    // component body and from nowhere else, so a re-render adds exactly one.
    expect(publishSpy.mock.calls.length).toBe(afterFirstRender + 1);
  });
});
