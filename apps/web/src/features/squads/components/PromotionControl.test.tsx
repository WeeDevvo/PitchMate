/**
 * Unit tests for promotion — the whole of one admin action, from the affordance to
 * the backend's answer arriving back on the row.
 *
 * What is pinned here is exactly what task 12.7 lists, and each claim is asserted
 * through the real collaborators rather than around them:
 *
 *  - **the confirmation names the player** and nothing is submitted until it is
 *    confirmed (Requirement 13.4);
 *  - **exactly one `PromoteToAdmin`** per confirmation, with a second activation
 *    while the call awaits a response submitting nothing (Requirements 13.4,
 *    13.6);
 *  - **exactly one further `GetSquad`** on success — counted on the api double,
 *    because the re-read is issued by `useSquadScreen` through the `refresh` seam
 *    `usePromotion` is handed, and is therefore observable as a real call rather
 *    than as a spy's invocation (Requirement 13.5);
 *  - **the Member_Role label naming admin** after that re-read, read off the real
 *    composed Player_Row — `composePlayerList` → `PlayerList` → `PlayerRow` →
 *    `MembershipLabels` — so the label is the one a person would see and not one
 *    this file arranged (Requirement 13.5);
 *  - **the live-region announcement** of both outcomes (Requirements 13.5, 13.7);
 *  - **a not-found or a rejection leaves the rendered Squad_Detail untouched** and
 *    the control available for a further activation, which is Requirement 10.5's
 *    point: the backend stays authoritative, so an eligible-looking row whose
 *    promotion is refused announces the generic failure, changes nothing on
 *    screen, and can be activated again — the absence of a control is never the
 *    access control.
 *
 * ### Two harnesses, and why the composed one renders the row without its own
 * ### promotion affordance
 *
 * The composed harness runs the real `useSquadScreen` and the real `usePromotion`
 * over one api double, so "one further `GetSquad`" is a count of requests and the
 * promoted label arrives from the second response.
 *
 * Its `PlayerList` is handed a viewer that holds no Admin_Authority. That is not a
 * fudge: `PlayerRow` and `PromotionControl` render *the same affordance*, under
 * the same selector and the same accessible name, and a row is meant to render one
 * or the other and never both (see `PromotionControl.tsx`). The confirming control
 * is the one under test here, so the row contributes what only it can — the
 * Member_Role label, which no viewer context affects — and does not duplicate the
 * trigger. The caller's real Admin_Authority is still resolved by the machine and
 * handed to the control being exercised.
 *
 * The deferred harness holds a `PromoteToAdmin` call open, which is the only way
 * to observe the pending state and the second activation that must submit nothing.
 *
 * Eligibility itself — which rows carry a control at all — is
 * `lib/promotionEligibility.property.test.ts`'s, and focus entry, focus return,
 * and Escape belong to `ConfirmDialog.test.tsx` and
 * `focusManagement.property.test.tsx`. Neither is re-asserted here.
 *
 * Feature: web-squads-screens
 */
import { type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MEMBERSHIP_LABEL_KIND_ATTRIBUTE } from './MembershipLabels';
import { PlayerList } from './PlayerList';
import {
  PLAYER_ROW_MEMBERSHIP_ID_ATTRIBUTE,
  PLAYER_ROW_SELECTOR,
  type ViewerContext,
} from './PlayerRow';
import {
  PROMOTION_CONTROL_SELECTOR,
  PROMOTION_OUTCOME_SELECTOR,
  PROMOTION_TRIGGER_SELECTOR,
  PromotionControl,
} from './PromotionControl';
import type { CallResult, SquadsApi } from '../api/squadsApi';
import type { MemberRole } from '../lib/enumCodes';
import {
  ADMIN_ROLE_LABEL,
  GENERIC_SQUADS_FAILURE,
  MEMBER_ROLE_LABEL,
  OWNER_ROLE_LABEL,
  PROMOTE_TO_ADMIN_LABEL,
  PROMOTION_CONFIRM_HEADING,
  PROMOTION_CONFIRM_STATEMENT,
  PROMOTION_SUCCEEDED,
} from '../lib/messages';
import type { DisplayRatingLeaderboard } from '../lib/parse/leaderboard';
import type { SquadDetail } from '../lib/parse/squadDetail';
import { usePromotion } from '../state/usePromotion';
import { useSquadScreen } from '../state/useSquadScreen';

