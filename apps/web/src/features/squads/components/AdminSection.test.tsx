/**
 * Unit tests for the Admin_Section container.
 *
 * Two things are this component's own, and nothing else here is:
 *
 *  - **The authority gate** (Requirements 10.2, 10.3, 10.4). Every combination of
 *    a Member_Role in {owner, admin, member, absent} and a Membership_State in
 *    {active, inactive, absent} is rendered, and the section's presence is
 *    compared against `resolveAdminAuthority` rather than against a list written
 *    out here — so the test states the relation the requirement states. Where
 *    authority does not hold, the three surfaces are absent *and* no method of the
 *    Squads_Api double has been called, which is the structural half of
 *    Requirement 10.4.
 *  - **The heading outline** (Requirement 10.7). One `h2` naming administration,
 *    one `h3` each for invites, guests, and features, and the whole sequence run
 *    through `validateHeadingOutline` so a skipped level fails here rather than in
 *    review.
 *
 * The api is a hand-written double over the seven admin methods. Only
 * `ListInvites` is issued by mounting — the Invite_Manager's one call per mount —
 * and the others exist so "no admin call from a non-admin session" is asserted
 * over the whole set rather than the one that happens to fire.
 *
 * What the three children do with their calls, their outcomes, and their copy is
 * pinned by their own tests; this file asserts only that each is present or absent
 * and sits under the right heading.
 *
 * Feature: web-squads-screens
 */
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import type { SquadsApi } from '../api/squadsApi';
import { resolveAdminAuthority } from '../lib/adminAuthority';
import type { MembershipState, SquadRole } from '../lib/wireEnums';
import { validateHeadingOutline } from '../lib/headingOutline';
import {
  ADD_GUEST_HEADING,
  ADMIN_SECTION_HEADING,
  FEATURES_SECTION_HEADING,
  GUESTS_SECTION_HEADING,
  INVITES_SECTION_HEADING,
} from '../lib/messages';
import type { FeatureFlag } from '../lib/parse/featureFlags';
import type { PlayerListRow } from '../lib/playerList';
import { AdminSection, ADMIN_SECTION_SELECTOR } from './AdminSection';
import { FEATURE_TOGGLES_SELECTOR } from './FeatureToggles';
import { GUEST_MANAGER_ADD_SELECTOR } from './GuestManager';
import { INVITE_MANAGER_SELECTOR } from './InviteManager';

const SQUAD_ID = '7a1c9e02-0000-4000-8000-000000000001';
const GUEST_ID = '7a1c9e02-0000-4000-8000-00000000000a';

const FLAGS: readonly FeatureFlag[] = [
  { feature: 'LiveMatchTracking', isEnabled: false },
];

const ROWS: readonly PlayerListRow[] = [
  {
    membershipId: GUEST_ID,
    displayName: 'Big Dave',
    role: null,
    state: 'Active',
    isGuest: true,
    appearances: 12,
    ratingState: 'Established',
    isFormerPlayer: false,
    leaderboardObtained: false,
    ratingEntry: null,
  },
];

/** Every Member_Role a membership can carry, and its absence (Requirement 6.10). */
const ROLES: readonly (SquadRole | null)[] = [
  'Owner',
  'Admin',
  'Member',
  null,
];

/** Every Membership_State, and its absence. */
const STATES: readonly (MembershipState | null)[] = [
  'Active',
  'Inactive',
  null,
];

interface ApiDouble {
  readonly api: SquadsApi;
  /** Every admin method, so a call to any of them can be counted. */
  readonly calls: readonly ReturnType<typeof vi.fn>[];
  readonly listInvites: ReturnType<typeof vi.fn>;
}

/**
 * A double over the seven admin endpoints. `ListInvites` succeeds with an empty
 * listing — a squad with no invite yet is a coherent state, and it keeps the
 * assertions here about presence rather than about rendered entries.
 */
function apiDouble(): ApiDouble {
  const listInvites = vi.fn(async () => ({
    kind: 'success' as const,
    value: [] as const,
  }));
  const generateInvite = vi.fn();
  const revokeInvite = vi.fn();
  const createGuest = vi.fn();
  const editGuest = vi.fn();
  const promoteToAdmin = vi.fn();
  const setFeatureFlag = vi.fn();
  const getFeatureFlags = vi.fn();

  return {
    api: {
      listInvites,
      generateInvite,
      revokeInvite,
      createGuest,
      editGuest,
      promoteToAdmin,
      setFeatureFlag,
      getFeatureFlags,
    } as unknown as SquadsApi,
    calls: [
      listInvites,
      generateInvite,
      revokeInvite,
      createGuest,
      editGuest,
      promoteToAdmin,
      setFeatureFlag,
      getFeatureFlags,
    ],
    listInvites,
  };
}

/**
 * The Squad_Screen's half: the screen's one `h1`, so the rendered outline is the
 * outline a person would navigate rather than a fragment of one.
 */
function Harness({
  api,
  role,
  state,
}: {
  readonly api: SquadsApi;
  readonly role: SquadRole | null;
  readonly state: MembershipState | null;
}): ReactElement {
  return (
    <div>
      <h1>Sunday Sixes</h1>
      <AdminSection
        squadId={SQUAD_ID}
        api={api}
        flags={FLAGS}
        onSquadChanged={() => {}}
        rows={ROWS}
        viewerRole={role}
        viewerState={state}
      />
    </div>
  );
}

