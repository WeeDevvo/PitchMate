import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { CallResult, SquadsApi } from '../api/squadsApi';
import {
  GENERIC_SQUADS_FAILURE,
  LEAVE_CONFIRM_HEADING,
  LEAVE_CONFIRM_STATEMENT,
  LEAVE_CONFLICT,
  LEAVE_SQUAD_LABEL,
  OWNER_MUST_TRANSFER_BEFORE_LEAVING,
} from '../lib/messages';
import type { MembershipState, SquadRole } from '../lib/wireEnums';
import { LEAVE_CALL, useMembershipAction } from '../state/useMembershipAction';
import {
  LEAVE_SQUAD_TRIGGER_SELECTOR,
  LeaveSquadControl,
  OWNER_MUST_TRANSFER_SELECTOR,
} from './LeaveSquadControl';

/**
 * Example tests for the leave control: the owner is told to transfer first and
 * offered no way to leave; any other active caller confirms, with copy that
 * says rating and history are kept, and exactly one `LeaveSquad` is issued;
 * a success hands over to the screen's navigation, and a refusal is announced.
 */

const SQUAD_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

afterEach(() => {
  cleanup();
});

function Host({
  api,
  role,
  state,
  onSucceeded,
}: {
  readonly api: SquadsApi;
  readonly role: SquadRole | null;
  readonly state: MembershipState | null;
  readonly onSucceeded: () => void;
}): ReactElement {
  const machine = useMembershipAction({
    api,
    squadId: SQUAD_ID,
    perform: LEAVE_CALL,
    onSucceeded,
  });
  return (
    <LeaveSquadControl
      squadId={SQUAD_ID}
      callerRole={role}
      callerState={state}
      machine={machine}
    />
  );
}

function fakeApi(result: CallResult<void>): {
  readonly api: SquadsApi;
  readonly leaveSquad: ReturnType<typeof vi.fn>;
} {
  const leaveSquad = vi.fn(async () => result);
  return { api: { leaveSquad } as unknown as SquadsApi, leaveSquad };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 8; round += 1) {
      await Promise.resolve();
    }
  });
}

describe('LeaveSquadControl', () => {
  it('tells the owner to transfer ownership first, and offers no leave control', () => {
    const { api } = fakeApi({ kind: 'success', value: undefined });
    const { container } = render(
      <Host api={api} role="Owner" state="Active" onSucceeded={() => {}} />,
    );

    expect(container.querySelector(OWNER_MUST_TRANSFER_SELECTOR)?.textContent).toBe(
      OWNER_MUST_TRANSFER_BEFORE_LEAVING,
    );
    expect(container.querySelector(LEAVE_SQUAD_TRIGGER_SELECTOR)).toBeNull();
  });

  it.each([
    ['an inactive member', 'Member', 'Inactive'],
    ['an unidentified caller', null, null],
  ] as const)('renders nothing for %s', (_name, role, state) => {
    const { api } = fakeApi({ kind: 'success', value: undefined });
    const { container } = render(
      <Host api={api} role={role} state={state} onSucceeded={() => {}} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it.each(['Member', 'Admin'] as const)(
    'lets an active %s leave after confirming, with one call, then hands over to navigation',
    async (role) => {
      const user = userEvent.setup();
      const onSucceeded = vi.fn();
      const { api, leaveSquad } = fakeApi({ kind: 'success', value: undefined });
      render(<Host api={api} role={role} state="Active" onSucceeded={onSucceeded} />);

      await user.click(screen.getByRole('button', { name: LEAVE_SQUAD_LABEL }));
      const dialog = screen.getByRole('dialog', { name: LEAVE_CONFIRM_HEADING });
      expect(dialog.textContent).toContain(LEAVE_CONFIRM_STATEMENT);
      expect(LEAVE_CONFIRM_STATEMENT).toMatch(/rating.*history.*kept/i);

      // The dialog's confirm action shares the trigger's label; it is the last.
      const buttons = screen.getAllByRole('button', { name: LEAVE_SQUAD_LABEL });
      await user.click(buttons[buttons.length - 1] as HTMLElement);
      await flush();

      expect(leaveSquad).toHaveBeenCalledTimes(1);
      expect(leaveSquad.mock.calls[0]?.[0]).toBe(SQUAD_ID);
      expect(onSucceeded).toHaveBeenCalledTimes(1);
    },
  );

  it('issues nothing when the confirmation is escaped', async () => {
    const user = userEvent.setup();
    const { api, leaveSquad } = fakeApi({ kind: 'success', value: undefined });
    render(<Host api={api} role="Member" state="Active" onSucceeded={() => {}} />);

    await user.click(screen.getByRole('button', { name: LEAVE_SQUAD_LABEL }));
    await user.keyboard('{Escape}');

    expect(leaveSquad).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: 'rejected-input', reason: 'conflict' } as const, LEAVE_CONFLICT],
    [{ kind: 'timeout' } as const, GENERIC_SQUADS_FAILURE],
  ])('announces %o and stays on the screen', async (result, message) => {
    const user = userEvent.setup();
    const onSucceeded = vi.fn();
    const { api } = fakeApi(result);
    render(<Host api={api} role="Member" state="Active" onSucceeded={onSucceeded} />);

    await user.click(screen.getByRole('button', { name: LEAVE_SQUAD_LABEL }));
    const buttons = screen.getAllByRole('button', { name: LEAVE_SQUAD_LABEL });
    await user.click(buttons[buttons.length - 1] as HTMLElement);
    await flush();

    expect(onSucceeded).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe(message);
  });
});