const SQUAD_ID = '8f1a9d4e-4f7b-7c1e-9a2b-3c4d5e6f7a8b';
const TARGET_MEMBERSHIP_ID = '1b2c3d4e-5f60-7a8b-9c0d-1e2f3a4b5c6d';
const VIEWER_MEMBERSHIP_ID = 'aa11bb22-cc33-7d44-8e55-ff6677889900';
const TARGET_NAME = 'Dave';
const VIEWER_NAME = 'Vera';

/** The accessible name of the promotion trigger on the target's row. */
const TRIGGER_NAME = `${PROMOTE_TO_ADMIN_LABEL}: ${TARGET_NAME}`;

/**
 * A Squad_Detail in which the caller is the active owner and the target carries
 * the given Member_Role — the two responses a promotion sits between.
 */
function detailWithTargetRole(role: MemberRole): SquadDetail {
  return {
    squadId: SQUAD_ID,
    name: 'Thursday Nights',
    members: [
      {
        membershipId: VIEWER_MEMBERSHIP_ID,
        displayName: VIEWER_NAME,
        role: 'owner',
        state: 'active',
        isGuest: false,
      },
      {
        membershipId: TARGET_MEMBERSHIP_ID,
        displayName: TARGET_NAME,
        role,
        state: 'active',
        isGuest: false,
      },
    ],
    features: [],
  };
}

/**
 * The viewer the composed harness hands its `PlayerList`: no Admin_Authority, so
 * the row states its membership facts without rendering a second copy of the
 * affordance the `PromotionControl` under test owns. See the module note.
 */
const LABELS_ONLY_VIEWER: ViewerContext = {
  membershipId: VIEWER_MEMBERSHIP_ID,
  isAdmin: false,
};

// --- The composed harness ----------------------------------------------------

interface ComposedApiDouble {
  readonly api: SquadsApi;
  /** The squad identity of every `GetSquad` request, in order. */
  readonly getSquadCalls: string[];
  /** The squad identity of every `GetSquadLeaderboard` request, in order. */
  readonly leaderboardCalls: string[];
  /** The membership identity of every `PromoteToAdmin` request, in order. */
  readonly promoteCalls: string[];
}

/**
 * An api double answering `GetSquad` from a script — the first response before the
 * promotion, the next after it — and `PromoteToAdmin` with a fixed outcome.
 *
 * The leaderboard succeeds, so a re-read that asks for one only where none is held
 * asks for none, and the `GetSquad` count stays the only thing moving.
 */
function composedApi(
  details: readonly SquadDetail[],
  promoteResult: CallResult<void> = { kind: 'success', value: undefined },
): ComposedApiDouble {
  const getSquadCalls: string[] = [];
  const leaderboardCalls: string[] = [];
  const promoteCalls: string[] = [];

  const getSquad = vi.fn(async (squadId: string) => {
    const index = Math.min(getSquadCalls.length, details.length - 1);
    getSquadCalls.push(squadId);

    return { kind: 'success', value: details[index] } as CallResult<SquadDetail>;
  });

  const getDisplayRatingLeaderboard = vi.fn(async (squadId: string) => {
    leaderboardCalls.push(squadId);

    const leaderboard: CallResult<DisplayRatingLeaderboard> = {
      kind: 'success',
      value: { entries: [] },
    };

    return leaderboard;
  });

  const promoteToAdmin = vi.fn(async (_squadId: string, membershipId: string) => {
    promoteCalls.push(membershipId);

    return promoteResult;
  });

  return {
    api: {
      getSquad,
      getDisplayRatingLeaderboard,
      promoteToAdmin,
    } as unknown as SquadsApi,
    getSquadCalls,
    leaderboardCalls,
    promoteCalls,
  };
}

/**
 * The real Squad_Screen wiring in miniature: the load machine owning `GetSquad`,
 * the promotion machine handed its `refresh`, the composed Player_List, and the
 * Promotion_Control for the target row.
 */
