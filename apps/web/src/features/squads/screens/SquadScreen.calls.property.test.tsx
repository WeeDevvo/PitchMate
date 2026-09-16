/**
 * Property test for the calls the Squad_Screen issues (task 13.5).
 *
 * **Property 34: The feature issues exactly the calls its screens need.** *For
 * any* sequence of interactions with the rendered Squad_Screen that does not
 * activate an admin control, the multiset of issued calls contains exactly one
 * `GetSquad`, exactly one display-rating `GetSquadLeaderboard`, and — while
 * Admin_Authority holds — exactly one `ListInvites`, and contains no match call,
 * no further leaderboard call, no player-profile call, and no `GetFeatureFlags`
 * call.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | 7.1 — one `GetSquad` and one display-rating `GetSquadLeaderboard`, for the requested squad | {@link expectIssuedCalls} |
 * | 14.2 — no `GetFeatureFlags`, because the `GetSquad` body carries `features` | {@link expectIssuedCalls} |
 * | 15.5 — no match call and no leaderboard call beyond the Player_List's one | {@link expectIssuedCalls}, and the surface check below |
 * | 9.6 — no player-profile call, including after a Player_Row navigation | {@link expectIssuedCalls}, and the surface check below |
 * | 11.1, 10.4 — one `ListInvites` exactly while Admin_Authority holds, none without it | {@link expectIssuedCalls} |
 *
 * ### The multiset includes one `ListMySquads`, and that is not a stray call
 *
 * A `GetSquad` body carries a squad's memberships but identifies **none** of them
 * as the caller's, so the caller's own Member_Role (Requirement 6.3) and
 * Admin_Authority (Requirement 6.10) cannot be read from it. Requirement 6.10
 * names the `ListMySquads` summary as the other source, and the screen reuses the
 * feature's one `ListMySquads` machine to get it. So the expected multiset for a
 * mount is a *triple* — `ListMySquads`, `GetSquad`, `GetSquadLeaderboard` — and
 * the property pins the third at exactly one for the same reason it pins the
 * other two: a re-render, a focus move, or a click on the screen's own furniture
 * must add nothing to it.
 *
 * ### What "does not activate an admin control" means here
 *
 * The generated alphabet is deliberately made of *targeted* interactions — a
 * click at a named element of the screen's own frame, a focus move, an Escape
 * press, a re-render, and an activation of a Player_Row's navigation control
 * (Requirement 9.1, which is not an admin control and is present for every
 * caller). No generated interaction presses Enter or Space, so a `Tab` that lands
 * focus inside the Admin_Section moves focus and nothing more: the sequences
 * exercise the screen without ever activating the invite, guest, feature-toggle,
 * or promotion controls the property excludes.
 *
 * A navigation is included on purpose rather than avoided: leaving the screen for
 * the Player_Stats_Route is the moment Requirement 9.6 is about, and the
 * assertion holds across it — the departure adds no player-profile call and no
 * further squad read.
 *
 * ### Two seams are supplied and one is replaced
 *
 * A recording `SquadsApi` answers the three reads the screen needs and **records
 * every one of its fourteen methods**, so an unexpected call fails as a multiset
 * difference naming the method rather than as an exception thrown from inside a
 * React commit. The App_Shell's `usePublishSquadScopeFromRoute` throws outside
 * the shell's own provider, so — exactly as the worked-example file does — that
 * single barrel export is replaced by an inert stand-in; the real publication is
 * exercised where the real router is assembled.
 *
 * That the one leaderboard method carries the display-rating statistic is the
 * transport seam's own fact and is asserted in `api/squadsApi.test.ts`, which
 * pins the `statistic=DisplayRating` query. What is asserted here is that the
 * leaderboard call the screen issues is that method, once — and the surface check
 * below states that the seam declares no second leaderboard operation for a
 * screen to reach for.
 *
 * Feature: web-squads-screens, Property 34: The feature issues exactly the calls its screens need
 * Validates: Requirements 7.1, 9.6, 14.2, 15.5
 */
