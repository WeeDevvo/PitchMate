import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { CallResult, SquadsApi } from '../api/squadsApi';
import {
  GENERIC_SQUADS_FAILURE,
  OWNERSHIP_SECTION_HEADING,
  TRANSFER_OWNERSHIP_CONFIRM_HEADING,
  TRANSFER_OWNERSHIP_CONFIRM_STATEMENT,
  TRANSFER_OWNERSHIP_LABEL,
  TRANSFER_OWNERSHIP_NO_CANDIDATES,
  TRANSFER_OWNERSHIP_SUCCEEDED,
  TRANSFER_OWNERSHIP_TARGET_LABEL,
} from '../lib/messages';
import { ANONYMISED_PLACEHOLDER, type PlayerListRow } from '../lib/playerList';
import {
  OWNERSHIP_TRANSFER_TRIGGER_SELECTOR,
  OwnershipTransfer,
} from './OwnershipTransfer';

/**
 * Example tests for the owner's ownership transfer: it is the owner's alone;
 * the select offers exactly the active registered members other than the owner;
 * nothing is issued until a member is chosen and confirmed; the confirmation
 * names the player and says the owner becomes an admin; and the success is
 * still announced after the re-read makes the caller an admin.
 */

const SQUAD_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

function row(
  membershipId: string,
  displayName: string,
  overrides: Partial<PlayerListRow> = {},
): PlayerListRow {
  return {
    membershipId,
    displayName,
    role: 'Member',
    state: 'Active',
    isGuest: false,
    appearances: 3,
    ratingState: 'Established',
    isFormerPlayer: false,
    leaderboardObtained: true,
    ratingEntry: null,
    ...overrides,
  } as PlayerListRow;
}

const ROWS: readonly PlayerListRow[] = [
  row('00000000-0000-4000-8000-000000000001', 'Olu', { role: 'Owner' }),
  row('00000000-0000-4000-8000-000000000002', 'Ada'),
  row('00000000-0000-4000-8000-000000000003', 'Bea', { role: 'Admin' }),
  row('00000000-0000-4000-8000-000000000004', 'Dave', { role: null, isGuest: true }),
  row('00000000-0000-4000-8000-000000000005', 'Kay', { state: 'Inactive' }),
  row('00000000-0000-4000-8000-000000000006', ANONYMISED_PLACEHOLDER),
];

afterEach(() => {
  cleanup();
});

function fakeApi(result: CallResult<void>): {
  readonly api: SquadsApi;
  readonly transferOwnership: ReturnType<typeof vi.fn>;
} {
  const transferOwnership = vi.fn(async () => result);
  return { api: { transferOwnership } as unknown as SquadsApi, transferOwnership };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 8; round += 1) {
      await Promise.resolve();
    }
  });
}

