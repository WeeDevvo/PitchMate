/**
 * Property test for the Squad_Screen's admin surface and the calls behind it
 * (task 13.4).
 *
 * **Property 26: Admin affordances and admin calls exist exactly while authority
 * holds.** *For any* resolved authority value, the Admin_Section with its invite
 * manager, guest manager, and feature toggles is rendered exactly when authority
 * holds and the promotion control is rendered exactly on eligible rows; while
 * authority does not hold no admin section, invite manager, guest manager,
 * feature toggle, or promotion control is rendered, the squad detail, player
 * list, and placeholder sections are rendered unchanged, and *for any* sequence
 * of interactions with the rendered surface no `ListInvites`, `GenerateInvite`,
 * `RevokeInvite`, `CreateGuest`, `EditGuest`, `PromoteToAdmin`, or
 * `SetFeatureFlag` call is issued.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | 10.2 — the admin section and its three surfaces exist while authority holds | {@link expectAdminSurfaceRendered} |
 * | 10.2 — the promotion control sits on exactly the eligible rows | {@link expectRowControlsMatchEligibility} |
 * | 10.3 — nothing admin is rendered while authority does not hold | {@link expectNoAdminSurface} |
 * | 10.3 — the detail, the player list, and the placeholders are unchanged | {@link describeNonAdminSurface}, compared against an authority-holding render |
 * | 10.4 — no admin call from any interaction sequence | the second property below |
 *
 * ### Authority is driven through the one place the screen resolves it from
 *
 * The caller's Member_Role and Membership_State reach this screen through the
 * `ListMySquads` summary for the open squad — a `GetSquad` body carries a squad's
 * memberships but identifies none of them as the caller's (Requirement 6.10). So
 * the property quantifies over the summary's `role` × `state`, which is the whole
 * of `resolveAdminAuthority`'s input: four roles (owner, admin, member, absent)
 * against three states (active, inactive, absent), of which exactly two
 * combinations hold authority. The expected value is taken from
 * `resolveAdminAuthority` itself rather than restated, because *which*
 * combinations hold is Property 25's claim over that pure function; what is
 * claimed here is that the rendered surface follows it.
 *
 * ### "Unchanged" is asserted as a comparison, not as a list of expectations
 *
 * A render whose caller holds no authority is compared against a render of the
 * *same* squad whose caller is an active owner, over a descriptor that
 * deliberately excludes the admin affordances: the level-one heading, the
 * level-two section headings, every Player_Row's name, stats path, membership
 * labels and rating text, and the two placeholder statements. Equality of that
 * descriptor is what Requirement 10.3's "unchanged" means, and stating it as a
 * comparison means no future addition to the non-admin surface can quietly fall
 * outside the claim.
 *
 * The caller's own role label is *excluded* from the descriptor, because
 * Requirement 6.3 has it name the caller's role and it therefore must differ
 * between the two renders.
 *
 * ### The interactions are generated against whatever is on screen
 *
 * The second property clicks and keys the rendered surface at generated indices
 * rather than at named controls, so it makes no assumption about which controls a
 * non-admin surface offers — a control added later is exercised without this file
 * changing. Every method of the Squads_Api is recorded, so a forbidden call is
 * caught wherever it came from rather than only where a spy was placed.
 *
 * Two seams are supplied and one is replaced, exactly as the worked-example file
 * does it: a `SquadsApi` answering with settled `CallResult` values, a
 * `SessionManager` reporting `authenticated`, and the App_Shell's
 * `usePublishSquadScopeFromRoute` — which throws outside the shell's own provider
 * — replaced by an inert stand-in so the screen can be rendered on its own.
 *
 * Feature: web-squads-screens, Property 26: Admin affordances and admin calls exist exactly while authority holds
 * Validates: Requirements 10.2, 10.3, 10.4
 */