import { type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import fc from 'fast-check';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AuthProvider, type SessionManager } from '../../auth';
import type { CallResult, SquadsApi } from '../api/squadsApi';
import { PLAYER_ROW_OPEN_SELECTOR } from '../components/PlayerRow';
import type {
  MemberRole,
  MembershipStateValue,
  SquadFeatureValue,
} from '../lib/enumCodes';
import type { FeatureFlag } from '../lib/parse/featureFlags';
import type { DisplayRatingLeaderboard } from '../lib/parse/leaderboard';
import type { SquadDetail, SquadMember } from '../lib/parse/squadDetail';
import type { SquadSummary } from '../lib/parse/squadSummary';
import { PLAYER_STATS_ROUTE, SQUAD_ROUTE, squadPath } from '../lib/routePaths';
import {
  PLAYERS_SECTION_SELECTOR,
  SQUAD_DETAIL_SECTION_SELECTOR,
  SQUAD_SCREEN_SELECTOR,
  SquadScreen,
} from './SquadScreen';

// --- the App_Shell seam -------------------------------------------------------

/**
 * `usePublishSquadScopeFromRoute` reads the shell's publish context and throws
 * where none is above it, which is correct for the application and unusable for a
 * screen rendered on its own. Only that one export is replaced; the route pattern
 * and the parameter name stay the shell's own.
 */
vi.mock('../../app-shell', async () => {
  const actual =
    await vi.importActual<typeof import('../../app-shell')>('../../app-shell');

  return { ...actual, usePublishSquadScopeFromRoute: () => null };
});

// --- the squad under test -----------------------------------------------------

/** The requested squad identity, which every issued call must carry. */
const SQUAD_ID = '4b1c3e6a-9d2f-4a55-8b7e-1f2c3d4e5f60';

/** A squad the caller's summary may name instead, so no summary identifies them. */
const OTHER_SQUAD_ID = '7c2d4f8b-1e3a-4b66-9c8f-2a3b4c5d6e71';

// --- Generators ---------------------------------------------------------------

const MEMBER_NAMES: readonly string[] = [
  'Ada',
  'Grace',
  'Dave',
  'BigDave',
  'Former player',
];

const roleArb: fc.Arbitrary<MemberRole | null> = fc.constantFrom<
  (MemberRole | null)[]
>('owner', 'admin', 'member', null);

const stateArb: fc.Arbitrary<MembershipStateValue> = fc.constantFrom<
  MembershipStateValue[]
>('active', 'inactive');

/** One Squad_Member of the generated Squad_Detail, minus its identity. */
const memberShapeArb = fc.record({
  displayName: fc.constantFrom(...MEMBER_NAMES),
  role: roleArb,
  state: stateArb,
  isGuest: fc.boolean(),
});

/**
 * A Squad_Detail carrying at least one member, so a Player_Row navigation control
 * exists to be activated, with distinct membership identities as the backend
 * guarantees.
 */
const detailArb: fc.Arbitrary<SquadDetail> = fc
  .array(memberShapeArb, { minLength: 1, maxLength: 3 })
  .chain((shapes) =>
    fc
      .uniqueArray(fc.uuid(), {
        minLength: shapes.length,
        maxLength: shapes.length,
      })
      .chain((identities) =>
        fc
          .array(
            fc.record({
              feature: fc.constant<SquadFeatureValue>('live-match-tracking'),
              isEnabled: fc.boolean(),
            }),
            { maxLength: 1 },
          )
          .map(
            (features): SquadDetail => ({
              squadId: SQUAD_ID,
              name: 'Thursday Ballers',
              members: shapes.map(
                (shape, index): SquadMember => ({
                  ...shape,
                  membershipId: identities[index],
                }),
              ),
              features: features as readonly FeatureFlag[],
            }),
          ),
      ),
  );

/**
 * The caller's own standing, as the `ListMySquads` listing reports it: a summary
 * for this squad carrying either role and either state, a summary for a different
 * squad, or no summary at all — the last two being the unidentified caller of
 * Requirement 6.10.
 */
type CallerCase =
  | { readonly kind: 'this-squad'; readonly role: MemberRole | null; readonly state: MembershipStateValue }
  | { readonly kind: 'other-squad' }
  | { readonly kind: 'none' };

const callerArb: fc.Arbitrary<CallerCase> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('this-squad' as const),
      role: roleArb,
      state: stateArb,
    }),
  },
  { weight: 1, arbitrary: fc.constant({ kind: 'other-squad' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'none' as const }) },
);

/** How the one leaderboard call settles. Every non-success arm is one phase. */
const leaderboardArb: fc.Arbitrary<CallResult<DisplayRatingLeaderboard>> =
  fc.constantFrom<CallResult<DisplayRatingLeaderboard>[]>(
    { kind: 'success', value: { entries: [] } },
    { kind: 'timeout' },
    { kind: 'parse-failure' },
    { kind: 'transport-failure' },
    { kind: 'not-found' },
  );

