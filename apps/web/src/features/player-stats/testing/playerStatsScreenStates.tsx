/**
 * Every rendered condition of the Player_Stats_Screen, mounted on demand in
 * either Theme — the shared fixture the cross-cutting suites of task 14 read.
 *
 * Tasks 14.1, 14.2, and 14.3 all make claims about *the same set of rendered
 * trees*: the accessibility audits (14.1), the heading outlines and section
 * order (14.2), and keyboard reachability with focus placement (14.3). Each of
 * those needs the screen in every condition that materially changes the tree,
 * in the dark Theme and the light Theme. Building that set three times over
 * would give three sets that could drift apart, so it is built once here and
 * each suite iterates {@link SCREEN_STATE_CASES}.
 *
 * It follows the existing test-fixture convention — `src/app/appRouterTestHarness.tsx`,
 * `features/squads/testing/squadsScreenStates.tsx`, and this feature's own
 * `testing/playerProfileFixtures.ts`: a plain module the test-file glob does not
 * match, imported only by tests, asserting nothing itself beyond the guards that
 * make a mis-built state fail loudly rather than quietly audit the wrong tree.
 *
 * ### What is real, and what is replaced
 *
 * The screen is the application's own, unmodified, mounted inside a real
 * `MemoryRouter` at the real Player_Stats_Route and a real `AuthProvider`, so
 * both route parameters arrive the way the router delivers them and the load
 * machine settles real `CallResult` values. Two seams are replaced:
 *
 * - the **Player_Stats_Api**, by {@link createStubApi}, which answers with
 *   settled `CallResult` values — one per activation, the last reused — so a
 *   condition is reached through the machine rather than by handing the screen a
 *   phase;
 * - the **Session_Manager**, by a stand-in reporting one fixed Auth_State.
 *
 * One seam has to be replaced by the *caller*: the App_Shell's
 * `usePublishSquadScopeFromRoute`, which the screen calls and which throws where
 * no publish context is above it. That is correct for the application — the
 * Player_Stats_Route is a child of the shell's `/app` layout route — and
 * unusable for a screen rendered on its own, and reaching past the shell's
 * barrel for its provider would breach the module boundary the shell's own scan
 * enforces. `vi.mock` is hoisted per test file and cannot be performed from
 * here, so every file that renders a state declares this block at its top:
 *
 * ```ts
 * vi.mock('../../app-shell', async () => {
 *   const actual =
 *     await vi.importActual<typeof import('../../app-shell')>('../../app-shell');
 *   return { ...actual, usePublishSquadScopeFromRoute: (): string | null => null };
 * });
 * ```
 *
 * ### How a Theme is forced
 *
 * The Theme reaches the document element as the `data-theme` attribute the token
 * tables key off, written through the shared theme module's own
 * `applyThemeAttribute` (`src/theme`). It is not resolved from a stored
 * Appearance_Preference here, because this feature resolves none of its own
 * (Requirement 15.1) — the screen inherits whatever the frame around it applied.
 * So the attribute is written directly, which is exactly the contract
 * `styles/playerStatsTokens.css` depends on. That the *default* is dark with
 * nothing stored is a separate claim, asserted through the production bootstrap
 * rather than restated here — see {@link themeAppliedByBootstrap}.
 *
 * ### Where the profiles come from
 *
 * Every loaded condition's Player_Profile is built by
 * `testing/playerProfileFixtures.ts`'s own `buildPlayerProfileFixture` from
 * explicit choices, so a condition here and a generated body there are the same
 * kind of thing and the fixture module stays the one place a profile's shape is
 * described. Nothing is generated: an audit over a random profile would pass or
 * fail for a reason nobody could reproduce.
 *
 * Requirements: 16.7, 16.8
 */