import { type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import fc from 'fast-check';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AuthProvider, type SessionManager } from '../../auth';
import type { CallResult, SquadsApi } from '../api/squadsApi';
import {
  ADMIN_SECTION_SELECTOR,
  ADMIN_SUBSECTION_ATTRIBUTE,
  ADMIN_SUBSECTION_SELECTOR,
} from '../components/AdminSection';
import { FAILURE_NOTICE_SELECTOR } from '../components/FailureNotice';
import {
  FEATURE_TOGGLE_SELECTOR,
  FEATURE_TOGGLES_SELECTOR,
} from '../components/FeatureToggles';
import { GUEST_MANAGER_ADD_SELECTOR } from '../components/GuestManager';
import {
  GENERATE_INVITE_CONTROL_SELECTOR,
  INVITE_MANAGER_SELECTOR,
} from '../components/InviteManager';
import { MEMBERSHIP_LABEL_SELECTOR } from '../components/MembershipLabels';
import { NOT_FOUND_TREATMENT_SELECTOR } from '../components/NotFoundTreatment';
import {
  PLAYER_LIST_EMPTY_SELECTOR,
  PLAYER_LIST_SELECTOR,
} from '../components/PlayerList';
import {
  PLAYER_ROW_EDIT_GUEST_SELECTOR,
  PLAYER_ROW_MEMBERSHIP_ID_ATTRIBUTE,
  PLAYER_ROW_OPEN_SELECTOR,
  PLAYER_ROW_PROMOTE_SELECTOR,
  PLAYER_ROW_SELECTOR,
  PLAYER_ROW_STATS_PATH_ATTRIBUTE,
} from '../components/PlayerRow';
import { PROMOTION_CONTROL_SELECTOR } from '../components/PromotionControl';
import { RATING_BADGE_SELECTOR } from '../components/RatingBadge';
import { resolveAdminAuthority } from '../lib/adminAuthority';
import type { MemberRole, MembershipStateValue } from '../lib/enumCodes';
import {
  ADMIN_SECTION_HEADING,
  MATCHES_PLACEHOLDER_STATEMENT,
  MATCHES_SECTION_HEADING,
  PLAYERS_SECTION_HEADING,
  SQUAD_DETAIL_SECTION_HEADING,
  STATS_PLACEHOLDER_STATEMENT,
  STATS_SECTION_HEADING,
} from '../lib/messages';
import type { FeatureFlag } from '../lib/parse/featureFlags';
import type { SquadDetail, SquadMember } from '../lib/parse/squadDetail';
import type { SquadSummary } from '../lib/parse/squadSummary';
import { ANONYMISED_PLACEHOLDER, isGuestEditable } from '../lib/playerList';
import { isPromotable } from '../lib/promotionEligibility';
import { PLAYER_STATS_ROUTE, SQUAD_ROUTE, squadPath } from '../lib/routePaths';
import { SQUAD_DETAIL_SECTION_SELECTOR, SquadScreen } from './SquadScreen';

// --- The App_Shell seam -------------------------------------------------------

/**
 * `usePublishSquadScopeFromRoute` reads the shell's publish context and throws
 * where none is above it, which is correct for the application — the Squad_Route
 * is a child of the shell's `/app` layout route — and unusable for a screen
 * rendered on its own. Only that one export is replaced; the parameter name and
 * every other export stay the shell's own. What it publishes is not this
 * property's subject, so the stand-in counts nothing.
 */
vi.mock('../../app-shell', async () => {
  const actual =
    await vi.importActual<typeof import('../../app-shell')>('../../app-shell');

  return { ...actual, usePublishSquadScopeFromRoute: () => null };
});

// --- Fixtures -----------------------------------------------------------------

const SQUAD_ID = '4b1c3e6a-9d2f-4a55-8b7e-1f2c3d4e5f60';
const SQUAD_NAME = 'Thursday Ballers';

/** The caller's own standing, as the `ListMySquads` summary carries it. */
interface CallerStanding {
  readonly role: MemberRole | null;
  readonly state: MembershipStateValue | null;
}

/** An active owner — the authority-holding reference the comparison uses. */
const AUTHORITY_HOLDER: CallerStanding = { role: 'owner', state: 'active' };

// --- Generators ---------------------------------------------------------------

/**
 * Every value the caller's standing can take: the four Member_Roles including
 * absence, against the three Membership_States including absence. Twelve
 * combinations, of which `resolveAdminAuthority` accepts exactly two — so the
 * property is effectively exhaustive over its own quantifier.
 */
const callerStandingArb: fc.Arbitrary<CallerStanding> = fc.record({
  role: fc.constantFrom<MemberRole | null>('owner', 'admin', 'member', null),
  state: fc.constantFrom<MembershipStateValue | null>('active', 'inactive', null),
});

/** The ten combinations that hold no Admin_Authority (Requirements 10.3, 10.4). */
const withoutAuthorityArb: fc.Arbitrary<CallerStanding> = callerStandingArb.filter(
  (standing) => !resolveAdminAuthority(standing.role, standing.state),
);

