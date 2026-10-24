import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { CallResult, SquadsApi } from '../api/squadsApi';
import {
  GENERIC_SQUADS_FAILURE,
  PENDING_DELETION_HEADING,
  PENDING_DELETION_PURGE_LABEL,
  RESTORE_SQUAD_LABEL,
  RESTORE_SQUAD_SUCCEEDED,
  SQUADS_RETRY_LABEL,
} from '../lib/messages';
import type { PendingDeletionSquad } from '../lib/parse/squadDeletion';
import { PendingDeletionList } from './PendingDeletionList';

/**
 * Example tests for the Squads_Home's "Scheduled for deletion" list: nothing is
 * rendered when the owner has nothing pending (or the caller owns nothing);
 * each pending squad shows its purge date and a Restore control named for it;
 * a restore issues one call, re-reads both lists and announces itself; and a
 * failed read is stated with a retry rather than hidden.
 */

const PENDING: readonly PendingDeletionSquad[] = [
  {
    squadId: '00000000-0000-4000-8000-000000000001',
    name: 'Tuesday Five',
    purgeAtMs: Date.UTC(2026, 10, 1, 12),
  },
  {
    squadId: '00000000-0000-4000-8000-000000000002',
    name: 'Old Boys',
    purgeAtMs: Date.UTC(2026, 10, 20, 12),
  },
];

afterEach(() => {
  cleanup();
});

function fakeApi(
  lists: readonly CallResult<readonly PendingDeletionSquad[]>[],
  restored: CallResult<void> = { kind: 'success', value: undefined },
): {
  readonly api: SquadsApi;
  readonly listPendingDeletion: ReturnType<typeof vi.fn>;
  readonly restoreSquad: ReturnType<typeof vi.fn>;
} {
  let call = 0;
  const listPendingDeletion = vi.fn(async () => lists[Math.min(call++, lists.length - 1)]);
  const restoreSquad = vi.fn(async () => restored);
  return {
    api: { listPendingDeletion, restoreSquad } as unknown as SquadsApi,
    listPendingDeletion,
    restoreSquad,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 8; round += 1) {
      await Promise.resolve();
    }
  });
}

describe('PendingDeletionList', () => {
  it('renders nothing when nothing is pending', async () => {
    const { api } = fakeApi([{ kind: 'success', value: [] }]);
    const { container } = render(
      <PendingDeletionList api={api} authState="authenticated" onRestored={() => {}} />,
    );
    await flush();

    expect(container.innerHTML).toBe('');
  });

  it('lists each pending squad with its purge date and a Restore control named for it', async () => {
    const { api } = fakeApi([{ kind: 'success', value: PENDING }]);
    render(<PendingDeletionList api={api} authState="authenticated" onRestored={() => {}} />);
    await flush();

    const section = screen.getByRole('region', { name: PENDING_DELETION_HEADING });
    const items = within(section).getAllByRole('listitem');
    expect(items.map((item) => item.querySelector('time')?.getAttribute('datetime'))).toEqual([
      '2026-11-01T12:00:00.000Z',
      '2026-11-20T12:00:00.000Z',
    ]);
    expect(items[0]!.textContent).toContain(PENDING_DELETION_PURGE_LABEL);
    expect(
      within(section).getByRole('button', { name: `${RESTORE_SQUAD_LABEL} Old Boys` }),
    ).toBeTruthy();
  });

  it('restores with one call, re-reads both lists, and announces it', async () => {
    const { api, listPendingDeletion, restoreSquad } = fakeApi([
      { kind: 'success', value: PENDING },
      { kind: 'success', value: PENDING.slice(1) },
    ]);
    const onRestored = vi.fn();
    const user = userEvent.setup();
    render(<PendingDeletionList api={api} authState="authenticated" onRestored={onRestored} />);
    await flush();

    await user.click(screen.getByRole('button', { name: `${RESTORE_SQUAD_LABEL} Tuesday Five` }));
    await flush();

    expect(restoreSquad).toHaveBeenCalledTimes(1);
    expect(restoreSquad.mock.calls[0]![0]).toBe(PENDING[0]!.squadId);
    expect(listPendingDeletion).toHaveBeenCalledTimes(2);
    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Tuesday Five')).toBeNull();
    expect(screen.getByText(RESTORE_SQUAD_SUCCEEDED)).toBeTruthy();
  });

  it('says a restore failed and keeps the squad listed', async () => {
    const { api } = fakeApi([{ kind: 'success', value: PENDING }], { kind: 'transport-failure' });
    const user = userEvent.setup();
    render(<PendingDeletionList api={api} authState="authenticated" onRestored={() => {}} />);
    await flush();

    await user.click(screen.getByRole('button', { name: `${RESTORE_SQUAD_LABEL} Tuesday Five` }));
    await flush();

    expect(screen.getByText('Tuesday Five')).toBeTruthy();
    expect(screen.getByText(GENERIC_SQUADS_FAILURE)).toBeTruthy();
  });

  it('states a failed read with a retry that reads once more', async () => {
    const { api, listPendingDeletion } = fakeApi([
      { kind: 'transport-failure' },
      { kind: 'success', value: PENDING },
    ]);
    const user = userEvent.setup();
    render(<PendingDeletionList api={api} authState="authenticated" onRestored={() => {}} />);
    await flush();

    await user.click(screen.getByRole('button', { name: SQUADS_RETRY_LABEL }));
    await flush();

    expect(listPendingDeletion).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('reads nothing while signed out', async () => {
    const { api, listPendingDeletion } = fakeApi([{ kind: 'success', value: PENDING }]);
    const { container } = render(
      <PendingDeletionList api={api} authState="unauthenticated" onRestored={() => {}} />,
    );
    await flush();

    expect(listPendingDeletion).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe('');
  });
});
