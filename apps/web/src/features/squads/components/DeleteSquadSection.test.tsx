import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { HOME_ROUTE } from '../../app-shell';
import type { CallResult, SquadsApi } from '../api/squadsApi';
import {
  DELETE_CONFIRM_HEADING,
  DELETE_CONFIRM_NAME_LABEL,
  DELETE_SECTION_HEADING,
  DELETE_SQUAD_LABEL,
  EXPORT_SQUAD_LABEL,
  EXPORT_SQUAD_SUCCEEDED,
  GENERIC_SQUADS_FAILURE,
} from '../lib/messages';
import type { SquadDeletion } from '../lib/parse/squadDeletion';
import type { SquadExportFile } from '../lib/parse/squadExport';
import type { MembershipState, SquadRole } from '../lib/wireEnums';
import { DeleteSquadSection } from './DeleteSquadSection';

/**
 * Example tests for the owner's "Delete squad" area: it is the owner's alone;
 * the export downloads a JSON file named after the squad; the delete control in
 * the confirmation does nothing until the squad's name is typed; a confirmed
 * deletion issues one call and leaves for the Squads_Home; and a failed one says
 * so and stays.
 */

const SQUAD_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const SQUAD_NAME = 'Tuesday Five';
const HOME_MARKER = 'squads home';

interface FakeApi {
  readonly api: SquadsApi;
  readonly deleteSquad: ReturnType<typeof vi.fn>;
  readonly exportSquad: ReturnType<typeof vi.fn>;
}

function fakeApi({
  deletion = { kind: 'success', value: { purgeAtMs: Date.UTC(2026, 10, 22) } },
  exported = {
    kind: 'success',
    value: { squadId: SQUAD_ID, name: SQUAD_NAME, body: { squadId: SQUAD_ID } },
  },
}: {
  readonly deletion?: CallResult<SquadDeletion>;
  readonly exported?: CallResult<SquadExportFile>;
} = {}): FakeApi {
  const deleteSquad = vi.fn(async () => deletion);
  const exportSquad = vi.fn(async () => exported);
  return {
    api: { deleteSquad, exportSquad } as unknown as SquadsApi,
    deleteSquad,
    exportSquad,
  };
}

function renderSection(
  api: SquadsApi,
  viewerRole: SquadRole | null = 'Owner',
  viewerState: MembershipState | null = 'Active',
): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/squad']}>
      <Routes>
        <Route
          path="/squad"
          element={
            <DeleteSquadSection
              squadId={SQUAD_ID}
              squadName={SQUAD_NAME}
              api={api}
              viewerRole={viewerRole}
              viewerState={viewerState}
            />
          }
        />
        <Route path={HOME_ROUTE} element={<p>{HOME_MARKER}</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 8; round += 1) {
      await Promise.resolve();
    }
  });
}

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // jsdom has no object URLs; the download is observed through these.
  createObjectURL = vi.fn(() => 'blob:export');
  revokeObjectURL = vi.fn();
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DeleteSquadSection', () => {
  it('renders nothing for an admin who is not the owner', () => {
    const { container } = renderSection(fakeApi().api, 'Admin');
    expect(container.innerHTML).toBe('');
  });

  it('offers the owner an export and a delete control under its own heading', () => {
    renderSection(fakeApi().api);

    expect(screen.getByRole('heading', { name: DELETE_SECTION_HEADING })).toBeTruthy();
    expect(screen.getByRole('button', { name: EXPORT_SQUAD_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: DELETE_SQUAD_LABEL })).toBeTruthy();
  });

  it('downloads the export as a JSON file named after the squad', async () => {
    const { api, exportSquad } = fakeApi();
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.download);
    });
    const user = userEvent.setup();
    renderSection(api);

    await user.click(screen.getByRole('button', { name: EXPORT_SQUAD_LABEL }));
    await flush();

    expect(exportSquad).toHaveBeenCalledTimes(1);
    expect(clicked).toEqual(['Tuesday-Five-export.json']);
    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe('application/json');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export');
    expect(screen.getByText(EXPORT_SQUAD_SUCCEEDED)).toBeTruthy();
  });

  it('holds the delete back until the squad name is typed, then deletes once and goes home', async () => {
    const { api, deleteSquad } = fakeApi();
    const user = userEvent.setup();
    renderSection(api);

    await user.click(screen.getByRole('button', { name: DELETE_SQUAD_LABEL }));
    const dialog = screen.getByRole('dialog', { name: DELETE_CONFIRM_HEADING });
    const confirm = dialog.querySelector<HTMLButtonElement>(
      '.squads-surface__action--primary',
    )!;

    // Nothing typed, then the wrong name, then the wrong case: no call.
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    await user.click(confirm);
    await user.type(screen.getByLabelText(DELETE_CONFIRM_NAME_LABEL), 'tuesday five');
    await user.click(confirm);
    expect(deleteSquad).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText(DELETE_CONFIRM_NAME_LABEL));
    await user.type(screen.getByLabelText(DELETE_CONFIRM_NAME_LABEL), ` ${SQUAD_NAME} `);
    expect(confirm.getAttribute('aria-disabled')).toBeNull();
    await user.click(confirm);
    await flush();

    expect(deleteSquad).toHaveBeenCalledTimes(1);
    expect(deleteSquad.mock.calls[0]![0]).toBe(SQUAD_ID);
    expect(screen.getByText(HOME_MARKER)).toBeTruthy();
  });

  it('stays and says so when the deletion fails', async () => {
    const { api } = fakeApi({ deletion: { kind: 'transport-failure' } });
    const user = userEvent.setup();
    renderSection(api);

    await user.click(screen.getByRole('button', { name: DELETE_SQUAD_LABEL }));
    await user.type(screen.getByLabelText(DELETE_CONFIRM_NAME_LABEL), SQUAD_NAME);
    await user.click(
      screen
        .getByRole('dialog', { name: DELETE_CONFIRM_HEADING })
        .querySelector<HTMLButtonElement>('.squads-surface__action--primary')!,
    );
    await flush();

    expect(screen.queryByText(HOME_MARKER)).toBeNull();
    expect(screen.getByText(GENERIC_SQUADS_FAILURE)).toBeTruthy();
  });
});
