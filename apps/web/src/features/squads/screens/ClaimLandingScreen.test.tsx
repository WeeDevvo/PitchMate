import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AuthProvider, redirectCandidateFromSearch, type AuthState } from '../../auth';
import type { CallResult, SquadsApi } from '../api/squadsApi';
import {
  ACCEPT_CLAIM_LABEL,
  CLAIM_ACCEPTED_STATEMENT,
  CLAIM_LINK_INCOMPLETE,
  CLAIM_LOG_IN_LABEL,
  CLAIM_SIGN_IN_INSTRUCTION,
  CLAIM_SIGN_UP_LABEL,
  CLAIM_UNUSABLE,
  GENERIC_SQUADS_FAILURE,
  INVITE_REDEEM_RETRY_LABEL,
} from '../lib/messages';
import type { AcceptedGuestClaim, GuestClaimPreview } from '../lib/parse/guestClaim';
import { CLAIM_LANDING_ROUTE, claimLandingPath } from '../lib/routePaths';
import { sessionManagerReporting } from '../testing/squadsScreenStates';
import { ClaimLandingScreen } from './ClaimLandingScreen';

/**
 * The Claim_Landing_Route (ADR 0003): a signed-out visitor is handed to log in or
 * sign up with the path carried back; a signed-in player sees what the link is
 * for and accepts it with one call; an unusable link, or a player already in the
 * squad, gets the one unusable message; a failed read offers a retry; and a path
 * with no readable secret issues nothing. The secret travels in request bodies
 * and the redirect value only, never in the rendered text.
 */

const PREVIEW: GuestClaimPreview = { squadName: 'Tuesday Five', guestDisplayName: 'Big Dave' };

function fakeApi({
  preview = { kind: 'success', value: PREVIEW },
  accepted = { kind: 'success', value: { squadName: 'Tuesday Five' } },
}: {
  readonly preview?: CallResult<GuestClaimPreview> | Promise<CallResult<GuestClaimPreview>>;
  readonly accepted?: CallResult<AcceptedGuestClaim>;
} = {}) {
  const previewGuestClaim = vi.fn<(secret: string) => Promise<CallResult<GuestClaimPreview>>>(() =>
    Promise.resolve(preview),
  );
  const acceptGuestClaim = vi.fn<(secret: string) => Promise<CallResult<AcceptedGuestClaim>>>(
    async () => accepted,
  );
  return {
    api: { previewGuestClaim, acceptGuestClaim } as unknown as SquadsApi,
    previewGuestClaim,
    acceptGuestClaim,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 8; round += 1) {
      await Promise.resolve();
    }
  });
}

function renderAt(path: string, api: SquadsApi, authState: AuthState = 'authenticated') {
  return render(
    <AuthProvider manager={sessionManagerReporting(authState)}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={CLAIM_LANDING_ROUTE} element={<ClaimLandingScreen api={api} />} />
          <Route path="*" element={<ClaimLandingScreen api={api} />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('ClaimLandingScreen', () => {
  it('shows what the link is for, and accepts it with one call', async () => {
    const { api, previewGuestClaim, acceptGuestClaim } = fakeApi();
    const user = userEvent.setup();
    renderAt(claimLandingPath('the-secret'), api);
    await flush();

    expect(previewGuestClaim).toHaveBeenCalledTimes(1);
    expect(previewGuestClaim.mock.calls[0]![0]).toBe('the-secret');
    expect(screen.getByText('Big Dave')).toBeInTheDocument();
    expect(screen.getByText('Tuesday Five')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: ACCEPT_CLAIM_LABEL }));
    await flush();

    expect(acceptGuestClaim).toHaveBeenCalledTimes(1);
    expect(acceptGuestClaim.mock.calls[0]![0]).toBe('the-secret');
    expect(screen.getByText(CLAIM_ACCEPTED_STATEMENT)).toBeInTheDocument();
  });

  it('hands a signed-out visitor to log in or sign up, carrying the path back, and reads nothing', async () => {
    const { api, previewGuestClaim } = fakeApi();
    renderAt(claimLandingPath('the-secret'), api, 'unauthenticated');
    await flush();

    expect(previewGuestClaim).not.toHaveBeenCalled();
    expect(screen.getByText(CLAIM_SIGN_IN_INSTRUCTION)).toBeInTheDocument();
    for (const label of [CLAIM_LOG_IN_LABEL, CLAIM_SIGN_UP_LABEL]) {
      const href = screen.getByRole('link', { name: label }).getAttribute('href') ?? '';
      expect(redirectCandidateFromSearch(href.slice(href.indexOf('?')))).toBe(
        claimLandingPath('the-secret'),
      );
    }
  });

  it('gives an unusable link the one unusable message', async () => {
    const { api } = fakeApi({ preview: { kind: 'rejected-input', reason: 'conflict' } });
    renderAt(claimLandingPath('the-secret'), api);
    await flush();

    expect(screen.getByText(CLAIM_UNUSABLE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ACCEPT_CLAIM_LABEL })).toBeNull();
  });

  it('gives a player already in the squad the same message when they accept', async () => {
    const { api } = fakeApi({ accepted: { kind: 'rejected-input', reason: 'conflict' } });
    const user = userEvent.setup();
    renderAt(claimLandingPath('the-secret'), api);
    await flush();

    await user.click(screen.getByRole('button', { name: ACCEPT_CLAIM_LABEL }));
    await flush();

    expect(screen.getByText(CLAIM_UNUSABLE)).toBeInTheDocument();
  });

  it('offers a retry after a failed read, which reads once more', async () => {
    const outcomes: CallResult<GuestClaimPreview>[] = [
      { kind: 'transport-failure' },
      { kind: 'success', value: PREVIEW },
    ];
    const previewGuestClaim = vi.fn(async () => outcomes.shift()!);
    const api = { previewGuestClaim } as unknown as SquadsApi;
    const user = userEvent.setup();
    renderAt(claimLandingPath('the-secret'), api);
    await flush();

    expect(screen.getByText(GENERIC_SQUADS_FAILURE)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: INVITE_REDEEM_RETRY_LABEL }));
    await flush();

    expect(previewGuestClaim).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: ACCEPT_CLAIM_LABEL })).toBeInTheDocument();
  });

  it('issues nothing, and says the link is incomplete, when the path carries no secret', async () => {
    const { api, previewGuestClaim } = fakeApi();
    renderAt('/claim/', api);
    await flush();

    expect(previewGuestClaim).not.toHaveBeenCalled();
    expect(screen.getByText(CLAIM_LINK_INCOMPLETE)).toBeInTheDocument();
  });

  it(
    'carries any secret into the preview body exactly, and never renders it',
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.stringMatching(/^[A-Za-z0-9_-]{8,64}$/), async (secret) => {
          const { api, previewGuestClaim } = fakeApi();
          const { container } = renderAt(claimLandingPath(secret), api);
          await flush();

          expect(previewGuestClaim.mock.calls.map((call) => call[0])).toEqual([secret]);
          expect(container.textContent ?? '').not.toContain(secret);
          cleanup();
        }),
        { numRuns: 100 },
      );
    },
    15_000,
  );
});