/** The heading levels of a container, in document order (Requirement 19.2). */
function headingLevels(container: HTMLElement): readonly number[] {
  return [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(
    (heading) => Number(heading.tagName.slice(1)),
  );
}

/** The headings of one level, by their text. */
function headingsAtLevel(
  container: HTMLElement,
  level: number,
): readonly string[] {
  return [...container.querySelectorAll(`h${String(level)}`)].map(
    (heading) => heading.textContent ?? '',
  );
}

describe('AdminSection — the authority gate', () => {
  it.each(
    ROLES.flatMap((role) =>
      STATES.map((state) => ({
        role,
        state,
        authorised: resolveAdminAuthority(role, state),
      })),
    ),
  )(
    'renders the section exactly while authority holds: role $role, state $state',
    async ({ role, state, authorised }) => {
      const { api, calls } = apiDouble();
      const { container } = render(
        <Harness api={api} role={role} state={state} />,
      );

      if (authorised) {
        // 10.2: the section, and the three surfaces the requirement names within
        // it. The Promotion_Control is not among them — it belongs to a
        // Player_Row.
        await waitFor(() => {
          expect(
            container.querySelector(ADMIN_SECTION_SELECTOR),
          ).not.toBeNull();
        });

        expect(container.querySelector(INVITE_MANAGER_SELECTOR)).not.toBeNull();
        expect(
          container.querySelector(GUEST_MANAGER_ADD_SELECTOR),
        ).not.toBeNull();
        expect(container.querySelector(FEATURE_TOGGLES_SELECTOR)).not.toBeNull();

        return;
      }

      // 10.3: no section and none of its surfaces — an absence, not a disabled
      // control.
      expect(container.querySelector(ADMIN_SECTION_SELECTOR)).toBeNull();
      expect(container.querySelector(INVITE_MANAGER_SELECTOR)).toBeNull();
      expect(container.querySelector(GUEST_MANAGER_ADD_SELECTOR)).toBeNull();
      expect(container.querySelector(FEATURE_TOGGLES_SELECTOR)).toBeNull();
      expect(screen.queryByText(ADMIN_SECTION_HEADING)).toBeNull();

      // 10.4: and nothing was issued. The subtree that issues an admin call was
      // never mounted, so there is no path by which one could have been.
      for (const call of calls) {
        expect(call).not.toHaveBeenCalled();
      }
    },
  );

  it('issues no admin call beyond the invite listing while authority holds', async () => {
    const { api, calls, listInvites } = apiDouble();

    render(<Harness api={api} role="Owner" state="Active" />);

    // 11.1: the Invite_Manager's one call per mount, and nothing else. Mounting
    // the section is not itself a mutation of anything.
    await waitFor(() => {
      expect(listInvites).toHaveBeenCalledTimes(1);
    });

    for (const call of calls.filter((candidate) => candidate !== listInvites)) {
      expect(call).not.toHaveBeenCalled();
    }
  });
});

describe('AdminSection — the heading outline', () => {
  it('renders one h2 naming administration and one h3 per surface', async () => {
    const { api, listInvites } = apiDouble();
    const { container } = render(
      <Harness api={api} role="Admin" state="Active" />,
    );

    await waitFor(() => {
      expect(listInvites).toHaveBeenCalledTimes(1);
    });

    // 10.7: exactly one level-two heading, naming administration as the subject.
    expect(headingsAtLevel(container, 2)).toEqual([ADMIN_SECTION_HEADING]);

    // 10.7: exactly one level-three heading each, in the order the requirement
    // names them.
    expect(headingsAtLevel(container, 3)).toEqual([
      INVITES_SECTION_HEADING,
      GUESTS_SECTION_HEADING,
      FEATURES_SECTION_HEADING,
    ]);

    // The three children render no section heading of their own, so the guest
    // control's words appear on a control rather than on a heading.
    expect(headingsAtLevel(container, 4)).toEqual([]);
    expect(screen.getByRole('button', { name: ADD_GUEST_HEADING }).tagName).toBe(
      'BUTTON',
    );

    // 19.1, 19.2: the whole sequence, through the shared validator — one level-one
    // heading and no skipped level.
    expect(validateHeadingOutline(headingLevels(container))).toEqual({
      ok: true,
    });
    expect(headingLevels(container)).toEqual([1, 2, 3, 3, 3]);
  });

  it('names each region by its own heading', async () => {
    const { api, listInvites } = apiDouble();
    const { container } = render(
      <Harness api={api} role="Owner" state="Active" />,
    );

    await waitFor(() => {
      expect(listInvites).toHaveBeenCalledTimes(1);
    });

    // Each `section` is labelled by the heading rendered inside it, so assistive
    // technology announces the region with the words that are on screen.
    for (const region of container.querySelectorAll('section')) {
      const labelId = region.getAttribute('aria-labelledby');

      expect(labelId).not.toBeNull();
      expect(
        container.querySelector(`#${CSS.escape(labelId ?? '')}`)?.textContent,
      ).not.toBe('');
    }

    expect(
      screen.getByRole('region', { name: ADMIN_SECTION_HEADING }),
    ).not.toBeNull();
  });
});
