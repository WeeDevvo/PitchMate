import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AuthProvider, type AuthState } from '../../auth';
import type { SquadsApi } from '../api/squadsApi';
import type { GuestClaimRow } from '../lib/parse/guestClaim';
import type { PlayerListRow } from '../lib/playerList';
import { CLAIM_LANDING_ROUTE, claimLandingPath } from '../lib/routePaths';
import { ClaimLandingScreen } from '../screens/ClaimLandingScreen';
import { THEMES, applyTheme, resetTheme, sessionManagerReporting } from '../testing/squadsScreenStates';
import { GuestClaims } from './GuestClaims';

/**
 * The guest-claim surfaces have no WCAG 2.1 A or AA violation, in either theme:
 * the admins' claim list with every status showing, with a link revealed, and
 * with a confirmation open; and the Claim_Landing_Route signed out, ready to
 * accept, and with an unusable link.
 *
 * jsdom computes no colour, so contrast is not measured here; the token tables
 * and their floors are pinned by the feature's own token tests.
 */

const WCAG_A_AND_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

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

function guest(membershipId: string, displayName: string, overrides: Partial<PlayerListRow> = {}): PlayerListRow {
  return {
    membershipId,
    displayName,
    role: null,
    state: 'Active',
    isGuest: true,
    appearances: 0,
    ratingState: null,
    isFormerPlayer: false,
    leaderboardObtained: true,
    ratingEntry: null,
    ...overrides,
  } as PlayerListRow;
}

const ROWS: readonly PlayerListRow[] = [
  guest('00000000-0000-4000-8000-000000000001', 'Fresh'),
  guest('00000000-0000-4000-8000-000000000002', 'Sent'),
  guest('00000000-0000-4000-8000-000000000003', 'Accepted'),
  guest('00000000-0000-4000-8000-000000000004', 'Claimed', { isGuest: false, role: 'Member' }),
];

const CLAIMS: readonly GuestClaimRow[] = [
  { membershipId: ROWS[1]!.membershipId, status: 'LinkIssued', expiresAtMs: Date.UTC(2026, 10, 1), acceptedByName: null },
  { membershipId: ROWS[2]!.membershipId, status: 'Accepted', expiresAtMs: Date.UTC(2026, 10, 1), acceptedByName: 'Sam' },
  { membershipId: ROWS[3]!.membershipId, status: 'Claimed', expiresAtMs: null, acceptedByName: null },
];

const claimsApi = {
  listGuestClaims: vi.fn(async () => ({ kind: 'success', value: CLAIMS })),
  issueClaimLink: vi.fn(async () => ({
    kind: 'success',
    value: {
      claimId: '00000000-0000-4000-8000-0000000000aa',
      redeemableLink: 'https://pitch-mate.co.uk/claim/secret',
      expiresAtMs: Date.UTC(2026, 10, 1),
    },
  })),
  completeGuestClaim: vi.fn(() => new Promise(() => undefined)),
  reverseGuestClaim: vi.fn(() => new Promise(() => undefined)),
} as unknown as SquadsApi;

function landingApi(unusable: boolean): SquadsApi {
  return {
    previewGuestClaim: vi.fn(async () =>
      unusable
        ? { kind: 'rejected-input', reason: 'conflict' }
        : { kind: 'success', value: { squadName: 'Tuesday Five', guestDisplayName: 'Big Dave' } },
    ),
    acceptGuestClaim: vi.fn(() => new Promise(() => undefined)),
  } as unknown as SquadsApi;
}

function renderLanding(api: SquadsApi, authState: AuthState) {
  return render(
    <AuthProvider manager={sessionManagerReporting(authState)}>
      <MemoryRouter initialEntries={[claimLandingPath('the-secret')]}>
        <Routes>
          <Route path={CLAIM_LANDING_ROUTE} element={<ClaimLandingScreen api={api} />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

afterEach(() => {
  cleanup();
  resetTheme();
});

describe('guest claim accessibility', () => {
  for (const theme of THEMES) {
    it(`the claim list, with a link revealed and a confirmation open, in the ${theme} theme`, async () => {
      applyTheme(theme);
      const user = userEvent.setup();
      // The list's h4 sits under an h3 in Administration; the wrapper gives it that outline.
      const { container } = render(
        <section aria-labelledby="guests">
          <h3 id="guests">Guests</h3>
          <GuestClaims
            squadId="3f2504e0-4f89-11d3-9a0c-0305e82c3301"
            api={claimsApi}
            rows={ROWS}
            viewerRole="Owner"
            viewerState="Active"
            onSquadChanged={() => {}}
          />
        </section>,
      );
      await flush();
      await expectNoWcagViolations(container);

      const fresh = screen.getByText('Fresh', { selector: '.squads-guest-claims__name' }).closest('li')!;
      await user.click(within(fresh).getByRole('button'));
      await flush();
      await expectNoWcagViolations(container);

      const accepted = screen.getByText('Accepted', { selector: '.squads-guest-claims__name' }).closest('li')!;
      await user.click(within(accepted).getByRole('button'));
      await expectNoWcagViolations(container);
    });

    for (const [name, api, authState] of [
      ['signed out', landingApi(false), 'unauthenticated'],
      ['ready to accept', landingApi(false), 'authenticated'],
      ['with an unusable link', landingApi(true), 'authenticated'],
    ] as const) {
      it(`the claim landing ${name}, in the ${theme} theme`, async () => {
        applyTheme(theme);
        const { container } = renderLanding(api, authState);
        await flush();

        await expectNoWcagViolations(container);
      });
    }
  }
});