/**
 * One interaction with the rendered screen.
 *
 * Every kind is either a targeted click at the screen's own frame, a focus move,
 * a key press that activates nothing, a re-render, or an activation of a
 * Player_Row navigation control — so no sequence can activate an admin control.
 */
type Interaction =
  | { readonly kind: 'rerender' }
  | { readonly kind: 'clickHeading' }
  | { readonly kind: 'clickDetailSection' }
  | { readonly kind: 'clickPlayersHeading' }
  | { readonly kind: 'tab' }
  | { readonly kind: 'shiftTab' }
  | { readonly kind: 'escape' }
  | { readonly kind: 'openPlayer'; readonly which: number };

const interactionArb: fc.Arbitrary<Interaction> = fc.oneof(
  fc.constant({ kind: 'rerender' as const }),
  fc.constant({ kind: 'clickHeading' as const }),
  fc.constant({ kind: 'clickDetailSection' as const }),
  fc.constant({ kind: 'clickPlayersHeading' as const }),
  fc.constant({ kind: 'tab' as const }),
  fc.constant({ kind: 'shiftTab' as const }),
  fc.constant({ kind: 'escape' as const }),
  fc.record({
    kind: fc.constant('openPlayer' as const),
    which: fc.nat({ max: 4 }),
  }),
);

/** One generated case: what the backend answers, and what the person does. */
interface ScreenCase {
  readonly detail: SquadDetail;
  readonly caller: CallerCase;
  readonly leaderboard: CallResult<DisplayRatingLeaderboard>;
  readonly interactions: readonly Interaction[];
}

const screenCaseArb: fc.Arbitrary<ScreenCase> = fc.record({
  detail: detailArb,
  caller: callerArb,
  leaderboard: leaderboardArb,
  interactions: fc.array(interactionArb, { maxLength: 5 }),
});

// --- Admin_Authority, restated ------------------------------------------------

/**
 * Requirement 10.1's rule, written out here rather than imported: authority holds
 * only for an active membership whose role is owner or admin, and an unidentified
 * caller holds none.
 *
 * Restated because asserting the screen against the very function it gates on
 * would pass for any rule that function happened to implement, including a wrong
 * one.
 */
function holdsAdminAuthority(caller: CallerCase): boolean {
  if (caller.kind !== 'this-squad') {
    return false;
  }

  return (
    caller.state === 'active' && (caller.role === 'owner' || caller.role === 'admin')
  );
}

/** The `ListMySquads` listing a generated caller case describes. */
function summariesOf(caller: CallerCase): readonly SquadSummary[] {
  switch (caller.kind) {
    case 'this-squad':
      return [
        {
          squadId: SQUAD_ID,
          name: 'Thursday Ballers',
          role: caller.role,
          state: caller.state,
        },
      ];
    case 'other-squad':
      return [
        {
          squadId: OTHER_SQUAD_ID,
          name: 'Other lot',
          role: 'owner',
          state: 'active',
        },
      ];
    default:
      return [];
  }
}

// --- The recording transport seam --------------------------------------------

/** One issued call: which method, and the squad identity it carried. */
interface RecordedCall {
  readonly method: string;
  readonly squadId: string | null;
}

/**
 * Every method of the Squads_Api, so the multiset can be asserted over the whole
 * surface rather than only over the four the screen is expected to reach.
 */
const API_METHODS: readonly (keyof SquadsApi)[] = [
  'listMySquads',
  'getSquad',
  'getDisplayRatingLeaderboard',
  'createSquad',
  'redeemInvite',
  'previewInvite',
  'listInvites',
  'generateInvite',
  'revokeInvite',
  'createGuest',
  'editGuest',
  'promoteToAdmin',
  'getFeatureFlags',
  'setFeatureFlag',
];

/**
 * A Squads_Api that answers the three reads the Squad_Screen needs plus the one
 * the Invite_Manager needs, and **records all fourteen methods**.
 *
 * A method the screen has no business calling is recorded and settled as a
 * transport failure rather than thrown from, so an unexpected call is reported as
 * a difference in the asserted multiset — naming the method — instead of as an
 * exception surfacing from wherever React happened to be at the time.
 */