function ComposedHarness({ api }: { readonly api: SquadsApi }): ReactElement {
  const squad = useSquadScreen({
    api,
    squadId: SQUAD_ID,
    callerMembershipId: VIEWER_MEMBERSHIP_ID,
  });
  const promotion = usePromotion({ api, squadId: SQUAD_ID, refresh: squad.refresh });

  const target =
    squad.players.find((row) => row.membershipId === TARGET_MEMBERSHIP_ID) ?? null;

  return (
    <div>
      <PlayerList
        squadId={SQUAD_ID}
        rows={squad.players}
        viewer={LABELS_ONLY_VIEWER}
        onOpenPlayer={() => {}}
        onPromote={() => {}}
        onEditGuest={() => {}}
      />
      {target !== null && (
        <PromotionControl
          member={target}
          viewer={{
            membershipId: VIEWER_MEMBERSHIP_ID,
            isAdmin: squad.adminAuthority,
          }}
          promotion={promotion}
        />
      )}
    </div>
  );
}

/** The Member_Role label the composed row states for a membership, or `null`. */
function roleLabelOf(container: HTMLElement, membershipId: string): string | null {
  const row = container.querySelector(
    `${PLAYER_ROW_SELECTOR}[${PLAYER_ROW_MEMBERSHIP_ID_ATTRIBUTE}="${membershipId}"]`,
  );

  return (
    row?.querySelector(`[${MEMBERSHIP_LABEL_KIND_ATTRIBUTE}="role"]`)?.textContent ??
    null
  );
}

// --- The deferred harness ----------------------------------------------------

interface DeferredApiDouble {
  readonly api: SquadsApi;
  /** The membership identity of every `PromoteToAdmin` request, in order. */
  readonly promoteCalls: string[];
  /** Settle the held call. */
  settle(result: CallResult<void>): void;
}

/** An api double holding its `PromoteToAdmin` call open until it is settled. */
function deferredApi(): DeferredApiDouble {
  const promoteCalls: string[] = [];
  let resolve: ((result: CallResult<void>) => void) | null = null;

  const api = {
    promoteToAdmin: (_squadId: string, membershipId: string) => {
      promoteCalls.push(membershipId);

      return new Promise<CallResult<void>>((resolvePromise) => {
        resolve = resolvePromise;
      });
    },
  } as unknown as SquadsApi;

  return {
    api,
    promoteCalls,
    settle: (result) => {
      resolve?.(result);
    },
  };
}

interface DeferredHarnessProps {
  readonly api: SquadsApi;
  readonly role?: MemberRole;
  readonly refresh?: () => void;
}

/** The control alone, over a member whose role the test chooses. */
function DeferredHarness({
  api,
  role = 'member',
  refresh = () => {},
}: DeferredHarnessProps): ReactElement {
  const promotion = usePromotion({ api, squadId: SQUAD_ID, refresh });

  return (
    <PromotionControl
      member={{
        membershipId: TARGET_MEMBERSHIP_ID,
        displayName: TARGET_NAME,
        role,
        state: 'active',
        isGuest: false,
      }}
      viewer={{ membershipId: VIEWER_MEMBERSHIP_ID, isAdmin: true }}
      promotion={promotion}
    />
  );
}

// --- Shared queries ----------------------------------------------------------

const trigger = (): HTMLElement => screen.getByRole('button', { name: TRIGGER_NAME });

const queryTrigger = (): HTMLElement | null =>
  screen.queryByRole('button', { name: TRIGGER_NAME });

const confirm = (): HTMLElement =>
  screen.getByRole('button', { name: PROMOTE_TO_ADMIN_LABEL });

/** The control's live region — found structurally, so no copy is assumed. */
const outcomeRegion = (container: HTMLElement): HTMLElement => {
  const region = container.querySelector(PROMOTION_OUTCOME_SELECTOR);

  if (region === null) {
    throw new Error('no promotion outcome region is rendered');
  }

  return region as HTMLElement;
};

/** Activate the trigger and confirm the promotion. */
async function promote(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(trigger());
  await user.click(confirm());
}

