import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { HOME_ROUTE } from '../../app-shell';
import { AuthProvider, type SessionManager } from '../../auth';
import type { CallResult, SquadsApi } from '../api/squadsApi';
import { CALLER_ROLE_SELECTOR, SquadScreen } from './SquadScreen';
import { LEAVE_SQUAD_TRIGGER_SELECTOR } from '../components/LeaveSquadControl';
import { DEMOTE_TRIGGER_SELECTOR } from '../components/MembershipActionControl';
import {
  OWNERSHIP_TARGET_SELECTOR,
  OWNERSHIP_TRANSFER_TRIGGER_SELECTOR,
} from '../components/OwnershipTransfer';
import {
  ADMIN_ROLE_LABEL,
  DEMOTE_TO_MEMBER_LABEL,
  DEMOTION_SUCCEEDED,
  LEAVE_SQUAD_LABEL,
  OWNER_ROLE_LABEL,
  PROMOTE_TO_ADMIN_LABEL,
  PROMOTION_SUCCEEDED,
  TRANSFER_OWNERSHIP_LABEL,
  TRANSFER_OWNERSHIP_SUCCEEDED,
} from '../lib/messages';
import type { SquadDetail, SquadMember } from '../lib/parse/squadDetail';
import type { SquadSummary } from '../lib/parse/squadSummary';
import type { SquadRole } from '../lib/wireEnums';
import { SQUAD_ROUTE, squadPath } from '../lib/routePaths';

/**
 * Example tests for the membership actions wired into the real Squad_Screen,
 * over a stateful fake backend:
 *
 * - a transfer re-reads the caller's own standing as well as the squad, so the
 *   former owner is shown as an admin, offered Leave, and no longer offered the
 *   transfer — without reloading the page;
 * - leaving navigates to the Squads_Home;
 * - promotion and demotion on one row never announce both outcomes at once.
 */

// The App_Shell's scope publishing needs its provider; the screen's own
// behaviour does not depend on it.
vi.mock('../../app-shell', async () => {
  const actual =
    await vi.importActual<typeof import('../../app-shell')>('../../app-shell');

  return {
    ...actual,
    usePublishSquadScopeFromRoute: (): string | null => null,
  };
});

const SQUAD_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const CALLER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ID = '00000000-0000-4000-8000-000000000002';

function member(id: string, name: string, role: SquadRole): SquadMember {
  return {
    membershipId: id,
    displayName: name,
    role,
    state: 'Active',
    isGuest: false,
    appearances: 0,
    ratingState: null,
  };
}

/** A backend that applies transfer, promote, demote and leave to its own state. */
function statefulApi(): { readonly api: SquadsApi; readonly listCalls: () => number } {
  const roles = new Map<string, SquadRole>([
    [CALLER_ID, 'Owner'],
    [OTHER_ID, 'Member'],
  ]);
  let listCalls = 0;

  const detail = (): CallResult<SquadDetail> => ({
    kind: 'success',
    value: {
      squadId: SQUAD_ID,
      name: 'Thursday Nights',
      members: [
        member(CALLER_ID, 'Olu', roles.get(CALLER_ID) ?? 'Member'),
        member(OTHER_ID, 'Mia', roles.get(OTHER_ID) ?? 'Member'),
      ],
      features: [],
    },
  });
  const ok: CallResult<void> = { kind: 'success', value: undefined };

  const api = {
    listMySquads: async (): Promise<CallResult<readonly SquadSummary[]>> => {
      listCalls += 1;
      return {
        kind: 'success',
        value: [
          {
            squadId: SQUAD_ID,
            name: 'Thursday Nights',
            role: roles.get(CALLER_ID) ?? null,
            state: 'Active',
          },
        ],
      };
    },
    getSquad: async () => detail(),
    getDisplayRatingLeaderboard: async () => ({ kind: 'success', value: { entries: [] } }),
    // Administration also reads the admins' claim list; no claim activity here.
    listGuestClaims: async () => ({ kind: 'success', value: [] }),
    listInvites: async () => ({ kind: 'success', value: [] }),
    transferOwnership: async (_squadId: string, target: string) => {
      roles.set(CALLER_ID, 'Admin');
      roles.set(target, 'Owner');
      return ok;
    },
    promoteToAdmin: async (_squadId: string, target: string) => {
      roles.set(target, 'Admin');
      return ok;
    },
    demoteToMember: async (_squadId: string, target: string) => {
      roles.set(target, 'Member');
      return ok;
    },
    leaveSquad: vi.fn(async () => ok),
  } as unknown as SquadsApi;

  return { api, listCalls: () => listCalls };
}

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