function createRecordingApi(testCase: ScreenCase): {
  readonly api: SquadsApi;
  readonly calls: readonly RecordedCall[];
} {
  const calls: RecordedCall[] = [];

  const record = (method: keyof SquadsApi, squadId: string | null): void => {
    calls.push({ method, squadId });
  };

  /** Every unexpected method's answer: settled, and carrying nothing. */
  const refused = <T,>(method: keyof SquadsApi, squadId: string | null) => {
    record(method, squadId);
    return Promise.resolve<CallResult<T>>({ kind: 'transport-failure' });
  };

  const api: SquadsApi = {
    listMySquads: () => {
      record('listMySquads', null);
      return Promise.resolve({
        kind: 'success',
        value: summariesOf(testCase.caller),
      });
    },
    getSquad: (squadId) => {
      record('getSquad', squadId);
      return Promise.resolve({ kind: 'success', value: testCase.detail });
    },
    getDisplayRatingLeaderboard: (squadId) => {
      record('getDisplayRatingLeaderboard', squadId);
      return Promise.resolve(testCase.leaderboard);
    },
    listInvites: (squadId) => {
      record('listInvites', squadId);
      return Promise.resolve({ kind: 'success', value: [] });
    },
    createSquad: () => refused('createSquad', null),
    redeemInvite: () => refused('redeemInvite', null),
    previewInvite: () => refused('previewInvite', null),
    generateInvite: (squadId) => refused('generateInvite', squadId),
    revokeInvite: (squadId) => refused('revokeInvite', squadId),
    createGuest: (squadId) => refused('createGuest', squadId),
    editGuest: (squadId) => refused('editGuest', squadId),
    promoteToAdmin: (squadId) => refused('promoteToAdmin', squadId),
    getFeatureFlags: (squadId) => refused('getFeatureFlags', squadId),
    setFeatureFlag: (squadId) => refused('setFeatureFlag', squadId),
  };

  return { api, calls };
}

/** A `SessionManager` reporting `authenticated`, the only state that calls. */
function sessionManager(): SessionManager {
  return {
    bootstrap: () => 'authenticated',
    establish: () => undefined,
    getState: () => 'authenticated',
    getAccessTokenForRequest: () => Promise.resolve({ token: 'test-token' }),
    signOut: () => Promise.resolve(),
    subscribe: () => () => undefined,
  };
}

// --- Rendering and driving ----------------------------------------------------