describe('PromotionControl — the confirmation (Requirement 13.4)', () => {
  it('names the player and submits nothing until it is confirmed', async () => {
    const user = userEvent.setup();
    const { api, promoteCalls } = deferredApi();

    render(<DeferredHarness api={api} />);

    await user.click(trigger());

    const dialog = screen.getByRole('dialog');
    // 13.4: the confirmation names the player to be promoted, and states what
    // being an admin means, so the decision is an informed one.
    expect(dialog).toHaveTextContent(TARGET_NAME);
    expect(dialog).toHaveAccessibleName(PROMOTION_CONFIRM_HEADING);
    // The name is inside the description, so it is announced on entry rather than
    // only read by a person who happens to look.
    expect(dialog).toHaveAccessibleDescription(
      new RegExp(`${TARGET_NAME}[\\s\\S]*`),
    );
    expect(dialog).toHaveTextContent(PROMOTION_CONFIRM_STATEMENT);

    // 13.4: activating the control asks; it does not act.
    expect(promoteCalls).toEqual([]);
  });

  it('renders nothing at all while the row is ineligible and nothing has settled', () => {
    const { api } = deferredApi();

    const { container } = render(<DeferredHarness api={api} role="admin" />);

    // 13.2: absent rather than disabled — and with no outcome to announce, the
    // control contributes no region either.
    expect(container).toBeEmptyDOMElement();
  });

  it('renders an empty live region before anything has settled', () => {
    const { api } = deferredApi();

    const { container } = render(<DeferredHarness api={api} />);

    const region = outcomeRegion(container);
    // 13.5, 13.7: programmatically determinable, and carrying outcomes rather
    // than status — so nothing is announced before something has happened.
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region.textContent).toBe('');
  });
});

