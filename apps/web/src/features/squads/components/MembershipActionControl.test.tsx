import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { CallResult, SquadsApi } from '../api/squadsApi';
import { DEMOTION_COPY, REMOVAL_COPY } from '../lib/membershipActionCopy';
import { GENERIC_SQUADS_FAILURE } from '../lib/messages';
import type { SquadMember } from '../lib/parse/squadDetail';
import {
  DEMOTE_CALL,
  REMOVE_CALL,
  useMembershipAction,
  type MembershipActionCall,
} from '../state/useMembershipAction';
import {
  DEMOTE_TRIGGER_SELECTOR,
  MembershipActionControl,
  REMOVE_TRIGGER_SELECTOR,
  type MembershipActionKind,
} from './MembershipActionControl';

/**
 * Example tests for the row control behind remove and demote: it renders only
 * where eligible, confirms naming the player and stating what is kept, issues
 * exactly one call per confirmation, issues none on Escape, and announces the
 * success, the squad-rule refusal and the generic failure in its live region.
 */

const SQUAD_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const MEMBER: SquadMember = {
  membershipId: '9c5b94b1-35ad-49bb-b118-8e8fc24abf80',
  displayName: 'Ada',
  role: 'Admin',
  state: 'Active',
  isGuest: false,
  appearances: 4,
  ratingState: 'Established',
};

afterEach(() => {
  cleanup();
});

function fakeApi(result: CallResult<void>): {
  readonly api: SquadsApi;
  readonly removeMember: ReturnType<typeof vi.fn>;
  readonly demoteToMember: ReturnType<typeof vi.fn>;
} {
  const removeMember = vi.fn(async () => result);
  const demoteToMember = vi.fn(async () => result);
  return {
    api: { removeMember, demoteToMember } as unknown as SquadsApi,
    removeMember,
    demoteToMember,
  };
}

function Host({
  api,
  kind,
  eligible,
  onSucceeded,
}: {
  readonly api: SquadsApi;
  readonly kind: MembershipActionKind;
  readonly eligible: boolean;
  readonly onSucceeded: () => void;
}): ReactElement {
  const perform: MembershipActionCall = kind === 'remove' ? REMOVE_CALL : DEMOTE_CALL;
  const machine = useMembershipAction({ api, squadId: SQUAD_ID, perform, onSucceeded });
  return (
    <MembershipActionControl
      kind={kind}
      member={MEMBER}
      eligible={eligible}
      machine={machine}
      copy={kind === 'remove' ? REMOVAL_COPY : DEMOTION_COPY}
    />
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 8; round += 1) {
      await Promise.resolve();
    }
  });
}

describe('MembershipActionControl', () => {
  it('renders nothing for an ineligible row', () => {
    const { api } = fakeApi({ kind: 'success', value: undefined });
    const { container } = render(
      <Host api={api} kind="remove" eligible={false} onSucceeded={() => {}} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('names the player in the trigger and the confirmation, and says rating and history are kept', async () => {
    const user = userEvent.setup();
    const { api } = fakeApi({ kind: 'success', value: undefined });
    const { container } = render(
      <Host api={api} kind="remove" eligible onSucceeded={() => {}} />,
    );

    const trigger = screen.getByRole('button', { name: `${REMOVAL_COPY.label}: Ada` });
    expect(container.querySelector(REMOVE_TRIGGER_SELECTOR)).toBe(trigger);

    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: REMOVAL_COPY.heading });
    expect(dialog.textContent).toContain('Ada');
    expect(dialog.textContent).toContain(REMOVAL_COPY.statement);
  });

  it('issues no call when the confirmation is escaped, and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const { api, removeMember } = fakeApi({ kind: 'success', value: undefined });
    render(<Host api={api} kind="remove" eligible onSucceeded={() => {}} />);

    const trigger = screen.getByRole('button', { name: `${REMOVAL_COPY.label}: Ada` });
    await user.click(trigger);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(removeMember).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it('removes on confirmation with one call, then re-reads and announces success', async () => {
    const user = userEvent.setup();
    const onSucceeded = vi.fn();
    const { api, removeMember } = fakeApi({ kind: 'success', value: undefined });
    render(<Host api={api} kind="remove" eligible onSucceeded={onSucceeded} />);

    await user.click(screen.getByRole('button', { name: `${REMOVAL_COPY.label}: Ada` }));
    await user.click(screen.getByRole('button', { name: REMOVAL_COPY.label }));
    await flush();

    expect(removeMember).toHaveBeenCalledTimes(1);
    expect(removeMember.mock.calls[0]?.slice(0, 2)).toEqual([SQUAD_ID, MEMBER.membershipId]);
    expect(onSucceeded).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toBe(REMOVAL_COPY.succeeded);
  });

  it('demotes through the demote call, never the remove call', async () => {
    const user = userEvent.setup();
    const { api, removeMember, demoteToMember } = fakeApi({
      kind: 'success',
      value: undefined,
    });
    const { container } = render(
      <Host api={api} kind="demote" eligible onSucceeded={() => {}} />,
    );

    expect(container.querySelector(DEMOTE_TRIGGER_SELECTOR)).not.toBeNull();
    await user.click(screen.getByRole('button', { name: `${DEMOTION_COPY.label}: Ada` }));
    await user.click(screen.getByRole('button', { name: DEMOTION_COPY.label }));
    await flush();

    expect(demoteToMember).toHaveBeenCalledTimes(1);
    expect(removeMember).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe(DEMOTION_COPY.succeeded);
  });

  it.each([
    [{ kind: 'rejected-input', reason: 'conflict' } as const, REMOVAL_COPY.conflict],
    [{ kind: 'rejected-input', reason: 'validation' } as const, GENERIC_SQUADS_FAILURE],
    [{ kind: 'not-found' } as const, GENERIC_SQUADS_FAILURE],
    [{ kind: 'transport-failure' } as const, GENERIC_SQUADS_FAILURE],
  ])('announces %o as its fixed message and does not re-read', async (result, message) => {
    const user = userEvent.setup();
    const onSucceeded = vi.fn();
    const { api } = fakeApi(result);
    render(<Host api={api} kind="remove" eligible onSucceeded={onSucceeded} />);

    await user.click(screen.getByRole('button', { name: `${REMOVAL_COPY.label}: Ada` }));
    await user.click(screen.getByRole('button', { name: REMOVAL_COPY.label }));
    await flush();

    expect(onSucceeded).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe(message);
  });
});