/** Let every settled call deliver and every resulting React update apply. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 24; round += 1) {
      await Promise.resolve();
    }
  });
}

/** The screen at its real route, with the Player_Stats_Route registered as a stub. */
function screenTree(api: SquadsApi): ReactElement {
  return (
    <AuthProvider manager={sessionManager()}>
      <MemoryRouter initialEntries={[squadPath(SQUAD_ID)]}>
        <Routes>
          <Route path={SQUAD_ROUTE} element={<SquadScreen api={api} />} />
          {/* A stub, because this feature registers no screen there (9.6). It
              issues nothing, so a navigation cannot add a call of its own. */}
          <Route path={PLAYER_STATS_ROUTE} element={<p>player stats</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

/** The first element matching a selector within the screen, or `null`. */
function within(selector: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(selector);
}

/**
 * Apply one generated interaction, doing nothing where its target is not
 * rendered — which is the ordinary case after a navigation has left the screen.
 */
async function apply(
  interaction: Interaction,
  user: UserEvent,
  rerender: () => void,
): Promise<void> {
  switch (interaction.kind) {
    case 'rerender':
      // A fresh element, so React re-renders rather than bailing out on an
      // unchanged element identity: a re-render must add no call (6.2, 7.1).
      act(() => {
        rerender();
      });
      return;

    case 'clickHeading': {
      const heading = within(`${SQUAD_SCREEN_SELECTOR} h1`);
      if (heading !== null) {
        await user.click(heading);
      }
      return;
    }

    case 'clickDetailSection': {
      const section = within(SQUAD_DETAIL_SECTION_SELECTOR);
      if (section !== null) {
        await user.click(section);
      }
      return;
    }

    case 'clickPlayersHeading': {
      const heading = within(`${PLAYERS_SECTION_SELECTOR} h2`);
      if (heading !== null) {
        await user.click(heading);
      }
      return;
    }

    // A focus move activates nothing, so it stays inside the property's premise
    // even where it lands within the Admin_Section.
    case 'tab':
      await user.tab();
      return;

    case 'shiftTab':
      await user.tab({ shift: true });
      return;

    case 'escape':
      await user.keyboard('{Escape}');
      return;

    default: {
      // 9.1: the Player_Row's own navigation control, which every caller has and
      // which is not an admin control.
      const controls = document.querySelectorAll<HTMLElement>(
        PLAYER_ROW_OPEN_SELECTOR,
      );
      if (controls.length > 0) {
        await user.click(controls[interaction.which % controls.length]);
      }
      return;
    }
  }
}

// --- The assertion ------------------------------------------------------------

/** How many times a method was called. */
function countOf(calls: readonly RecordedCall[], method: keyof SquadsApi): number {
  return calls.filter((call) => call.method === method).length;
}

/**
 * The whole of Property 34, over the calls one run recorded.
 *
 * Stated first as a multiset equality over the entire fourteen-method surface —
 * which is what makes "no other call" a claim rather than an omission — and then
 * as the named clauses, so a failure says which one broke.
 */
function expectIssuedCalls(
  calls: readonly RecordedCall[],
  adminAuthority: boolean,
): void {
  const expected = [
    'getDisplayRatingLeaderboard',
    'getSquad',
    'listMySquads',
    ...(adminAuthority ? ['listInvites'] : []),
  ].sort();

  expect(calls.map((call) => call.method).sort()).toEqual(expected);

  // 7.1: exactly one squad read and exactly one leaderboard read — no further
  // leaderboard call, whatever the first one settled as.
  expect(countOf(calls, 'getSquad')).toBe(1);
  expect(countOf(calls, 'getDisplayRatingLeaderboard')).toBe(1);

  // 6.10: the caller's own standing needs the one `ListMySquads`, and one only.
  expect(countOf(calls, 'listMySquads')).toBe(1);

  // 11.1, 10.4: the invite listing exists exactly while the section that issues
  // it is mounted, which is exactly while Admin_Authority holds.
  expect(countOf(calls, 'listInvites')).toBe(adminAuthority ? 1 : 0);

  // 14.2: the Squad_Detail carries `features`, so no feature-flag read is owed.
  expect(countOf(calls, 'getFeatureFlags')).toBe(0);

  // 9.6, 15.5: nothing else at all — no admin submission from a non-admin
  // interaction, and no read this screen does not need.
  for (const method of API_METHODS) {
    if (
      method === 'getSquad' ||
      method === 'getDisplayRatingLeaderboard' ||
      method === 'listMySquads' ||
      method === 'listInvites'
    ) {
      continue;
    }
    expect(countOf(calls, method)).toBe(0);
  }

  // Every squad-scoped call carried the requested identity, so "exactly one" is
  // not satisfied by one call for some other squad.
  for (const call of calls) {
    if (call.squadId !== null) {
      expect(call.squadId).toBe(SQUAD_ID);
    }
  }
}

// --- The property -------------------------------------------------------------

describe('Property 34 — the feature issues exactly the calls its screens need', () => {
  // Feature: web-squads-screens, Property 34: The feature issues exactly the calls its screens need
  // Validates: Requirements 7.1, 9.6, 14.2, 15.5
  it('issues one GetSquad, one display-rating leaderboard call, one ListMySquads, and a ListInvites exactly while Admin_Authority holds', async () => {
    await fc.assert(
      fc.asyncProperty(screenCaseArb, async (testCase) => {
        const { api, calls } = createRecordingApi(testCase);
        const user = userEvent.setup({ delay: null });

        try {
          const view = render(screenTree(api));
          await flush();

          for (const interaction of testCase.interactions) {
            await apply(interaction, user, () => {
              view.rerender(screenTree(api));
            });
            await flush();
          }

          expectIssuedCalls(calls, holdsAdminAuthority(testCase.caller));
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  }, 240_000);

  /**
   * The two absences the property can only state negatively are also structural:
   * the feature's single transport seam declares no match operation and no
   * player-profile operation, and exactly one leaderboard operation — the
   * display-rating one, whose `statistic=DisplayRating` query
   * `api/squadsApi.test.ts` pins.
   *
   * Requirements: 9.6, 15.5
   */
  it('declares one leaderboard operation and no match or player-profile operation at all', () => {
    expect(
      API_METHODS.filter((method) => /leaderboard/iu.test(method)),
    ).toEqual(['getDisplayRatingLeaderboard']);

    expect(
      API_METHODS.filter((method) =>
        /match|fixture|profile|playerstats/iu.test(method),
      ),
    ).toEqual([]);
  });
});