describe('PromotionControl — exactly one call per confirmation (Requirements 13.4, 13.6)', () => {
  it('submits one PromoteToAdmin and submits nothing further while it awaits a response', async () => {
    const user = userEvent.setup();
    const { api, promoteCalls, settle } = deferredApi();

    render(<DeferredHarness api={api} />);

    await promote(user);

    // 13.4: exactly one call, for exactly this membership.
    expect(promoteCalls).toEqual([TARGET_MEMBERSHIP_ID]);
    // 13.6: reported unavailable while the call awaits a response.
    expect(trigger()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('dialog')).toBeNull();

    // 13.6: a second activation of the same control asks nothing and submits
    // nothing — no second confirmation, no second concurrent call.
    await user.click(trigger());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(promoteCalls).toEqual([TARGET_MEMBERSHIP_ID]);

    settle({ kind: 'success', value: undefined });

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(PROMOTION_SUCCEEDED);
    });
    expect(promoteCalls).toEqual([TARGET_MEMBERSHIP_ID]);
  });

  it('triggers the re-read only on success', async () => {
    const user = userEvent.setup();
    const { api, settle } = deferredApi();
    const refresh = vi.fn();

    const { container } = render(<DeferredHarness api={api} refresh={refresh} />);

    await promote(user);

    settle({ kind: 'timeout' });

    // 13.7: one message for every non-success arm, and no re-read at all.
    await waitFor(() => {
      expect(outcomeRegion(container)).toHaveTextContent(GENERIC_SQUADS_FAILURE);
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('PromotionControl — the re-read and the promoted label (Requirement 13.5)', () => {
  it('issues exactly one further GetSquad and renders the row as an admin', async () => {
    const user = userEvent.setup();
    const { api, getSquadCalls, leaderboardCalls, promoteCalls } = composedApi([
      detailWithTargetRole('member'),
      detailWithTargetRole('admin'),
    ]);

    const { container } = render(<ComposedHarness api={api} />);

    // The mount pair, and the row as the backend first described it.
    await screen.findByRole('button', { name: TRIGGER_NAME });
    expect(roleLabelOf(container, TARGET_MEMBERSHIP_ID)).toBe(MEMBER_ROLE_LABEL);
    expect(getSquadCalls).toEqual([SQUAD_ID]);

    await promote(user);

    // 13.5: the promoted row states the admin role — read off the real composed
    // row, and sourced from the re-read rather than from a local edit.
    await waitFor(() => {
      expect(roleLabelOf(container, TARGET_MEMBERSHIP_ID)).toBe(ADMIN_ROLE_LABEL);
    });

    // 13.5: exactly one call, and exactly one further `GetSquad`. The leaderboard
    // is held, so the re-read asks for no second one.
    expect(promoteCalls).toEqual([TARGET_MEMBERSHIP_ID]);
    expect(getSquadCalls).toEqual([SQUAD_ID, SQUAD_ID]);
    expect(leaderboardCalls).toEqual([SQUAD_ID]);
  });

  it('announces the promotion in a live region that outlives the affordance', async () => {
    const user = userEvent.setup();
    const { api } = composedApi([
      detailWithTargetRole('member'),
      detailWithTargetRole('admin'),
    ]);

    const { container } = render(<ComposedHarness api={api} />);

    await screen.findByRole('button', { name: TRIGGER_NAME });
    await promote(user);

    // 13.5: the confirmation is announced where it happened, in the region that
    // was already there — so its content changes rather than the region being
    // replaced.
    await waitFor(() => {
      expect(outcomeRegion(container)).toHaveTextContent(PROMOTION_SUCCEEDED);
    });
    expect(outcomeRegion(container)).toHaveAttribute('aria-live', 'polite');

    // The re-read makes the row ineligible, so the trigger goes — and the
    // announcement stays, which is the only order in which it can be heard.
    await waitFor(() => {
      expect(
        container.querySelector(
          `${PROMOTION_CONTROL_SELECTOR} ${PROMOTION_TRIGGER_SELECTOR}`,
        ),
      ).toBeNull();
    });
    expect(outcomeRegion(container)).toHaveTextContent(PROMOTION_SUCCEEDED);
  });
});

describe('PromotionControl — a refused promotion changes nothing (Requirements 10.5, 13.7)', () => {
  const refusals: readonly (readonly [string, CallResult<void>])[] = [
    ['a not-found result', { kind: 'not-found' }],
    ['a rejection', { kind: 'rejected-input', reason: 'conflict' }],
  ];

  for (const [description, result] of refusals) {
    it(`leaves the rendered detail untouched and the control available after ${description}`, async () => {
      const user = userEvent.setup();
      const { api, getSquadCalls, promoteCalls } = composedApi(
        // A second response is scripted deliberately: were a refusal to trigger a
        // re-read, the row would silently turn into an admin and the assertions
        // below would catch it.
        [detailWithTargetRole('member'), detailWithTargetRole('admin')],
        result,
      );

      const { container } = render(<ComposedHarness api={api} />);

      await screen.findByRole('button', { name: TRIGGER_NAME });
      await promote(user);

      // 13.7: the generic failure, carrying nothing of the backend's own answer.
      await waitFor(() => {
        expect(outcomeRegion(container)).toHaveTextContent(GENERIC_SQUADS_FAILURE);
      });

      // 10.5: the rendered Squad_Detail is exactly what the backend last said —
      // still a member, still one row per membership, and no re-read pretending
      // otherwise.
      expect(roleLabelOf(container, TARGET_MEMBERSHIP_ID)).toBe(MEMBER_ROLE_LABEL);
      expect(roleLabelOf(container, VIEWER_MEMBERSHIP_ID)).toBe(OWNER_ROLE_LABEL);
      expect(container.querySelectorAll(PLAYER_ROW_SELECTOR)).toHaveLength(2);
      expect(getSquadCalls).toEqual([SQUAD_ID]);

      // 10.5, 13.7: the control is available for a further activation — the
      // hidden affordance was never the access control, so a refusal removes
      // nothing and the person may try again.
      const control = container.querySelector(
        PROMOTION_CONTROL_SELECTOR,
      ) as HTMLElement;
      expect(
        within(control).getByRole('button', { name: TRIGGER_NAME }),
      ).not.toHaveAttribute('aria-disabled');

      await promote(user);

      expect(promoteCalls).toEqual([TARGET_MEMBERSHIP_ID, TARGET_MEMBERSHIP_ID]);
      expect(getSquadCalls).toEqual([SQUAD_ID]);
      expect(queryTrigger()).not.toBeNull();
      await waitFor(() => {
        expect(outcomeRegion(container)).toHaveTextContent(GENERIC_SQUADS_FAILURE);
      });
      expect(roleLabelOf(container, TARGET_MEMBERSHIP_ID)).toBe(MEMBER_ROLE_LABEL);
    });
  }
});