import { act, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';

import { AuthProvider, type AuthState, type SessionManager } from '../../auth';
import { PLAYER_STATS_ROUTE, playerStatsPath, squadPath } from '../../squads';
import {
  THEME_ATTRIBUTE,
  THEME_BOOTSTRAP_SOURCE,
  applyThemeAttribute,
  type Theme,
} from '../../../theme';
import type { CallResult, PlayerStatsApi } from '../api/playerStatsApi';
import { FailureNotice } from '../components/FailureNotice';
import { ANONYMISED_PLACEHOLDER } from '../lib/anonymisedName';
import {
  BACK_TO_SQUAD_LABEL,
  PLAYER_STATS_HEADING,
  RETRY_LABEL,
} from '../lib/messages';
import type { PlayerProfile } from '../lib/parse/playerProfile';
import { resolveRatingCondition } from '../lib/ratingCondition';
import { resolveRichCondition } from '../lib/richStats';
import {
  PLAYER_STATS_SCREEN_SELECTOR,
  PlayerStatsScreen,
  SCREEN_CONDITION_ATTRIBUTE,
} from '../screens/PlayerStatsScreen';
import {
  absentRichBlockFixture,
  buildPlayerProfileFixture,
  canonicalWireDuration,
  canonicalWireInstant,
  coAppearanceEntryFixture,
  pairedStatEntryFixture,
  playerRecordFixture,
  presentRichBlockFixture,
  progressionRecordFixture,
  ratingSummaryFixture,
  richStatsFixture,
  wireIdentityForIndex,
  type PlayerProfileFixtureInput,
} from './playerProfileFixtures';

// --- The two Themes ---------------------------------------------------------

/** Both Themes, so every state below is rendered twice (Requirement 16.7). */
export const THEMES: readonly Theme[] = ['dark', 'light'];

/**
 * Write a Theme onto the document element, as the App_Shell's Theme_Provider and
 * the pre-paint bootstrap both do.
 *
 * Through the shared theme module's own function rather than a `setAttribute`
 * here, so the attribute name is the one declaration the stylesheets key off
 * (Requirement 15.1).
 */
export function applyTheme(theme: Theme): void {
  applyThemeAttribute(theme);
}

/**
 * Clear the applied Theme. The attribute lives on the document element, which
 * outlives an unmount, so this belongs in an `afterEach`.
 */
export function resetTheme(): void {
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
}

/**
 * Run the production pre-paint bootstrap and report the Theme it applied.
 *
 * The bootstrap is a source string precisely so it can be evaluated outside a
 * browser: this runs the same text the injected inline `<script>` runs, against
 * jsdom's `window`. It is how "the dark Theme is what renders with no stored
 * Appearance_Preference" is asserted from the real decision rather than from a
 * restatement of it (Requirement 16.7).
 */
export function themeAppliedByBootstrap(): string | null {
  new Function(THEME_BOOTSTRAP_SOURCE)();

  return document.documentElement.getAttribute(THEME_ATTRIBUTE);
}

// --- Identities ------------------------------------------------------------

/** The squad every state is about — a well-formed identity. */
export const SQUAD_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f01';

/**
 * The membership every state is about — the subject the route names and the
 * identity each profile below carries.
 *
 * Stamped by the fixtures' own index stamper, well clear of the indices the
 * Pairwise_Section rows use, so the subject is never also one of its own
 * entries: a Pairwise_Link pointing back at the open profile would be a
 * different tree from the one these states mean to audit.
 */
export const MEMBERSHIP_ID = wireIdentityForIndex(99);

/**
 * A membership identity no parser would accept.
 *
 * The screen short-circuits an unidentifiable subject to its
 * Not_Found_Treatment with no call issued (Requirement 3.3), which is a
 * condition of its own below.
 */
export const MALFORMED_MEMBERSHIP_ID = 'not-an-identity';

// --- The profiles each loaded condition presents ----------------------------

/** The two plottable points and one ratingless record of a populated history. */
const POPULATED_PROGRESSION: PlayerProfileFixtureInput['progression'] = [
  progressionRecordFixture({
    instant: canonicalWireInstant(1_767_225_600_000),
    displayRating: 1_120,
    displayRatingAbsence: 'null',
    state: 'Provisional',
    modelValues: [0, 0],
  }),
  progressionRecordFixture({
    instant: canonicalWireInstant(1_767_830_400_000),
    displayRating: null,
    displayRatingAbsence: 'null',
    state: 'Provisional',
    modelValues: [0, 0],
  }),
  progressionRecordFixture({
    instant: canonicalWireInstant(1_768_435_200_000),
    displayRating: 1_184,
    displayRatingAbsence: 'null',
    state: 'Established',
    modelValues: [0, 0],
  }),
];

/**
 * Two co-appearance rows, one of them an erased membership — so a populated
 * Pairwise_Section carries both an ordinary entry and a Former_Player entry
 * (Requirement 10.8) in the audited tree.
 */
const POPULATED_CO_APPEARANCES: PlayerProfileFixtureInput['mostPlayedWith'] = [
  coAppearanceEntryFixture({
    membershipId: wireIdentityForIndex(0),
    displayName: 'Ade',
    count: 19,
  }),
  coAppearanceEntryFixture({
    membershipId: wireIdentityForIndex(1),
    displayName: ANONYMISED_PLACEHOLDER,
    count: 11,
  }),
];

/** Two paired-statistic rows, for the other two Pairwise_Sections. */
const POPULATED_PAIRED_STATS: PlayerProfileFixtureInput['bestPartnerships'] = [
  pairedStatEntryFixture({
    membershipId: wireIdentityForIndex(2),
    displayName: 'Sam',
    value: 78.5,
    qualifyingMatches: 14,
  }),
  pairedStatEntryFixture({
    membershipId: wireIdentityForIndex(3),
    displayName: 'Kay',
    value: 21.5,
    qualifyingMatches: 9,
  }),
];

/** A settled Display_Rating — the `established` Rating_Condition. */
const ESTABLISHED_RATING = ratingSummaryFixture({
  state: 'Established',
  displayRating: 1_184,
  stateAbsence: 'null',
  displayRatingAbsence: 'null',
  modelValues: [0, 0],
});

/**
 * The profile the loaded conditions vary from: an active member with a settled
 * rating, a populated history, every Pairwise_Section carrying rows, and a
 * complete Rich_Stats block.
 *
 * Each condition below overrides exactly the members it is about, so a tree
 * differs from this one only in what its name says it differs in.
 */
const BASE_PROFILE_INPUT: PlayerProfileFixtureInput = {
  membershipId: MEMBERSHIP_ID,
  displayName: 'Ada',
  state: 'Active',
  stateAbsence: 'null',
  isGuest: false,
  record: playerRecordFixture({ appearances: 24, wins: 13, draws: 4, losses: 7 }),
  winPercentage: 54.2,
  winPercentageAbsence: 'null',
  rating: ESTABLISHED_RATING,
  progression: POPULATED_PROGRESSION,
  winStreak: 4,
  unbeatenStreak: 6,
  mostPlayedWith: POPULATED_CO_APPEARANCES,
  mostPlayedAgainst: POPULATED_CO_APPEARANCES,
  bestPartnerships: POPULATED_PAIRED_STATS,
  bogeyOpponents: POPULATED_PAIRED_STATS,
  bibAppearances: 9,
  rich: presentRichBlockFixture(
    richStatsFixture({
      goals: 12,
      cleanSheets: 2,
      goalsConcededAsKeeper: 18,
      keeperTime: canonicalWireDuration(4_500_000),
      absence: 'null',
    }),
  ),
};

/** The base profile with the given members replaced. */
export function profileWith(
  overrides: Partial<PlayerProfileFixtureInput> = {},
): PlayerProfile {
  return buildPlayerProfileFixture({ ...BASE_PROFILE_INPUT, ...overrides })
    .parsed;
}

/** Every collection empty and every count zero — a membership yet to play. */
const NEVER_PLAYED_OVERRIDES: Partial<PlayerProfileFixtureInput> = {
  record: playerRecordFixture({ appearances: 0, wins: 0, draws: 0, losses: 0 }),
  winPercentage: null,
  winPercentageAbsence: 'missing',
  progression: [],
  winStreak: 0,
  unbeatenStreak: 0,
  mostPlayedWith: [],
  mostPlayedAgainst: [],
  bestPartnerships: [],
  bogeyOpponents: [],
  bibAppearances: 0,
};

/** The four Pairwise_Sections carrying no entry at all (Requirement 10.7). */
const EMPTY_PAIRWISE_OVERRIDES: Partial<PlayerProfileFixtureInput> = {
  mostPlayedWith: [],
  mostPlayedAgainst: [],
  bestPartnerships: [],
  bogeyOpponents: [],
};

// --- The stubbed seams ------------------------------------------------------

/** A promise that never settles — a call that awaits a response. */
export function pendingCall(): Promise<CallResult<PlayerProfile>> {
  return new Promise<CallResult<PlayerProfile>>(() => undefined);
}

/** One settled or pending outcome of the one `GetPlayerProfile` method. */
export type ProfileOutcome =
  | CallResult<PlayerProfile>
  | Promise<CallResult<PlayerProfile>>;

/**
 * A Player_Stats_Api answering with one outcome per activation — the last reused
 * once the list is exhausted.
 *
 * A list rather than a single value, because two conditions below are reached by
 * a *second* call: the retry that follows a failure.
 */
export function createStubApi(
  outcomes: readonly ProfileOutcome[],
): PlayerStatsApi {
  let issued = 0;

  return {
    getPlayerProfile() {
      const outcome = outcomes[Math.min(issued, outcomes.length - 1)];
      issued += 1;

      return Promise.resolve(outcome);
    },
  };
}

/** A `SessionManager` reporting one fixed Auth_State, and nothing else. */
export function sessionManagerReporting(state: AuthState): SessionManager {
  return {
    bootstrap: () => state,
    establish: () => undefined,
    getState: () => state,
    getAccessTokenForRequest: () => Promise.resolve({ token: 'test-token' }),
    signOut: () => Promise.resolve(),
    subscribe: () => () => undefined,
  };
}

// --- Mounting ---------------------------------------------------------------

/** One rendered state: the tree, and the interactor that opened it. */
export interface RenderedScreen {
  /** The rendered container, which is what an audit is scoped to. */
  readonly container: HTMLElement;
  /** The `user-event` interactor, so a caller can continue from here. */
  readonly user: ReturnType<typeof userEvent.setup>;
}

/** One macrotask, with every resulting React update applied. */
async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

/**
 * Let the mount effects issue their call and the settled outcome commit.
 *
 * Two macrotasks: the first runs the mount effect that issues the call, the
 * second applies the update its resolved outcome dispatches.
 */
async function settle(): Promise<void> {
  await tick();
  await tick();
}

/** The screen at its real route, inside a real router and a real AuthProvider. */
function screenTree(api: PlayerStatsApi, path: string): ReactElement {
  return (
    <AuthProvider manager={sessionManagerReporting('authenticated')}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path={PLAYER_STATS_ROUTE}
            element={<PlayerStatsScreen api={api} />}
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

/** Fail with the state's name rather than with an empty-tree assertion later. */
function requireRendered(selector: string, state: string): void {
  if (document.querySelector(selector) === null) {
    throw new Error(`the ${state} state did not render ${selector}`);
  }
}

/**
 * Fail unless the screen reports the condition the state is defined by.
 *
 * Read from the screen's own `data-player-stats-condition` attribute rather than
 * inferred from the markup found, so a state that reached a *different*
 * condition fails here instead of being audited under the wrong name.
 */
function requireCondition(expected: string, state: string): void {
  const screenRoot = document.querySelector(PLAYER_STATS_SCREEN_SELECTOR);

  if (screenRoot === null) {
    throw new Error(`the ${state} state did not render the screen`);
  }

  const condition = screenRoot.getAttribute(SCREEN_CONDITION_ATTRIBUTE);

  if (condition !== expected) {
    throw new Error(
      `the ${state} state rendered the ${String(condition)} condition, not ${expected}`,
    );
  }
}

/** Mount a tree with the Theme applied first, and hand back the container. */
function mount(theme: Theme, tree: ReactElement): RenderedScreen {
  applyTheme(theme);
  const user = userEvent.setup();
  const { container } = render(tree);

  return { container, user };
}

/**
 * Mount the screen, let the first call settle, and check it reached `condition`.
 *
 * @param theme the Theme to apply before the first render
 * @param outcomes what the Player_Stats_Api answers, one per activation
 * @param condition the condition the screen must report
 * @param state the state's name, for a guard failure
 * @param membershipId the membership the route names
 */
async function mountScreenState(
  theme: Theme,
  outcomes: readonly ProfileOutcome[],
  condition: string,
  state: string,
  membershipId: string = MEMBERSHIP_ID,
): Promise<RenderedScreen> {
  const rendered = mount(
    theme,
    screenTree(
      createStubApi(outcomes),
      playerStatsPath(SQUAD_ID, membershipId),
    ),
  );

  await settle();
  requireCondition(condition, state);

  return rendered;
}

// --- The conditions that render no profile ----------------------------------

/** The screen awaiting its first response, holding no profile (Req 2.2). */
export async function renderLoadingState(theme: Theme): Promise<RenderedScreen> {
  return mountScreenState(theme, [pendingCall()], 'loading', 'loading');
}

/** The Not_Found_Treatment, reached by a concealed absence (Req 3.1). */
export async function renderNotFoundState(theme: Theme): Promise<RenderedScreen> {
  return mountScreenState(theme, [{ kind: 'not-found' }], 'not-found', 'not-found');
}

/**
 * The Not_Found_Treatment, reached by a route the subject cannot be read from —
 * no call issued (Requirement 3.3).
 *
 * Audited in its own right rather than assumed identical to the state above: the
 * two are *meant* to be indistinguishable, and an audit that only ever saw one
 * of them would not notice if they stopped being so.
 */
export async function renderUnidentifiableState(
  theme: Theme,
): Promise<RenderedScreen> {
  return mountScreenState(
    theme,
    [pendingCall()],
    'not-found',
    'unidentifiable subject',
    MALFORMED_MEMBERSHIP_ID,
  );
}

/** The Generic_Profile_Failure and its retry control (Requirement 4.1). */
export async function renderFailedState(theme: Theme): Promise<RenderedScreen> {
  return mountScreenState(
    theme,
    [{ kind: 'transport-failure' }],
    'failed',
    'failed',
  );
}

/**
 * The screen after the retry control has been activated and the further call is
 * still awaiting a response.
 *
 * Worth stating what this does *not* render, because it is the opposite of the
 * obvious guess: a failure clears the held profile (Requirement 4.1), so the
 * retry enters the nothing-held busy phase and the screen replaces the failure
 * surface with the loading indication. The condition the guard below requires is
 * therefore `loading`, and the tree audited is the one a person actually meets
 * after asking to try again. The *pending-retry failure surface* — the retry
 * control presented as unavailable while a call is in flight — is reached by
 * {@link renderFailedRetryPendingSurface} instead.
 */
export async function renderFailedRetryActivatedState(
  theme: Theme,
): Promise<RenderedScreen> {
  const state = 'failed, retry activated';
  const rendered = await mountScreenState(
    theme,
    [{ kind: 'transport-failure' }, pendingCall()],
    'failed',
    state,
  );

  await rendered.user.click(retryControl(state));
  await settle();

  requireCondition('loading', state);

  return rendered;
}

/** The one retry control, or a failure naming the state that wanted it. */
function retryControl(state: string): HTMLElement {
  const controls = Array.from(document.querySelectorAll('button')).filter(
    (control) => control.textContent?.trim() === RETRY_LABEL,
  );

  if (controls.length !== 1) {
    throw new Error(
      `the ${state} state rendered ${String(controls.length)} retry controls`,
    );
  }

  return controls[0];
}

/**
 * The failure surface with a retry awaiting a response — the markup
 * Requirement 4.5 asks for, and the one tree in this set that the screen's own
 * condition selection cannot produce.
 *
 * The screen passes the machine's busy flag to the notice, and the machine's
 * `failed` phase and its busy phases are mutually exclusive: the failure clears
 * the held profile, so a retry moves the screen to the loading body rather than
 * leaving the notice on screen with a pending control (see
 * {@link renderFailedRetryActivatedState}). The `aria-disabled` retry control is
 * nonetheless real markup the feature ships, so it is audited here as the screen
 * composes it — the same {@link FailureNotice}, the same heading above it, and
 * the same control back to the squad beside it, inside a real router.
 */
export async function renderFailedRetryPendingSurface(
  theme: Theme,
): Promise<RenderedScreen> {
  const rendered = mount(
    theme,
    <MemoryRouter initialEntries={[playerStatsPath(SQUAD_ID, MEMBERSHIP_ID)]}>
      <h1>{PLAYER_STATS_HEADING}</h1>
      <FailureNotice onRetry={() => undefined} retryBusy>
        {/* The screen's own control, class and hook included: this state is
            audited as "the same control back to the squad", and a bare `Link`
            would carry neither the presentation nor the declared focus
            indication the real one does (Property 34). */}
        <Link
          className="player-stats-squad-link"
          to={squadPath(SQUAD_ID)}
          data-player-stats-squad-return="true"
        >
          {BACK_TO_SQUAD_LABEL}
        </Link>
      </FailureNotice>
    </MemoryRouter>,
  );

  await tick();

  const state = 'failed, retry pending';
  requireRendered('[aria-busy="true"][aria-disabled="true"]', state);

  return rendered;
}

// --- The loaded conditions --------------------------------------------------

/** A loaded profile, audited under the name of what makes it that condition. */
export async function renderLoadedState(
  theme: Theme,
  profile: PlayerProfile,
  state: string,
): Promise<RenderedScreen> {
  return mountScreenState(
    theme,
    [{ kind: 'success', value: profile }],
    'loaded',
    state,
  );
}

// --- The whole set ----------------------------------------------------------

/** One rendered condition of the screen: its name, and how to reach it. */
export interface PlayerStatsScreenState {
  /** The condition's name, used in test titles and guard failures. */
  readonly name: string;
  /** Mount it in `theme` and hand back the tree. */
  render(theme: Theme): Promise<RenderedScreen>;
}

/** A loaded condition built from the base profile with `overrides` applied. */
function loadedCase(
  name: string,
  overrides: Partial<PlayerProfileFixtureInput>,
): PlayerStatsScreenState {
  return {
    name,
    render: (theme) => renderLoadedState(theme, profileWith(overrides), name),
  };
}

/**
 * Every condition that materially changes the Player_Stats_Screen's tree.
 *
 * The four condition bodies, both ways of reaching the Not_Found_Treatment, the
 * retry in both of its states, and then the loaded body across each dimension
 * that changes what it renders: the four Rating_Conditions, the three tracking
 * conditions, an empty and a populated progression, empty and populated
 * Pairwise_Sections, a guest membership, an erased one, and a membership with no
 * appearances at all.
 *
 * A suite iterates this rather than restating the list, so a condition added
 * here joins every suite of task 14 at once.
 *
 * Requirements: 16.7
 */
export const SCREEN_STATE_CASES: readonly PlayerStatsScreenState[] = [
  { name: 'loading', render: renderLoadingState },
  { name: 'not-found', render: renderNotFoundState },
  { name: 'unidentifiable subject', render: renderUnidentifiableState },
  { name: 'failed', render: renderFailedState },
  { name: 'failed, retry activated', render: renderFailedRetryActivatedState },
  { name: 'failed, retry pending', render: renderFailedRetryPendingSurface },

  // The four Rating_Conditions (Requirement 7.1).
  loadedCase('loaded, rating established', {}),
  loadedCase('loaded, rating provisional', {
    rating: ratingSummaryFixture({
      state: 'Provisional',
      displayRating: 1_120,
      stateAbsence: 'null',
      displayRatingAbsence: 'null',
      modelValues: [0, 0],
    }),
  }),
  // 7.4: a settled rating *and* a settled Display_Rating, overridden by the zero
  // Appearance_Count — the combination the precedence exists for.
  loadedCase('loaded, rating never played', NEVER_PLAYED_OVERRIDES),
  loadedCase('loaded, rating absent', {
    rating: ratingSummaryFixture({
      state: null,
      displayRating: null,
      stateAbsence: 'missing',
      displayRatingAbsence: 'missing',
      modelValues: [0, 0],
    }),
  }),

  // The three tracking conditions (Requirements 11.1, 11.2, 11.6).
  loadedCase('loaded, tracking disabled', {
    rich: absentRichBlockFixture('missing'),
  }),
  loadedCase('loaded, tracking empty', {
    rich: presentRichBlockFixture(
      richStatsFixture({
        goals: null,
        cleanSheets: null,
        goalsConcededAsKeeper: null,
        keeperTime: null,
        absence: 'null',
      }),
    ),
  }),
  loadedCase('loaded, tracking present', {}),

  // The progression, empty and populated (Requirements 8.4, 8.6).
  loadedCase('loaded, progression empty', { progression: [] }),
  loadedCase('loaded, progression populated', {}),
  // 8.7: one point draws a mark and no line, which is its own markup.
  loadedCase('loaded, progression single point', {
    progression: [POPULATED_PROGRESSION[0]],
  }),

  // The Pairwise_Sections, empty and populated (Requirements 10.1, 10.7).
  loadedCase('loaded, pairwise empty', EMPTY_PAIRWISE_OVERRIDES),
  loadedCase('loaded, pairwise populated', {}),

  // The membership facts the identity header labels (Requirements 5.2 to 5.5).
  loadedCase('loaded, guest profile', { isGuest: true }),
  loadedCase('loaded, former player', {
    displayName: ANONYMISED_PLACEHOLDER,
  }),
  loadedCase('loaded, no membership state recorded', {
    state: null,
    stateAbsence: 'missing',
  }),

  // 6.6, 7.4: no appearances at all — every figure at its empty presentation.
  loadedCase('loaded, zero appearance count', {
    ...NEVER_PLAYED_OVERRIDES,
    rating: ratingSummaryFixture({
      state: null,
      displayRating: null,
      stateAbsence: 'missing',
      displayRatingAbsence: 'missing',
      modelValues: [0, 0],
    }),
    rich: absentRichBlockFixture('missing'),
  }),
];

/**
 * The Rating_Conditions the loaded cases above actually reach, resolved through
 * `resolveRatingCondition` rather than asserted from their names.
 *
 * A suite uses this to show its own coverage is not vacuous: were a case's
 * overrides to stop producing the condition its name claims, the set below would
 * shrink and say so.
 */
export function ratingConditionsCovered(): readonly string[] {
  return [
    profileWith({}),
    profileWith({
      rating: ratingSummaryFixture({
        state: 'Provisional',
        displayRating: 1_120,
        stateAbsence: 'null',
        displayRatingAbsence: 'null',
        modelValues: [0, 0],
      }),
    }),
    profileWith(NEVER_PLAYED_OVERRIDES),
    profileWith({
      rating: ratingSummaryFixture({
        state: null,
        displayRating: null,
        stateAbsence: 'missing',
        displayRatingAbsence: 'missing',
        modelValues: [0, 0],
      }),
    }),
  ].map(
    (profile) =>
      resolveRatingCondition(profile.rating, profile.record.appearances).kind,
  );
}

/**
 * The tracking conditions the loaded cases above actually reach, resolved
 * through `resolveRichCondition`. See {@link ratingConditionsCovered}.
 */
export function trackingConditionsCovered(): readonly string[] {
  return [
    profileWith({ rich: absentRichBlockFixture('missing') }),
    profileWith({
      rich: presentRichBlockFixture(
        richStatsFixture({
          goals: null,
          cleanSheets: null,
          goalsConcededAsKeeper: null,
          keeperTime: null,
          absence: 'null',
        }),
      ),
    }),
    profileWith({}),
  ].map((profile) => resolveRichCondition(profile.rich).kind);
}
