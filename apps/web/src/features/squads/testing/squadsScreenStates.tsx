/**
 * Every rendered state of the Squads_Feature's three screens, mounted on demand
 * in either Theme — the shared fixture the cross-cutting suites of task 16 read.
 *
 * Tasks 16.1 through 16.4 all make claims about *the same set of rendered trees*:
 * the accessibility audits (16.1), the heading outlines and section order (16.2),
 * the form labelling (16.3), and keyboard reachability with the declared contrast
 * (16.4). Each of those needs the Squads_Home, the Squad_Screen, and the
 * Invite_Landing_Route in every state that materially changes the tree, in the
 * dark Theme and the light Theme. Building that set four times over would give
 * four sets that could drift apart, so it is built once here and each suite
 * iterates {@link SCREEN_STATE_CASES}.
 *
 * It follows the existing `…TestHarness` / test-fixture convention (see
 * `src/app/appRouterTestHarness.tsx` and
 * `features/app-shell/state/viewportLayoutTestHarness.ts`): a plain module that
 * the test-file glob does not match, imported only by tests, asserting nothing
 * itself beyond the guards that make a mis-built state fail loudly rather than
 * quietly audit the wrong tree.
 *
 * ### What is real, and what is replaced
 *
 * The three screens are the application's own, unmodified, mounted inside a real
 * `MemoryRouter` at their real route patterns and a real `AuthProvider`. Every
 * state below is reached the way the application reaches it: through the screens'
 * own state machines, from settled `CallResult` values, and — for the forms and
 * the confirmations — by activating the control a person would activate.
 *
 * Two seams are replaced, both outside the feature:
 *
 * - the **Squads_Api**, by {@link createStubApi}, which answers with settled
 *   `CallResult` values and refuses any call the state under test has no business
 *   making;
 * - the **Session_Manager**, by a stand-in reporting one fixed Auth_State.
 *
 * One seam has to be replaced by the *caller*: the App_Shell's
 * `usePublishSquadScopeFromRoute`, which the Squad_Screen calls and which throws
 * outside the shell's own provider — the provider is deliberately not exported
 * from the shell's barrel, and reaching past that barrel would breach the module
 * boundary the shell's structural scan enforces. `vi.mock` is hoisted per test
 * file and cannot be performed from here, so every file that renders a
 * Squad_Screen state declares this block at its top:
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
 * Appearance_Preference here, because the Theme_Provider that reads that
 * preference belongs to the App_Shell frame and to the auth subtree, not to this
 * feature — the squads screens inherit whatever the frame around them applied. So
 * the attribute is written directly, which is exactly the contract the feature's
 * `styles/squadsTokens.css` depends on.
 *
 * That the *default* is dark with nothing stored is a separate claim, and it is
 * asserted through the production bootstrap rather than restated here — see
 * {@link themeAppliedByBootstrap}.
 *
 * ### The three rating presentations
 *
 * `lib/ratingPresentation.ts` selects `unavailable` when **no** leaderboard was
 * obtained, so that presentation is a squad-wide condition rather than a per-row
 * one: no single tree can hold all three. The two player-list states below
 * therefore split them — `players` covers `rating` and `provisional` in one tree
 * (an entry present, and a member the leaderboard names nowhere), and
 * `players-unavailable` covers `unavailable` on every row.
 *
 * Requirements: 19.11, 19.12, 20.12
 */
