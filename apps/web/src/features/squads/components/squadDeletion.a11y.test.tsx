import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';

import type { SquadsApi } from '../api/squadsApi';
import { DELETE_SQUAD_LABEL } from '../lib/messages';
import { THEMES, applyTheme, resetTheme } from '../testing/squadsScreenStates';
import { DeleteSquadSection } from './DeleteSquadSection';
import { PendingDeletionList } from './PendingDeletionList';

/**
 * The squad-deletion surfaces have no WCAG 2.1 A or AA violation, in either
 * theme: the owner's "Delete squad" area closed and with its typed-name
 * confirmation open, and the Squads_Home's pending list both listed and after a
 * failed read.
 *
 * jsdom computes no colour, so contrast is not measured here; the token tables
 * and their floors are pinned by the feature's own token tests.
 */

const WCAG_A_AND_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const SQUAD_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

async function expectNoWcagViolations(container: HTMLElement): Promise<void> {
  const results = await axe(container, { runOnly: { type: 'tag', values: WCAG_A_AND_AA_TAGS } });
  expect(results.passes.length + results.incomplete.length).toBeGreaterThan(0);
  expect(results).toHaveNoViolations();
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 8; round += 1) {
      await Promise.resolve();
    }
  });
}

function pendingApi(failed: boolean): SquadsApi {
  return {
    listPendingDeletion: vi.fn(async () =>
      failed
        ? { kind: 'transport-failure' }
        : {
            kind: 'success',
            value: [{ squadId: SQUAD_ID, name: 'Tuesday Five', purgeAtMs: Date.UTC(2026, 10, 1) }],
          },
    ),
    restoreSquad: vi.fn(() => new Promise(() => undefined)),
  } as unknown as SquadsApi;
}

const deletionApi = {
  deleteSquad: vi.fn(() => new Promise(() => undefined)),
  exportSquad: vi.fn(() => new Promise(() => undefined)),
} as unknown as SquadsApi;

afterEach(() => {
  cleanup();
  resetTheme();
});

describe('squad deletion accessibility', () => {
  for (const theme of THEMES) {
    it(`the owner's delete area, closed and confirming, in the ${theme} theme`, async () => {
      applyTheme(theme);
      const user = userEvent.setup();
      const { container } = render(
        <MemoryRouter>
          <DeleteSquadSection
            squadId={SQUAD_ID}
            squadName="Tuesday Five"
            api={deletionApi}
            viewerRole="Owner"
            viewerState="Active"
          />
        </MemoryRouter>,
      );

      await expectNoWcagViolations(container);

      await user.click(screen.getByRole('button', { name: DELETE_SQUAD_LABEL }));
      await expectNoWcagViolations(container);
    });

    for (const failed of [false, true]) {
      it(`the pending list ${failed ? 'after a failed read' : 'listed'}, in the ${theme} theme`, async () => {
        applyTheme(theme);
        const { container } = render(
          <PendingDeletionList
            api={pendingApi(failed)}
            authState="authenticated"
            onRestored={() => {}}
          />,
        );
        await flush();

        await expectNoWcagViolations(container);
      });
    }
  }
});