/**
 * Player_Display_Names drawn from a small pool that includes the
 * Anonymised_Placeholder and a near-miss of it, so the promotion and guest-edit
 * eligibility of a Former_Player row is exercised rather than reached by
 * accident (Requirements 7.9, 12.7, 13.1).
 */
const MEMBER_NAMES: readonly string[] = [
  'Ada',
  'Grace',
  'Alan',
  ANONYMISED_PLACEHOLDER,
  `  ${ANONYMISED_PLACEHOLDER}  `,
  'Former  player',
];

/** One Squad_Member, minus the identity the collection generator assigns. */
const memberShapeArb = fc.record({
  displayName: fc.constantFrom(...MEMBER_NAMES),
  role: fc.constantFrom<MemberRole | null>('owner', 'admin', 'member', null),
  state: fc.constantFrom<MembershipStateValue>('active', 'inactive'),
  isGuest: fc.boolean(),
});

/**
 * A membership collection with **distinct** identities, which is what the backend
 * guarantees within a squad and what makes a per-row assertion a set comparison.
 *
 * A guest carries no Member_Role at the wire (Requirement 16.8), so a generated
 * guest's role is dropped rather than left as a shape the parser would never
 * produce.
 */
const membersArb: fc.Arbitrary<readonly SquadMember[]> = fc
  .array(memberShapeArb, { maxLength: 4 })
  .chain((shapes) =>
    fc
      .uniqueArray(fc.uuid(), { minLength: shapes.length, maxLength: shapes.length })
      .map((identities) =>
        shapes.map((shape, index) => ({
          ...shape,
          role: shape.isGuest ? null : shape.role,
          membershipId: identities[index],
        })),
      ),
  );

/**
 * The squad's Feature_Flag collection. The Enum_Code_Map names one feature, so
 * the collection is either empty — which the Feature_Toggle set renders as its
 * "no optional features" statement — or that one flag in either state
 * (Requirement 14.8).
 */
const featuresArb: fc.Arbitrary<readonly FeatureFlag[]> = fc.oneof(
  fc.constant<readonly FeatureFlag[]>([]),
  fc
    .boolean()
    .map((isEnabled) => [{ feature: 'live-match-tracking' as const, isEnabled }]),
);

/** One generated interaction with whatever the screen currently renders. */
type Interaction =
  | { readonly kind: 'click'; readonly index: number }
  | { readonly kind: 'press'; readonly index: number; readonly key: string }
  | { readonly kind: 'tab' };

/**
 * The keys worth pressing at a control: both activation keys, the key that closes
 * a surface, and one that does nothing — so a sequence covers activation as well
 * as traversal (Requirements 19.4, 19.8).
 */
const INTERACTION_KEYS: readonly string[] = [
  '{Enter}',
  ' ',
  '{Escape}',
  '{ArrowDown}',
];

const interactionArb: fc.Arbitrary<Interaction> = fc
  .record({
    kind: fc.constantFrom('click', 'press', 'tab'),
    index: fc.nat({ max: 11 }),
    key: fc.constantFrom(...INTERACTION_KEYS),
  })
  .map(({ kind, index, key }): Interaction => {
    if (kind === 'tab') {
      return { kind: 'tab' };
    }

    return kind === 'click' ? { kind: 'click', index } : { kind: 'press', index, key };
  });

// --- The seams ----------------------------------------------------------------

/**
 * The seven calls Requirement 10.4 forbids a non-admin session from issuing.
 * Named by the operation rather than by the method, because the requirement is
 * about the operations.
 */
const FORBIDDEN_ADMIN_CALLS: readonly string[] = [
  'ListInvites',
  'GenerateInvite',
  'RevokeInvite',
  'CreateGuest',
  'EditGuest',
  'PromoteToAdmin',
  'SetFeatureFlag',
];

/** Every non-success outcome collapses to this; no arm carries a body. */
const TRANSPORT_FAILURE: CallResult<never> = { kind: 'transport-failure' };

/**
 * A Squads_Api that records **every** operation it is asked for by name and
 * answers the three reads a Squad_Screen legitimately needs.
 *
 * Recording rather than throwing is deliberate: a forbidden call must be reported
 * as the operation it was, at the end of the run, alongside the interaction
 * sequence that produced it — a thrown error inside a React event handler would
 * surface as an unrelated rendering failure. `ListInvites` answers with an empty
 * accepted list because an authority-holding render legitimately issues it
 * (Requirement 11.1); it is still recorded, which is what makes its *absence*
 * from a non-admin run an assertion rather than an assumption.
 */