import { act, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import { HOME_ROUTE } from '../../app-shell';
import { AuthProvider, type AuthState, type SessionManager } from '../../auth';
import {
  THEME_ATTRIBUTE,
  THEME_BOOTSTRAP_SOURCE,
  applyThemeAttribute,
  type Theme,
} from '../../../theme';
import type { CallResult, SquadsApi } from '../api/squadsApi';
import { ADMIN_SECTION_SELECTOR } from '../components/AdminSection';
import { CREATE_SQUAD_FORM_ID } from '../components/CreateSquadForm';
import { FAILURE_NOTICE_SELECTOR } from '../components/FailureNotice';
import {
  GUEST_CREATE_FORM_ID,
  GUEST_EDIT_FORM_ID,
} from '../components/GuestForm';
import { GUEST_MANAGER_ADD_SELECTOR } from '../components/GuestManager';
import {
  GENERATE_INVITE_CONTROL_SELECTOR,
  GENERATE_INVITE_FORM_ID,
  INVITE_ENTRY_SELECTOR,
  INVITE_REVOKE_SELECTOR,
} from '../components/InviteManager';
import { JOIN_SQUAD_FORM_ID } from '../components/JoinSquadForm';
import { LOADING_INDICATION_SELECTOR } from '../components/LoadingIndication';
import { NOT_FOUND_TREATMENT_SELECTOR } from '../components/NotFoundTreatment';
import { PLAYER_LIST_EMPTY_SELECTOR } from '../components/PlayerList';
import {
  PLAYER_ROW_EDIT_GUEST_SELECTOR,
  PLAYER_ROW_PROMOTE_SELECTOR,
  PLAYER_ROW_SELECTOR,
} from '../components/PlayerRow';
import { SQUAD_CARD_SELECTOR } from '../components/SquadCard';
import { SQUADS_EMPTY_STATE_SELECTOR } from '../components/SquadsEmptyState';
import { resolveAdminAuthority } from '../lib/adminAuthority';
import type { MembershipState, SquadRole } from '../lib/wireEnums';
import { ANONYMISED_PLACEHOLDER } from '../lib/playerList';
import type { FeatureFlag } from '../lib/parse/featureFlags';
import type { GeneratedInvite } from '../lib/parse/generatedInvite';
import type { InvitePreview } from '../lib/parse/invitePreview';
import type { InviteSummary } from '../lib/parse/inviteSummary';
import type { DisplayRatingLeaderboard } from '../lib/parse/leaderboard';
import type { Redemption } from '../lib/parse/redemption';
import type { SquadDetail, SquadMember } from '../lib/parse/squadDetail';
import type { SquadSummary } from '../lib/parse/squadSummary';
import {
  CREATE_SQUAD_HEADING,
  INVITE_LINK_INCOMPLETE,
  INVITE_SIGN_IN_REQUIRED_INSTRUCTION,
  INVITE_UNUSABLE,
  JOIN_SQUAD_HEADING,
  PROMOTION_CONFIRM_HEADING,
  REVOKE_INVITE_HEADING,
} from '../lib/messages';
import {
  INVITE_LANDING_ROUTE,
  PLAYER_STATS_ROUTE,
  SQUAD_ROUTE,
  inviteLandingPath,
  squadPath,
} from '../lib/routePaths';
import {
  INVITE_HANDOVER_SELECTOR,
  INVITE_LANDING_SELECTOR,
  InviteLandingScreen,
} from '../screens/InviteLandingScreen';
import { SquadScreen } from '../screens/SquadScreen';
import { SquadsHome } from '../screens/SquadsHome';

// --- The two Themes ---------------------------------------------------------

/** Both Themes, so every state below is rendered twice (Requirement 19.12). */
export const THEMES: readonly Theme[] = ['dark', 'light'];

/**
 * The selector of an open Form_Panel — the surface every form of the feature
 * renders inside, and the one place a form's `data-squads-surface` value is
 * written.
 */
export const FORM_PANEL_SELECTOR = '[data-squads-surface="form-panel"]';

/** The selector of an open Confirm_Dialog. See {@link FORM_PANEL_SELECTOR}. */
export const CONFIRM_DIALOG_SELECTOR = '[data-squads-surface="confirm-dialog"]';

/**
 * Write a Theme onto the document element, as the App_Shell's Theme_Provider and
 * the pre-paint bootstrap both do.
 *
 * Through the shared theme module's own function rather than a `setAttribute`
 * here, so the attribute name is the one declaration the stylesheets key off
 * (Requirement 18.8).
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
 * restatement of it (Requirement 19.12).
 */
export function themeAppliedByBootstrap(): string | null {
  new Function(THEME_BOOTSTRAP_SOURCE)();

  return document.documentElement.getAttribute(THEME_ATTRIBUTE);
}

// --- Identities and copy the states are built from --------------------------

/**
 * The squad every state is about. A well-formed GUID, because the Squad_Screen
 * short-circuits a malformed identity to its Not_Found_Treatment with no call
 * issued (Requirement 6.6) — which is a state of its own below.
 */
export const SQUAD_ID = '4b1c3e6a-9d2f-4a55-8b7e-1f2c3d4e5f60';

/** A second squad, so the Squads_Home renders more than one Squad_Card. */
export const OTHER_SQUAD_ID = '7c2d4f8b-1e3a-4b66-9c8f-2a3b4c5d6e71';

/** A squad identity no parser would accept (Requirement 6.6). */
export const MALFORMED_SQUAD_ID = 'not-a-squad-identity';

/** The membership the Display_Rating_Leaderboard names, so its row shows a number. */
export const RATED_MEMBERSHIP_ID = '11111111-2222-4333-8444-555555555555';

/** A membership the leaderboard names nowhere, so its row shows the band. */
export const PROVISIONAL_MEMBERSHIP_ID = '22222222-3333-4444-8555-666666666666';

/** A guest membership, which carries the guest label and the edit affordance. */
export const GUEST_MEMBERSHIP_ID = '33333333-4444-4555-8666-777777777777';

/** An inactive membership, which sorts last and renders on the muted surface. */
export const INACTIVE_MEMBERSHIP_ID = '44444444-5555-4666-8777-888888888888';

/** A membership whose display name is the Anonymised_Placeholder. */
export const FORMER_MEMBERSHIP_ID = '55555555-6666-4777-8888-999999999999';

/** The active invite the revoke confirmation is opened from. */
export const ACTIVE_INVITE_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';

/** The Invite_Secret the Invite_Landing_Route states are entered with. */
export const INVITE_SECRET = 'pitchmate-invite-secret';

/**
 * An Invite_Landing_Route path whose `code` segment carries a malformed
 * percent-escape, so the secret cannot be extracted and neither call is issued
 * (Requirement 5.9).
 */
export const INCOMPLETE_INVITE_PATH = '/join/%E0%A4%A';

/** The squad's name, which the Squad_Screen renders as its one `h1`. */
export const SQUAD_NAME = 'Thursday Ballers';

/** The other squad's name, so the two cards differ in more than identity. */
export const OTHER_SQUAD_NAME = 'Sunday Sliders';

/**
 * The anonymous preview's own instruction, which names no squad.
 *
 * Deliberately unlike the screen's own fixed instruction, so "the preview settled"
 * cannot be confused with "the preview was never issued" (Requirement 5.2).
 */
export const INVITE_PREVIEW_MESSAGE =
  'This invite needs an account before it can be used.';

// --- Fixture values ---------------------------------------------------------

/** A Squad_Summary, defaulted to the fixture squad and overridable. */
export function squadSummary(overrides: Partial<SquadSummary> = {}): SquadSummary {
  return {
    squadId: SQUAD_ID,
    name: SQUAD_NAME,
    role: 'Member',
    state: 'Active',
    ...overrides,
  };
}

/**
 * A Squad_Member, defaulted to an ordinary active member with an established
 * rating and a handful of appearances.
 *
 * The two standing fields are carried so the fixture is a complete
 * `SquadMember`; no state in this module presents them, because telling
 * never-played apart from provisional is later work.
 */
export function squadMember(overrides: Partial<SquadMember> = {}): SquadMember {
  return {
    membershipId: RATED_MEMBERSHIP_ID,
    displayName: 'Ada',
    role: 'Member',
    state: 'Active',
    isGuest: false,
    appearances: 12,
    ratingState: 'Established',
    ...overrides,
  };
}

/**
 * The member collection every player-list state renders, covering each membership
 * fact a row states in text (Requirements 7.5–7.9):
 *
 * | Member | What it exercises |
 * | --- | --- |
 * | `Ada` | a rated active member, promotable under Admin_Authority |
 * | `Grace` | a member the leaderboard names nowhere — the Provisional_Band |
 * | `Dave` | a guest: the guest label, and the edit affordance under authority |
 * | `Kay` | an inactive membership: the state label and the muted row |
 * | the placeholder | a Former_Player: navigable, and offered no admin action |
 */
export const PLAYER_LIST_MEMBERS: readonly SquadMember[] = [
  squadMember(),
  squadMember({
    membershipId: PROVISIONAL_MEMBERSHIP_ID,
    displayName: 'Grace',
    appearances: 2,
    ratingState: 'Provisional',
  }),
  squadMember({
    membershipId: GUEST_MEMBERSHIP_ID,
    displayName: 'Dave',
    role: null,
    isGuest: true,
  }),
  squadMember({
    membershipId: INACTIVE_MEMBERSHIP_ID,
    displayName: 'Kay',
    state: 'Inactive',
  }),
  squadMember({
    membershipId: FORMER_MEMBERSHIP_ID,
    displayName: ANONYMISED_PLACEHOLDER,
    appearances: 0,
    ratingState: null,
  }),
];

/** The one optional capability the Generated_Enum_Union names (Req 14.1). */
export const FEATURE_FLAGS: readonly FeatureFlag[] = [
  { feature: 'LiveMatchTracking', isEnabled: true },
];

/** A Squad_Detail, defaulted to the fixture squad with the full member list. */
export function squadDetail(overrides: Partial<SquadDetail> = {}): SquadDetail {
  return {
    squadId: SQUAD_ID,
    name: SQUAD_NAME,
    members: PLAYER_LIST_MEMBERS,
    features: FEATURE_FLAGS,
    ...overrides,
  };
}

/**
 * A leaderboard naming two of the five memberships.
 *
 * The three it does not name render the Provisional_Band, so one tree carries
 * both of the presentations a held leaderboard can produce (Requirement 8.3).
 */
export function displayRatingLeaderboard(): DisplayRatingLeaderboard {
  return {
    entries: [
      { membershipId: RATED_MEMBERSHIP_ID, displayName: 'Ada', value: 1204 },
      { membershipId: INACTIVE_MEMBERSHIP_ID, displayName: 'Kay', value: 988 },
    ],
  };
}

/** A fixed instant, so every rendered invite instant is deterministic. */
const FIXED_INSTANT_MS = Date.UTC(2026, 0, 15, 12, 0, 0);

/**
 * One invite per Invite_State, plus a non-expiring one — so the listing renders
 * the state label, both instants, the does-not-expire label, and a revoke control
 * on exactly the active entries (Requirements 11.2, 11.9).
 */
export const INVITE_SUMMARIES: readonly InviteSummary[] = [
  {
    inviteId: ACTIVE_INVITE_ID,
    state: 'Active',
    createdAtMs: FIXED_INSTANT_MS,
    createdBy: 'Ada',
    expiresAtMs: FIXED_INSTANT_MS + 7 * 24 * 60 * 60 * 1000,
  },
  {
    inviteId: '77777777-8888-4999-8aaa-bbbbbbbbbbbb',
    state: 'Active',
    createdAtMs: FIXED_INSTANT_MS - 60_000,
    createdBy: null,
    expiresAtMs: null,
  },
  {
    inviteId: '88888888-9999-4aaa-8bbb-cccccccccccc',
    state: 'Revoked',
    createdAtMs: FIXED_INSTANT_MS - 120_000,
    createdBy: 'Ada',
    expiresAtMs: FIXED_INSTANT_MS,
  },
  {
    inviteId: '99999999-aaaa-4bbb-8ccc-dddddddddddd',
    state: 'Expired',
    createdAtMs: FIXED_INSTANT_MS - 180_000,
    createdBy: 'Ada',
    expiresAtMs: FIXED_INSTANT_MS - 60_000,
  },
];

/** The anonymous `PreviewInvite` value, which names no squad (Req 5.3). */
export const INVITE_PREVIEW: InvitePreview = {
  requiresAuthentication: true,
  message: INVITE_PREVIEW_MESSAGE,
};

// --- The stubbed seams ------------------------------------------------------

/** A promise that never settles — the awaiting-first-response state. */
export function pendingCall<T>(): Promise<CallResult<T>> {
  return new Promise<CallResult<T>>(() => undefined);
}

/** A Squads_Api method the state under test must not reach. */
function unavailable(method: string): () => never {
  return () => {
    throw new Error(`${method} must not be called in this rendered state`);
  };
}

/** What each read the states below depend on answers. */
export interface StubApiOptions {
  readonly summaries?:
    | CallResult<readonly SquadSummary[]>
    | Promise<CallResult<readonly SquadSummary[]>>;
  readonly detail?: CallResult<SquadDetail> | Promise<CallResult<SquadDetail>>;
  readonly leaderboard?:
    | CallResult<DisplayRatingLeaderboard>
    | Promise<CallResult<DisplayRatingLeaderboard>>;
  readonly invites?:
    | CallResult<readonly InviteSummary[]>
    | Promise<CallResult<readonly InviteSummary[]>>;
  readonly preview?: CallResult<InvitePreview> | Promise<CallResult<InvitePreview>>;
  readonly redemption?: CallResult<Redemption> | Promise<CallResult<Redemption>>;
}

/**
 * A Squads_Api answering the reads a rendered state needs and refusing the rest.
 *
 * Every **mutation** returns a promise that never settles rather than throwing:
 * these states open forms and confirmations without submitting them, and a
 * never-settling call keeps the pending surface rendered instead of turning a
 * stray activation into an unrelated failure. A read the state did not ask for
 * throws, so a state built wrongly fails loudly rather than auditing a surface
 * nobody described.
 */
export function createStubApi(options: StubApiOptions = {}): SquadsApi {
  const answer = <T,>(
    supplied: CallResult<T> | Promise<CallResult<T>> | undefined,
    method: string,
  ): Promise<CallResult<T>> => {
    if (supplied === undefined) {
      return unavailable(method)();
    }

    return Promise.resolve(supplied);
  };

  return {
    listMySquads: () => answer(options.summaries, 'listMySquads'),
    getSquad: () => answer(options.detail, 'getSquad'),
    getDisplayRatingLeaderboard: () =>
      answer(options.leaderboard, 'getDisplayRatingLeaderboard'),
    listInvites: () => answer(options.invites, 'listInvites'),
    previewInvite: () => answer(options.preview, 'previewInvite'),
    redeemInvite: () => answer(options.redemption, 'redeemInvite'),
    getFeatureFlags: unavailable('getFeatureFlags'),
    createSquad: () => pendingCall<never>(),
    generateInvite: () => pendingCall<GeneratedInvite>(),
    revokeInvite: () => pendingCall<void>(),
    createGuest: () => pendingCall<never>(),
    editGuest: () => pendingCall<void>(),
    promoteToAdmin: () => pendingCall<void>(),
    setFeatureFlag: () => pendingCall<void>(),
  } as SquadsApi;
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
 * Let the mount effects issue their calls and the settled outcomes commit.
 *
 * Two macrotasks: the first runs the mount effect that issues a call, the second
 * applies the update its resolved outcome dispatches.
 */
async function settle(): Promise<void> {
  await tick();
  await tick();
}

/** Fail with the state's name rather than with an empty-tree assertion later. */
function requireRendered(selector: string, state: string): void {
  if (document.querySelector(selector) === null) {
    throw new Error(`the ${state} state did not render ${selector}`);
  }
}

/** Fail where a state rendered something it is defined by *not* rendering. */
function requireAbsent(selector: string, state: string): void {
  if (document.querySelector(selector) !== null) {
    throw new Error(`the ${state} state unexpectedly rendered ${selector}`);
  }
}

/**
 * Fail unless one of the surfaces matching `selector` states `heading`.
 *
 * Which surface opened matters: every confirmation of the feature renders through
 * the one `ConfirmDialog`, so "a dialog is open" would be satisfied by the wrong
 * one. The heading is read from `lib/messages.ts` rather than restated, so this
 * guard cannot drift from the copy.
 */
function requireSurfaceHeaded(
  selector: string,
  heading: string,
  state: string,
): void {
  const surfaces = Array.from(document.querySelectorAll(selector));

  if (!surfaces.some((surface) => surface.textContent?.includes(heading))) {
    throw new Error(`no ${state} surface headed "${heading}" was rendered`);
  }
}

/** Mount a tree with the Theme applied first, and hand back the container. */
function mount(theme: Theme, tree: ReactElement): RenderedScreen {
  applyTheme(theme);
  const user = userEvent.setup();
  const { container } = render(tree);

  return { container, user };
}

// --- The Squads_Home --------------------------------------------------------

/** The Squads_Home load states that materially change the tree. */
export type SquadsHomeStateName = 'loading' | 'listed' | 'empty' | 'failed';

/**
 * Render the Squads_Home in one load state.
 *
 * The screen navigates with `useNavigate`, so it is mounted at the App_Shell's own
 * `HOME_ROUTE` with the Squad_Route registered beside it — the arrangement a
 * Squad_Card activation resolves through.
 */
export async function renderSquadsHomeState(
  state: SquadsHomeStateName,
  theme: Theme = 'dark',
): Promise<RenderedScreen> {
  const summaries: StubApiOptions['summaries'] =
    state === 'loading'
      ? pendingCall<readonly SquadSummary[]>()
      : state === 'failed'
        ? { kind: 'transport-failure' }
        : {
            kind: 'success',
            value:
              state === 'empty'
                ? []
                : [
                    squadSummary({ role: 'Owner' }),
                    squadSummary({
                      squadId: OTHER_SQUAD_ID,
                      name: OTHER_SQUAD_NAME,
                      role: null,
                      state: null,
                    }),
                  ],
          };

  const api = createStubApi({ summaries });

  const rendered = mount(
    theme,
    <AuthProvider manager={sessionManagerReporting('authenticated')}>
      <MemoryRouter initialEntries={[HOME_ROUTE]}>
        <Routes>
          <Route path={HOME_ROUTE} element={<SquadsHome api={api} />} />
          <Route path={SQUAD_ROUTE} element={<p>a squad</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );

  await settle();

  const name = `Squads_Home ${state}`;
  if (state === 'loading') {
    requireRendered(LOADING_INDICATION_SELECTOR, name);
  } else if (state === 'failed') {
    requireRendered(FAILURE_NOTICE_SELECTOR, name);
  } else if (state === 'empty') {
    requireRendered(SQUADS_EMPTY_STATE_SELECTOR, name);
  } else {
    await waitFor(() => {
      requireRendered(SQUAD_CARD_SELECTOR, name);
    });
  }

  return rendered;
}

/** Open the Create_Squad_Form from its entry point (Requirement 3.1). */
export async function openCreateSquadForm(
  rendered: RenderedScreen,
): Promise<void> {
  await rendered.user.click(
    await findControlNamed(rendered.container, CREATE_SQUAD_HEADING),
  );
  requireRendered(`#${CREATE_SQUAD_FORM_ID}`, 'Create_Squad_Form');
}

/** Open the Join_Code_Form from its entry point (Requirement 4.1). */
export async function openJoinCodeForm(rendered: RenderedScreen): Promise<void> {
  await rendered.user.click(
    await findControlNamed(rendered.container, JOIN_SQUAD_HEADING),
  );
  requireRendered(`#${JOIN_SQUAD_FORM_ID}`, 'Join_Code_Form');
}

/** The one `<button>` of `container` whose text is exactly `label`. */
async function findControlNamed(
  container: HTMLElement,
  label: string,
): Promise<HTMLElement> {
  const matches = Array.from(container.querySelectorAll('button')).filter(
    (control) => control.textContent?.trim() === label,
  );

  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one control named "${label}", found ${matches.length}`,
    );
  }

  return matches[0];
}

// --- The Squad_Screen -------------------------------------------------------

/** The Squad_Screen states that materially change the tree. */
export type SquadScreenStateName =
  | 'loading'
  | 'failed'
  | 'not-found'
  | 'players'
  | 'players-unavailable'
  | 'admin';

/**
 * The caller's own standing in the open squad, as the `ListMySquads` summary
 * carries it — the whole of `resolveAdminAuthority`'s input (Requirement 6.10).
 */
export interface CallerStanding {
  readonly role: SquadRole | null;
  readonly state: MembershipState | null;
}

/**
 * What a caller may vary about a Squad_Screen state beyond the state itself.
 *
 * Both dimensions exist because a claim is made *over* them rather than about one
 * chosen value: Property 43 quantifies over every resolved authority value and
 * every injected-content combination, so neither can be a constant of the
 * fixture. Omitting them leaves the states exactly as they were — an active
 * `Member`, or an active `Owner` for the `admin` state, and no injected content.
 */
export interface SquadScreenStateOverrides {
  /**
   * The caller's Member_Role and Membership_State, which is what
   * {@link resolveAdminAuthority} answers from and therefore what decides whether
   * the Admin_Section is mounted at all (Requirements 6.10, 10.2).
   */
  readonly caller?: CallerStanding;

  /** The matches Placeholder_Section's injected body (Requirement 15.3). */
  readonly matchesContent?: ReactNode;

  /** The stats Placeholder_Section's injected body (Requirement 15.3). */
  readonly statsContent?: ReactNode;
}

/**
 * Render the Squad_Screen in one state, at its real route.
 *
 * The caller's own standing comes from the `ListMySquads` summary the way the
 * screen resolves it (Requirement 6.10): a `Member` for the states that are about
 * the squad itself, and an `Owner` for the `admin` state, which is what makes the
 * Admin_Section render at all. A caller supplying
 * {@link SquadScreenStateOverrides.caller} replaces that default, and whether the
 * Admin_Section is expected is then `resolveAdminAuthority`'s answer rather than
 * the state's name — including the invite listing, which only an
 * authority-holding caller may ask for (Requirements 10.4, 14.2).
 *
 * The `not-found` state is reached through a **malformed** `squadId`, so it also
 * pins that no call is issued for one — the requirement's own case (6.6).
 */
export async function renderSquadScreenState(
  state: SquadScreenStateName,
  theme: Theme = 'dark',
  overrides: SquadScreenStateOverrides = {},
): Promise<RenderedScreen> {
  const caller: CallerStanding =
    overrides.caller ??
    ({ role: state === 'admin' ? 'Owner' : 'Member', state: 'Active' } as const);

  // 10.2: whether the admin surface is mounted is the pure predicate's answer for
  // this caller, never a restatement of which combinations hold.
  const authority = resolveAdminAuthority(caller.role, caller.state);

  const detail: StubApiOptions['detail'] =
    state === 'loading'
      ? pendingCall<SquadDetail>()
      : state === 'failed'
        ? { kind: 'transport-failure' }
        : { kind: 'success', value: squadDetail() };

  const leaderboard: StubApiOptions['leaderboard'] =
    state === 'loading'
      ? pendingCall<DisplayRatingLeaderboard>()
      : state === 'players-unavailable'
        ? { kind: 'transport-failure' }
        : { kind: 'success', value: displayRatingLeaderboard() };

  const api = createStubApi({
    summaries: {
      kind: 'success',
      value: [squadSummary({ role: caller.role, state: caller.state })],
    },
    detail,
    leaderboard,
    // 14.2: only a caller holding Admin_Authority mounts the surface that lists
    // invites, so every other state refuses the call.
    ...(authority ? { invites: { kind: 'success', value: INVITE_SUMMARIES } } : {}),
  });

  const requested = state === 'not-found' ? MALFORMED_SQUAD_ID : SQUAD_ID;

  // 15.3: an omitted body is passed as an omitted prop rather than as an explicit
  // `undefined`, so an absent slot is absent in the way the application's own
  // route factory leaves it.
  const content = {
    ...(overrides.matchesContent === undefined
      ? {}
      : { matchesContent: overrides.matchesContent }),
    ...(overrides.statsContent === undefined
      ? {}
      : { statsContent: overrides.statsContent }),
  };

  const rendered = mount(
    theme,
    <AuthProvider manager={sessionManagerReporting('authenticated')}>
      <MemoryRouter initialEntries={[squadPath(requested)]}>
        <Routes>
          <Route
            path={SQUAD_ROUTE}
            element={<SquadScreen api={api} {...content} />}
          />
          <Route path={PLAYER_STATS_ROUTE} element={<p>player stats</p>} />
          <Route path={HOME_ROUTE} element={<p>your squads</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );

  await settle();

  const name = `Squad_Screen ${state}`;
  if (state === 'loading') {
    requireRendered(LOADING_INDICATION_SELECTOR, name);
    requireAbsent(PLAYER_ROW_SELECTOR, name);
  } else if (state === 'failed') {
    requireRendered(FAILURE_NOTICE_SELECTOR, name);
    requireAbsent(NOT_FOUND_TREATMENT_SELECTOR, name);
  } else if (state === 'not-found') {
    requireRendered(NOT_FOUND_TREATMENT_SELECTOR, name);
  } else {
    await waitFor(() => {
      requireRendered(PLAYER_ROW_SELECTOR, name);
      requireAbsent(PLAYER_LIST_EMPTY_SELECTOR, name);
    });

    if (authority) {
      await waitFor(() => {
        requireRendered(ADMIN_SECTION_SELECTOR, name);
        requireRendered(INVITE_ENTRY_SELECTOR, name);
      });
    } else {
      requireAbsent(ADMIN_SECTION_SELECTOR, name);
    }
  }

  return rendered;
}

/** Activate the one control matching `selector`, failing where there is none. */
async function activate(
  rendered: RenderedScreen,
  selector: string,
  what: string,
): Promise<void> {
  const control = rendered.container.querySelector(selector);

  if (!(control instanceof HTMLElement)) {
    throw new Error(`no ${what} control was rendered (${selector})`);
  }

  await rendered.user.click(control);
}

/** Open the Guest_Form in `create` mode (Requirement 12.1). */
export async function openGuestCreateForm(
  rendered: RenderedScreen,
): Promise<void> {
  await activate(rendered, GUEST_MANAGER_ADD_SELECTOR, 'add guest');
  requireRendered(`#${GUEST_CREATE_FORM_ID}`, 'Guest_Form for creation');
}

/** Open the Guest_Form in `edit` mode from a guest's row (Req 12.7, 12.8). */
export async function openGuestEditForm(
  rendered: RenderedScreen,
): Promise<void> {
  await activate(rendered, PLAYER_ROW_EDIT_GUEST_SELECTOR, 'guest edit');
  requireRendered(`#${GUEST_EDIT_FORM_ID}`, 'Guest_Form for an edit');
}

/** Open the invite generator (Requirement 11.5). */
export async function openGenerateInviteForm(
  rendered: RenderedScreen,
): Promise<void> {
  await activate(rendered, GENERATE_INVITE_CONTROL_SELECTOR, 'generate invite');
  requireRendered(`#${GENERATE_INVITE_FORM_ID}`, 'invite generator');
}

/** Open the revoke confirmation from an active invite (Requirement 11.10). */
export async function openRevokeConfirmation(
  rendered: RenderedScreen,
): Promise<void> {
  await activate(rendered, INVITE_REVOKE_SELECTOR, 'revoke');
  requireSurfaceHeaded(
    CONFIRM_DIALOG_SELECTOR,
    REVOKE_INVITE_HEADING,
    'revoke confirmation',
  );
}

/** Open the promotion confirmation from an eligible row (Requirement 13.4). */
export async function openPromotionConfirmation(
  rendered: RenderedScreen,
): Promise<void> {
  await activate(rendered, PLAYER_ROW_PROMOTE_SELECTOR, 'promotion');
  requireSurfaceHeaded(
    CONFIRM_DIALOG_SELECTOR,
    PROMOTION_CONFIRM_HEADING,
    'promotion confirmation',
  );
}

// --- The Invite_Landing_Route ------------------------------------------------

/** The Invite_Landing_Route states that materially change the tree. */
export type InviteLandingStateName =
  | 'handover'
  | 'handover-after-failed-preview'
  | 'redeeming'
  | 'unusable'
  | 'failed'
  | 'incomplete-link';

/**
 * Render the Invite_Landing_Route in one state, at its real route.
 *
 * The Auth_State decides which call is owed, so the handover states are rendered
 * with no session and the redemption states with one (Requirements 5.2, 5.7). The
 * incomplete-link path resolves through a wildcard route as well as the real
 * pattern, so a path the pattern cannot match still renders and is asserted on
 * rather than silently dropped by the router.
 */
export async function renderInviteLandingState(
  state: InviteLandingStateName,
  theme: Theme = 'dark',
): Promise<RenderedScreen> {
  const signedOut =
    state === 'handover' || state === 'handover-after-failed-preview';

  const preview: StubApiOptions['preview'] =
    state === 'handover'
      ? { kind: 'success', value: INVITE_PREVIEW }
      : { kind: 'transport-failure' };

  const redemption: StubApiOptions['redemption'] =
    state === 'redeeming'
      ? pendingCall<Redemption>()
      : state === 'unusable'
        ? { kind: 'rejected-input', reason: 'invite-unusable' }
        : { kind: 'transport-failure' };

  const api = createStubApi({ preview, redemption });

  const requested =
    state === 'incomplete-link'
      ? INCOMPLETE_INVITE_PATH
      : inviteLandingPath(INVITE_SECRET);

  const screen = <InviteLandingScreen api={api} />;

  const rendered = mount(
    theme,
    <AuthProvider
      manager={sessionManagerReporting(
        signedOut ? 'unauthenticated' : 'authenticated',
      )}
    >
      <MemoryRouter initialEntries={[requested]}>
        <Routes>
          <Route path={INVITE_LANDING_ROUTE} element={screen} />
          <Route path={HOME_ROUTE} element={<p>your squads</p>} />
          <Route path="*" element={screen} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );

  await settle();

  // Each of the five surfaces is mutually exclusive of the others, so the state is
  // confirmed by what it renders rather than assumed from what it asked for — an
  // audit of the wrong surface would otherwise pass and prove nothing.
  const name = `Invite_Landing_Route ${state}`;
  const surface = rendered.container.querySelector(INVITE_LANDING_SELECTOR);
  const text = surface?.textContent ?? '';

  const requireStated = (statement: string): void => {
    if (!text.includes(statement)) {
      throw new Error(`the ${name} state did not state "${statement}"`);
    }
  };

  if (state === 'handover') {
    requireRendered(INVITE_HANDOVER_SELECTOR, name);
    // The preview's own wording, so "the preview settled" is distinguishable from
    // "the preview was never issued" (Requirement 5.2).
    requireStated(INVITE_PREVIEW_MESSAGE);
  } else if (state === 'handover-after-failed-preview') {
    requireRendered(INVITE_HANDOVER_SELECTOR, name);
    // 5.6: the fixed instruction stays, and the handover is not blocked.
    requireStated(INVITE_SIGN_IN_REQUIRED_INSTRUCTION);
  } else if (state === 'redeeming') {
    requireRendered(LOADING_INDICATION_SELECTOR, name);
    requireAbsent(INVITE_HANDOVER_SELECTOR, name);
  } else if (state === 'unusable') {
    requireStated(INVITE_UNUSABLE);
    requireAbsent(FAILURE_NOTICE_SELECTOR, name);
  } else if (state === 'failed') {
    requireRendered(FAILURE_NOTICE_SELECTOR, name);
  } else {
    requireStated(INVITE_LINK_INCOMPLETE);
    requireAbsent(INVITE_HANDOVER_SELECTOR, name);
  }

  return rendered;
}

// --- The whole set ----------------------------------------------------------

/** One rendered state, named, and mountable in either Theme. */
export interface ScreenStateCase {
  /** How the state is named in a test's own reporting. */
  readonly name: string;
  /** Mount it in `theme`, settled and ready to be read. */
  readonly render: (theme: Theme) => Promise<RenderedScreen>;
}

/**
 * Every state of the three screens that materially changes the rendered tree.
 *
 * The set tasks 16.1 through 16.4 each iterate: the four Squads_Home load states
 * and its two forms, the Squad_Screen's four `detail` states plus the two
 * leaderboard treatments and the Admin_Section, the three admin forms and the two
 * confirmations, and the Invite_Landing_Route's five surfaces.
 */
export const SCREEN_STATE_CASES: readonly ScreenStateCase[] = [
  {
    name: 'the Squads_Home awaiting the first response',
    render: (theme) => renderSquadsHomeState('loading', theme),
  },
  {
    name: 'the Squads_Home with Squad_Cards',
    render: (theme) => renderSquadsHomeState('listed', theme),
  },
  {
    name: 'the Squads_Empty_State',
    render: (theme) => renderSquadsHomeState('empty', theme),
  },
  {
    name: 'the Squads_Home failure',
    render: (theme) => renderSquadsHomeState('failed', theme),
  },
  {
    name: 'the Squads_Home with the Create_Squad_Form open',
    render: async (theme) => {
      const rendered = await renderSquadsHomeState('listed', theme);
      await openCreateSquadForm(rendered);
      return rendered;
    },
  },
  {
    name: 'the Squads_Home with the Join_Code_Form open',
    render: async (theme) => {
      const rendered = await renderSquadsHomeState('listed', theme);
      await openJoinCodeForm(rendered);
      return rendered;
    },
  },
  {
    name: 'the Squad_Screen awaiting the first response',
    render: (theme) => renderSquadScreenState('loading', theme),
  },
  {
    name: 'the Squad_Screen failure',
    render: (theme) => renderSquadScreenState('failed', theme),
  },
  {
    name: 'the Not_Found_Treatment',
    render: (theme) => renderSquadScreenState('not-found', theme),
  },
  {
    name: 'the Player_List with ratings and Provisional_Bands',
    render: (theme) => renderSquadScreenState('players', theme),
  },
  {
    name: 'the Player_List with ratings unavailable',
    render: (theme) => renderSquadScreenState('players-unavailable', theme),
  },
  {
    name: 'the Admin_Section',
    render: (theme) => renderSquadScreenState('admin', theme),
  },
  {
    name: 'the Guest_Form open for creation',
    render: async (theme) => {
      const rendered = await renderSquadScreenState('admin', theme);
      await openGuestCreateForm(rendered);
      return rendered;
    },
  },
  {
    name: 'the Guest_Form open for an edit',
    render: async (theme) => {
      const rendered = await renderSquadScreenState('admin', theme);
      await openGuestEditForm(rendered);
      return rendered;
    },
  },
  {
    name: 'the invite generator open',
    render: async (theme) => {
      const rendered = await renderSquadScreenState('admin', theme);
      await openGenerateInviteForm(rendered);
      return rendered;
    },
  },
  {
    name: 'the revoke confirmation open',
    render: async (theme) => {
      const rendered = await renderSquadScreenState('admin', theme);
      await openRevokeConfirmation(rendered);
      return rendered;
    },
  },
  {
    name: 'the promotion confirmation open',
    render: async (theme) => {
      const rendered = await renderSquadScreenState('admin', theme);
      await openPromotionConfirmation(rendered);
      return rendered;
    },
  },
  {
    name: 'the Invite_Landing_Route handover',
    render: (theme) => renderInviteLandingState('handover', theme),
  },
  {
    name: 'the Invite_Landing_Route handover after a failed preview',
    render: (theme) =>
      renderInviteLandingState('handover-after-failed-preview', theme),
  },
  {
    name: 'the Invite_Landing_Route redeeming',
    render: (theme) => renderInviteLandingState('redeeming', theme),
  },
  {
    name: 'the Invite_Landing_Route unusable invite',
    render: (theme) => renderInviteLandingState('unusable', theme),
  },
  {
    name: 'the Invite_Landing_Route failure',
    render: (theme) => renderInviteLandingState('failed', theme),
  },
  {
    name: 'the Invite_Landing_Route incomplete link',
    render: (theme) => renderInviteLandingState('incomplete-link', theme),
  },
];