async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 24; round += 1) {
      await Promise.resolve();
    }
  });
}

async function renderScreen(api: SquadsApi): Promise<HTMLElement> {
  const { container } = render(
    <AuthProvider manager={sessionManager()}>
      <MemoryRouter initialEntries={[squadPath(SQUAD_ID)]}>
        <Routes>
          <Route path={SQUAD_ROUTE} element={<SquadScreen api={api} />} />
          <Route path={HOME_ROUTE} element={<p>your squads home</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
  await flush();
  return container;
}

/** The dialog's confirm action, which shares its label with the trigger. */
async function confirm(user: ReturnType<typeof userEvent.setup>, label: string): Promise<void> {
  const buttons = screen.getAllByRole('button', { name: label });
  await user.click(buttons[buttons.length - 1] as HTMLElement);
  await flush();
}

afterEach(() => {
  cleanup();
});

describe('the Squad_Screen membership actions', () => {
  it('shows the former owner as an admin, offered Leave, as soon as a transfer succeeds', async () => {
    const user = userEvent.setup();
    const { api, listCalls } = statefulApi();
    const container = await renderScreen(api);

    expect(container.querySelector(CALLER_ROLE_SELECTOR)?.textContent).toBe(OWNER_ROLE_LABEL);
    expect(container.querySelector(LEAVE_SQUAD_TRIGGER_SELECTOR)).toBeNull();
    const listsBefore = listCalls();

    await user.selectOptions(
      container.querySelector(OWNERSHIP_TARGET_SELECTOR) as HTMLSelectElement,
      OTHER_ID,
    );
    await user.click(container.querySelector(OWNERSHIP_TRANSFER_TRIGGER_SELECTOR) as HTMLElement);
    await confirm(user, TRANSFER_OWNERSHIP_LABEL);

    expect(listCalls()).toBe(listsBefore + 1);
    expect(container.querySelector(CALLER_ROLE_SELECTOR)?.textContent).toBe(ADMIN_ROLE_LABEL);
    expect(container.querySelector(LEAVE_SQUAD_TRIGGER_SELECTOR)).not.toBeNull();
    expect(container.querySelector(OWNERSHIP_TARGET_SELECTOR)).toBeNull();
    expect(screen.getByText(TRANSFER_OWNERSHIP_SUCCEEDED)).toBeTruthy();
  });

  it('goes to the Squads_Home once leaving succeeds', async () => {
    const user = userEvent.setup();
    const { api } = statefulApi();
    const container = await renderScreen(api);

    await user.selectOptions(
      container.querySelector(OWNERSHIP_TARGET_SELECTOR) as HTMLSelectElement,
      OTHER_ID,
    );
    await user.click(container.querySelector(OWNERSHIP_TRANSFER_TRIGGER_SELECTOR) as HTMLElement);
    await confirm(user, TRANSFER_OWNERSHIP_LABEL);

    await user.click(screen.getByRole('button', { name: LEAVE_SQUAD_LABEL }));
    await confirm(user, LEAVE_SQUAD_LABEL);

    expect(screen.getByText('your squads home')).toBeTruthy();
  });

  it('never announces promotion and demotion together on one row', async () => {
    const user = userEvent.setup();
    const { api } = statefulApi();
    const container = await renderScreen(api);

    await user.click(screen.getByRole('button', { name: `${PROMOTE_TO_ADMIN_LABEL}: Mia` }));
    await confirm(user, PROMOTE_TO_ADMIN_LABEL);
    expect(screen.queryByText(PROMOTION_SUCCEEDED)).not.toBeNull();

    await user.click(container.querySelector(DEMOTE_TRIGGER_SELECTOR) as HTMLElement);
    await confirm(user, DEMOTE_TO_MEMBER_LABEL);

    expect(screen.queryByText(DEMOTION_SUCCEEDED)).not.toBeNull();
    expect(screen.queryByText(PROMOTION_SUCCEEDED)).toBeNull();
  });
});