function createRecordingApi(options: {
  readonly detail: SquadDetail;
  readonly summaries: readonly SquadSummary[];
}): { readonly api: SquadsApi; readonly calls: readonly string[] } {
  const calls: string[] = [];
  const note = (name: string): void => {
    calls.push(name);
  };

  const api: SquadsApi = {
    listMySquads: () => {
      note('ListMySquads');
      return Promise.resolve({ kind: 'success', value: options.summaries });
    },
    getSquad: () => {
      note('GetSquad');
      return Promise.resolve({ kind: 'success', value: options.detail });
    },
    getDisplayRatingLeaderboard: () => {
      note('GetSquadLeaderboard');
      return Promise.resolve({ kind: 'success', value: { entries: [] } });
    },
    createSquad: () => {
      note('CreateSquad');
      return Promise.resolve(TRANSPORT_FAILURE);
    },
    redeemInvite: () => {
      note('RedeemInvite');
      return Promise.resolve(TRANSPORT_FAILURE);
    },
    previewInvite: () => {
      note('PreviewInvite');
      return Promise.resolve(TRANSPORT_FAILURE);
    },
    listInvites: () => {
      note('ListInvites');
      return Promise.resolve({ kind: 'success', value: [] });
    },
    generateInvite: () => {
      note('GenerateInvite');
      return Promise.resolve(TRANSPORT_FAILURE);
    },
    revokeInvite: () => {
      note('RevokeInvite');
      return Promise.resolve(TRANSPORT_FAILURE);
    },
    createGuest: () => {
      note('CreateGuest');
      return Promise.resolve(TRANSPORT_FAILURE);
    },
    editGuest: () => {
      note('EditGuest');
      return Promise.resolve(TRANSPORT_FAILURE);
    },
    promoteToAdmin: () => {
      note('PromoteToAdmin');
      return Promise.resolve(TRANSPORT_FAILURE);
    },
    getFeatureFlags: () => {
      note('GetFeatureFlags');
      return Promise.resolve(TRANSPORT_FAILURE);
    },
    setFeatureFlag: () => {
      note('SetFeatureFlag');
      return Promise.resolve(TRANSPORT_FAILURE);
    },
  };

  return { api, calls };
}

/**
 * A `SessionManager` reporting `authenticated`, which is the only Auth_State in
 * which the screen reads anything at all (Requirement 17.5). No case here moves
 * the session, so the remaining members are inert.
 */
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

// --- Rendering ----------------------------------------------------------------