describe('OwnershipTransfer', () => {
  it('renders nothing for an admin who is not the owner', () => {
    const { api } = fakeApi({ kind: 'success', value: undefined });
    const { container } = render(
      <OwnershipTransfer
        squadId={SQUAD_ID}
        api={api}
        rows={ROWS}
        viewerRole="Admin"
        viewerState="Active"
        onSquadChanged={() => {}}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('offers the owner exactly the active registered members, in name order', () => {
    const { api } = fakeApi({ kind: 'success', value: undefined });
    render(
      <OwnershipTransfer
        squadId={SQUAD_ID}
        api={api}
        rows={ROWS}
        viewerRole="Owner"
        viewerState="Active"
        onSquadChanged={() => {}}
      />,
    );

    expect(screen.getByRole('heading', { name: OWNERSHIP_SECTION_HEADING })).toBeTruthy();
    const select = screen.getByLabelText(TRANSFER_OWNERSHIP_TARGET_LABEL);
    const names = Array.from((select as HTMLSelectElement).options)
      .filter((option) => option.value !== '')
      .map((option) => option.textContent);
    expect(names).toEqual(['Ada', 'Bea']);
  });

  it('says so when nobody can take ownership', () => {
    const { api } = fakeApi({ kind: 'success', value: undefined });
    render(
      <OwnershipTransfer
        squadId={SQUAD_ID}
        api={api}
        rows={[ROWS[0] as PlayerListRow]}
        viewerRole="Owner"
        viewerState="Active"
        onSquadChanged={() => {}}
      />,
    );
    expect(screen.getByText(TRANSFER_OWNERSHIP_NO_CANDIDATES)).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('opens nothing and issues nothing until a member is chosen', async () => {
    const user = userEvent.setup();
    const { api, transferOwnership } = fakeApi({ kind: 'success', value: undefined });
    const { container } = render(
      <OwnershipTransfer
        squadId={SQUAD_ID}
        api={api}
        rows={ROWS}
        viewerRole="Owner"
        viewerState="Active"
        onSquadChanged={() => {}}
      />,
    );

    const trigger = container.querySelector(OWNERSHIP_TRANSFER_TRIGGER_SELECTOR);
    expect(trigger?.getAttribute('aria-disabled')).toBe('true');
    await user.click(trigger as HTMLElement);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(transferOwnership).not.toHaveBeenCalled();
  });

  it('transfers to the chosen member after confirming, and keeps announcing once the caller is an admin', async () => {
    const user = userEvent.setup();
    const onSquadChanged = vi.fn();
    const { api, transferOwnership } = fakeApi({ kind: 'success', value: undefined });
    const { rerender } = render(
      <OwnershipTransfer
        squadId={SQUAD_ID}
        api={api}
        rows={ROWS}
        viewerRole="Owner"
        viewerState="Active"
        onSquadChanged={onSquadChanged}
      />,
    );

    await user.selectOptions(
      screen.getByLabelText(TRANSFER_OWNERSHIP_TARGET_LABEL),
      '00000000-0000-4000-8000-000000000002',
    );
    await user.click(screen.getByRole('button', { name: TRANSFER_OWNERSHIP_LABEL }));

    const dialog = screen.getByRole('dialog', { name: TRANSFER_OWNERSHIP_CONFIRM_HEADING });
    expect(dialog.textContent).toContain('Ada');
    expect(dialog.textContent).toContain(TRANSFER_OWNERSHIP_CONFIRM_STATEMENT);

    const confirms = screen.getAllByRole('button', { name: TRANSFER_OWNERSHIP_LABEL });
    await user.click(confirms[confirms.length - 1] as HTMLElement);
    await flush();

    expect(transferOwnership).toHaveBeenCalledTimes(1);
    expect(transferOwnership.mock.calls[0]?.slice(0, 2)).toEqual([
      SQUAD_ID,
      '00000000-0000-4000-8000-000000000002',
    ]);
    expect(onSquadChanged).toHaveBeenCalledTimes(1);

    // The re-read makes the caller an admin; the announcement survives it.
    rerender(
      <OwnershipTransfer
        squadId={SQUAD_ID}
        api={api}
        rows={ROWS}
        viewerRole="Admin"
        viewerState="Active"
        onSquadChanged={onSquadChanged}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe(TRANSFER_OWNERSHIP_SUCCEEDED);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('announces a failure and does not re-read', async () => {
    const user = userEvent.setup();
    const onSquadChanged = vi.fn();
    const { api } = fakeApi({ kind: 'transport-failure' });
    render(
      <OwnershipTransfer
        squadId={SQUAD_ID}
        api={api}
        rows={ROWS}
        viewerRole="Owner"
        viewerState="Active"
        onSquadChanged={onSquadChanged}
      />,
    );

    await user.selectOptions(
      screen.getByLabelText(TRANSFER_OWNERSHIP_TARGET_LABEL),
      '00000000-0000-4000-8000-000000000003',
    );
    await user.click(screen.getByRole('button', { name: TRANSFER_OWNERSHIP_LABEL }));
    const confirms = screen.getAllByRole('button', { name: TRANSFER_OWNERSHIP_LABEL });
    await user.click(confirms[confirms.length - 1] as HTMLElement);
    await flush();

    expect(onSquadChanged).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe(GENERIC_SQUADS_FAILURE);
  });
});