/** Let both settled calls deliver and every resulting React update apply. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 24; round += 1) {
      await Promise.resolve();
    }
  });
}

/** The screen at its real route, inside a real router and a real AuthProvider. */
function screenTree(api: SquadsApi): ReactElement {
  return (
    <AuthProvider manager={sessionManager()}>
      <MemoryRouter initialEntries={[squadPath(SQUAD_ID)]}>
        <Routes>
          <Route path={SQUAD_ROUTE} element={<SquadScreen api={api} />} />
          {/* A navigation away is a legitimate consequence of activating a
              Player_Row, so the destination exists rather than being a dead end
              that would end the interaction sequence in an error. */}
          <Route path={PLAYER_STATS_ROUTE} element={<p>player stats</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

/**
 * Render the Squad_Screen for one squad and one caller standing, and let both
 * calls settle.
 *
 * @returns the recorded call names, which the caller reads after interacting
 */
async function renderSquad(options: {
  readonly members: readonly SquadMember[];
  readonly features: readonly FeatureFlag[];
  readonly caller: CallerStanding;
}): Promise<readonly string[]> {
  const detail: SquadDetail = {
    squadId: SQUAD_ID,
    name: SQUAD_NAME,
    members: options.members,
    features: options.features,
  };

  // 6.10: the caller's role and state reach the screen only through the summary
  // for this squad, which is the one place the screen resolves them from.
  const summaries: readonly SquadSummary[] = [
    {
      squadId: SQUAD_ID,
      name: SQUAD_NAME,
      role: options.caller.role,
      state: options.caller.state,
    },
  ];

  const { api, calls } = createRecordingApi({ detail, summaries });

  render(screenTree(api));
  await flush();

  return calls;
}

// --- Reading the rendered surface ---------------------------------------------

/** The text of every heading at one level, in document order. */
function headingTexts(level: 1 | 2 | 3): readonly string[] {
  return Array.from(document.querySelectorAll(`h${level}`)).map(
    (heading) => heading.textContent ?? '',
  );
}

/** The membership identity carried by every element matching a selector. */
function membershipIdsOf(selector: string): readonly string[] {
  return Array.from(document.querySelectorAll<HTMLElement>(selector))
    .map((element) => element.closest<HTMLElement>(PLAYER_ROW_SELECTOR))
    .map((row) => row?.getAttribute(PLAYER_ROW_MEMBERSHIP_ID_ATTRIBUTE) ?? '')
    .sort();
}

/** What one Player_Row renders, excluding any admin affordance on it. */
interface RowFacts {
  readonly membershipId: string;
  readonly state: string;
  readonly name: string;
  readonly statsPath: string;
  readonly labels: readonly string[];
  readonly rating: string;
}

/**
 * The non-admin surface, as a value two renders can be compared over.
 *
 * Deliberately excludes the caller's own role label, which Requirement 6.3 has
 * naming the caller's role and which therefore *must* differ between an
 * authority-holding render and one without. Everything else Requirement 10.3
 * calls unchanged is in here: the heading, the section outline minus the
 * administration heading, every row's rendered content, and the two placeholder
 * statements.
 */
interface NonAdminSurface {
  readonly headings: readonly string[];
  readonly sectionHeadings: readonly string[];
  readonly detailSectionPresent: boolean;
  readonly playerListPresent: boolean;
  readonly playerListEmptyPresent: boolean;
  readonly rows: readonly RowFacts[];
  readonly placeholderStatements: readonly string[];
}

function describeNonAdminSurface(): NonAdminSurface {
  const bodyText = document.body.textContent ?? '';

  return {
    headings: headingTexts(1),
    // 6.8: the administration heading is the one level-two heading the two
    // renders are expected to differ by, so it is removed rather than compared.
    sectionHeadings: headingTexts(2).filter(
      (heading) => heading !== ADMIN_SECTION_HEADING,
    ),
    detailSectionPresent:
      document.querySelector(SQUAD_DETAIL_SECTION_SELECTOR) !== null,
    playerListPresent: document.querySelector(PLAYER_LIST_SELECTOR) !== null,
    playerListEmptyPresent:
      document.querySelector(PLAYER_LIST_EMPTY_SELECTOR) !== null,
    rows: Array.from(
      document.querySelectorAll<HTMLElement>(PLAYER_ROW_SELECTOR),
    ).map((row) => {
      const open = row.querySelector<HTMLElement>(PLAYER_ROW_OPEN_SELECTOR);

      return {
        membershipId: row.getAttribute(PLAYER_ROW_MEMBERSHIP_ID_ATTRIBUTE) ?? '',
        state: row.getAttribute('data-membership-state') ?? '',
        name: open?.textContent ?? '',
        statsPath: open?.getAttribute(PLAYER_ROW_STATS_PATH_ATTRIBUTE) ?? '',
        labels: Array.from(
          row.querySelectorAll<HTMLElement>(MEMBERSHIP_LABEL_SELECTOR),
        ).map((label) => label.textContent ?? ''),
        rating:
          row.querySelector<HTMLElement>(RATING_BADGE_SELECTOR)?.textContent ?? '',
      };
    }),
    placeholderStatements: [
      MATCHES_PLACEHOLDER_STATEMENT,
      STATS_PLACEHOLDER_STATEMENT,
    ].filter((statement) => bodyText.includes(statement)),
  };
}

// --- The assertions -----------------------------------------------------------

/**
 * Requirement 10.2: the Admin_Section exists, and so do the Invite_Manager, the
 * Guest_Manager, and the Feature_Toggle set inside it — in the order
 * Requirement 10.7 fixes, each under its own level-three heading.
 */
function expectAdminSurfaceRendered(features: readonly FeatureFlag[]): void {
  expect(document.querySelector(ADMIN_SECTION_SELECTOR)).not.toBeNull();
  expect(document.querySelector(INVITE_MANAGER_SELECTOR)).not.toBeNull();
  expect(document.querySelector(GENERATE_INVITE_CONTROL_SELECTOR)).not.toBeNull();
  expect(document.querySelector(GUEST_MANAGER_ADD_SELECTOR)).not.toBeNull();
  expect(document.querySelector(FEATURE_TOGGLES_SELECTOR)).not.toBeNull();

  expect(
    Array.from(
      document.querySelectorAll<HTMLElement>(ADMIN_SUBSECTION_SELECTOR),
    ).map((section) => section.getAttribute(ADMIN_SUBSECTION_ATTRIBUTE)),
  ).toEqual(['invites', 'guests', 'features']);

  // 14.1: one toggle per parsed Feature_Flag, so an empty collection renders no
  // toggle while the set itself is still there.
  expect(document.querySelectorAll(FEATURE_TOGGLE_SELECTOR)).toHaveLength(
    features.length,
  );

  // 6.8, 10.7: the administration heading joins the four other sections.
  expect(headingTexts(2)).toEqual([
    SQUAD_DETAIL_SECTION_HEADING,
    PLAYERS_SECTION_HEADING,
    MATCHES_SECTION_HEADING,
    STATS_SECTION_HEADING,
    ADMIN_SECTION_HEADING,
  ]);
  expect(headingTexts(3)).toHaveLength(3);
}

/**
 * Requirement 10.3: no admin section, no invite manager, no guest manager, no
 * feature toggle, and no promotion control — absent rather than disabled, which
 * is what makes Requirement 10.4 structural.
 */
function expectNoAdminSurface(): void {
  expect(document.querySelector(ADMIN_SECTION_SELECTOR)).toBeNull();
  expect(document.querySelector(INVITE_MANAGER_SELECTOR)).toBeNull();
  expect(document.querySelector(GENERATE_INVITE_CONTROL_SELECTOR)).toBeNull();
  expect(document.querySelector(GUEST_MANAGER_ADD_SELECTOR)).toBeNull();
  expect(document.querySelector(FEATURE_TOGGLES_SELECTOR)).toBeNull();
  expect(document.querySelectorAll(FEATURE_TOGGLE_SELECTOR)).toHaveLength(0);
  expect(document.querySelectorAll(PROMOTION_CONTROL_SELECTOR)).toHaveLength(0);
  expect(document.querySelectorAll(PLAYER_ROW_PROMOTE_SELECTOR)).toHaveLength(0);
  expect(document.querySelectorAll(PLAYER_ROW_EDIT_GUEST_SELECTOR)).toHaveLength(0);

  // 10.7: the three admin subsections are the only level-three headings of this
  // screen, so their absence is a structural statement as well as a selector one.
  expect(headingTexts(3)).toHaveLength(0);
  expect(headingTexts(2)).not.toContain(ADMIN_SECTION_HEADING);
}

/**
 * Requirements 10.2, 12.7, 13.1: the promotion control and the guest edit control
 * sit on exactly the rows the two pure predicates accept, for this caller.
 *
 * The caller's own membership identity is `null` because no result the feature
 * holds names it (Requirement 6.10), which is the same value the screen hands the
 * rows — so the expectation is the predicate's answer for the caller the screen
 * actually has, not for an invented one.
 */
function expectRowControlsMatchEligibility(
  members: readonly SquadMember[],
  authority: boolean,
): void {
  const eligibleForPromotion = members
    .filter((member) => isPromotable(member, null, authority))
    .map((member) => member.membershipId)
    .sort();

  const editableGuests = members
    .filter((member) => isGuestEditable(member, authority))
    .map((member) => member.membershipId)
    .sort();

  expect(membershipIdsOf(PLAYER_ROW_PROMOTE_SELECTOR)).toEqual(eligibleForPromotion);
  expect(membershipIdsOf(PLAYER_ROW_EDIT_GUEST_SELECTOR)).toEqual(editableGuests);
}

/**
 * The squad itself is on screen: one level-one Squad_Name, the detail region, the
 * Player_List, both placeholder statements, and neither failure surface. Asserted
 * in both branches, so "no admin surface" can never be satisfied by a screen that
 * failed to render the squad at all.
 */
function expectSquadRendered(members: readonly SquadMember[]): void {
  expect(headingTexts(1)).toEqual([SQUAD_NAME]);
  expect(document.querySelector(SQUAD_DETAIL_SECTION_SELECTOR)).not.toBeNull();

  // 7.12: an accepted empty membership set is the absence statement rather than an
  // empty list, so the players section is present either way.
  if (members.length === 0) {
    expect(document.querySelector(PLAYER_LIST_EMPTY_SELECTOR)).not.toBeNull();
  } else {
    expect(document.querySelector(PLAYER_LIST_SELECTOR)).not.toBeNull();
  }

  expect(document.querySelectorAll(PLAYER_ROW_SELECTOR)).toHaveLength(
    members.length,
  );
  expect(document.body.textContent ?? '').toContain(MATCHES_PLACEHOLDER_STATEMENT);
  expect(document.body.textContent ?? '').toContain(STATS_PLACEHOLDER_STATEMENT);
  expect(document.querySelector(FAILURE_NOTICE_SELECTOR)).toBeNull();
  expect(document.querySelector(NOT_FOUND_TREATMENT_SELECTOR)).toBeNull();
}

// --- Interacting --------------------------------------------------------------

/**
 * Everything on the rendered surface a person could operate. Collected fresh
 * before each interaction, so a sequence follows the surface as it changes — and
 * so a navigation away from the screen leaves nothing to operate rather than
 * targeting a detached element.
 */
const OPERABLE_SELECTOR =
  'button, [role="switch"], [role="button"], input, select, textarea, a[href], [tabindex]';

/** Apply one generated interaction to whatever is currently rendered. */
async function interact(user: UserEvent, action: Interaction): Promise<void> {
  if (action.kind === 'tab') {
    await user.tab();
    return;
  }

  const operable = Array.from(
    document.querySelectorAll<HTMLElement>(OPERABLE_SELECTOR),
  );

  if (operable.length === 0) {
    return;
  }

  const target = operable[action.index % operable.length];

  if (action.kind === 'click') {
    await user.click(target);
  } else {
    target.focus();
    await user.keyboard(action.key);
  }

  await flush();
}

// --- The properties -----------------------------------------------------------

describe('Property 26 — admin affordances and admin calls exist exactly while authority holds', () => {
  // Feature: web-squads-screens, Property 26: Admin affordances and admin calls exist exactly while authority holds
  // Validates: Requirements 10.2, 10.3
  it('renders the admin surface exactly while authority holds, and the rest of the screen unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        callerStandingArb,
        membersArb,
        featuresArb,
        async (caller, members, features) => {
          const authority = resolveAdminAuthority(caller.role, caller.state);

          let withoutAdmin: NonAdminSurface | null = null;

          try {
            await renderSquad({ members, features, caller });

            expectSquadRendered(members);

            if (authority) {
              expectAdminSurfaceRendered(features);
            } else {
              expectNoAdminSurface();
              withoutAdmin = describeNonAdminSurface();
            }

            // 10.2: exactly the eligible rows carry the row-level admin controls,
            // in both branches — the predicates already answer `false` for every
            // row of a caller without authority.
            expectRowControlsMatchEligibility(members, authority);
          } finally {
            cleanup();
          }

          if (withoutAdmin === null) {
            return;
          }

          // 10.3: the same squad, seen by an active owner. Everything outside the
          // admin surface must read identically.
          try {
            await renderSquad({ members, features, caller: AUTHORITY_HOLDER });

            expect(withoutAdmin).toEqual(describeNonAdminSurface());
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 300_000);

  // Feature: web-squads-screens, Property 26: Admin affordances and admin calls exist exactly while authority holds
  // Validates: Requirements 10.4
  it('issues no admin call for any interaction sequence while authority does not hold', async () => {
    await fc.assert(
      fc.asyncProperty(
        withoutAuthorityArb,
        membersArb,
        featuresArb,
        fc.array(interactionArb, { maxLength: 5 }),
        async (caller, members, features, actions) => {
          const user = userEvent.setup({
            delay: null,
            // The surface is styled from the feature token table, and a property
            // is not the place to discover a `pointer-events` rule; the point
            // here is which calls an activation produces.
            pointerEventsCheck: 0,
          });

          try {
            const calls = await renderSquad({ members, features, caller });

            expectSquadRendered(members);
            expectNoAdminSurface();

            for (const action of actions) {
              await interact(user, action);
            }

            // 10.4: no admin call, from the mount or from any activation in the
            // sequence — the surfaces that issue them were never mounted.
            expect(
              calls.filter((name) => FORBIDDEN_ADMIN_CALLS.includes(name)),
            ).toEqual([]);

            // And the surface still offers none, so nothing in the sequence
            // revealed an admin affordance.
            expect(document.querySelector(ADMIN_SECTION_SELECTOR)).toBeNull();
            expect(headingTexts(3)).toHaveLength(0);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 300_000);
});
