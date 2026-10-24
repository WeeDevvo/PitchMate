import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { CallResult, SquadsApi } from '../api/squadsApi';
import {
  CLAIM_ACCEPTED_BY_LABEL,
  CLAIM_CLAIMED,
  CLAIM_LINK_EXPIRED,
  CLAIM_REVEAL_HEADING,
  CLAIMS_HEADING,
  CLAIMS_NO_GUESTS,
  COMPLETE_CLAIM_CONFIRM_HEADING,
  COMPLETE_CLAIM_LABEL,
  COMPLETE_CLAIM_SUCCEEDED,
  CREATE_CLAIM_LINK_LABEL,
  DISMISS_INVITE_REVEAL_LABEL,
  NEW_CLAIM_LINK_LABEL,
  UNDO_CLAIM_CONFIRM_HEADING,
  UNDO_CLAIM_LABEL,
  UNDO_CLAIM_SUCCEEDED,
} from '../lib/messages';
import type { GuestClaimRow, IssuedClaimLink } from '../lib/parse/guestClaim';
import type { PlayerListRow } from '../lib/playerList';
import { GuestClaims } from './GuestClaims';

/**
 * Example tests for the admins' "Link a guest to a player" list: it is for
 * admins only; each guest shows where its claim stands and offers the one next
 * step; creating a link reveals it once and re-reads the list; completing and
 * undoing go through a confirmation naming the player, issue one call, and
 * refresh the squad; and a squad with no guests says so.
 */

const SQUAD_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

function row(membershipId: string, displayName: string, overrides: Partial<PlayerListRow> = {}): PlayerListRow {
  return {
    membershipId,
    displayName,
    role: null,
    state: 'Active',
    isGuest: true,
    appearances: 3,
    ratingState: 'Established',
    isFormerPlayer: false,
    leaderboardObtained: true,
    ratingEntry: null,
    ...overrides,
  } as PlayerListRow;
}

const FRESH = '00000000-0000-4000-8000-000000000001';
const SENT = '00000000-0000-4000-8000-000000000002';
const EXPIRED = '00000000-0000-4000-8000-000000000003';
const ACCEPTED = '00000000-0000-4000-8000-000000000004';
const CLAIMED = '00000000-0000-4000-8000-000000000005';

const ROWS: readonly PlayerListRow[] = [
  row('00000000-0000-4000-8000-000000000009', 'Olu', { role: 'Owner', isGuest: false }),
  row(FRESH, 'Fresh'),
  row(SENT, 'Sent'),
  row(EXPIRED, 'Expired'),
  row(ACCEPTED, 'Accepted'),
  row(CLAIMED, 'Claimed', { role: 'Member', isGuest: false }),
  row('00000000-0000-4000-8000-000000000008', 'Left', { state: 'Inactive' }),
];

const CLAIMS: readonly GuestClaimRow[] = [
  { membershipId: SENT, status: 'LinkIssued', expiresAtMs: Date.UTC(2026, 10, 1), acceptedByName: null },
  { membershipId: EXPIRED, status: 'LinkExpired', expiresAtMs: Date.UTC(2026, 9, 1), acceptedByName: null },
  { membershipId: ACCEPTED, status: 'Accepted', expiresAtMs: Date.UTC(2026, 10, 1), acceptedByName: 'Sam Player' },
  { membershipId: CLAIMED, status: 'Claimed', expiresAtMs: null, acceptedByName: null },
];

const LINK: IssuedClaimLink = {
  claimId: '00000000-0000-4000-8000-0000000000aa',
  redeemableLink: 'https://pitch-mate.co.uk/claim/one-time-secret',
  expiresAtMs: Date.UTC(2026, 10, 1),
};

function fakeApi(claims: readonly GuestClaimRow[] = CLAIMS) {
  const listGuestClaims = vi.fn(async (): Promise<CallResult<readonly GuestClaimRow[]>> => ({
    kind: 'success',
    value: claims,
  }));
  const issueClaimLink = vi.fn(async (): Promise<CallResult<IssuedClaimLink>> => ({ kind: 'success', value: LINK }));
  const completeGuestClaim = vi.fn(async (): Promise<CallResult<void>> => ({ kind: 'success', value: undefined }));
  const reverseGuestClaim = vi.fn(async (): Promise<CallResult<void>> => ({ kind: 'success', value: undefined }));
  return {
    api: { listGuestClaims, issueClaimLink, completeGuestClaim, reverseGuestClaim } as unknown as SquadsApi,
    listGuestClaims,
    issueClaimLink,
    completeGuestClaim,
    reverseGuestClaim,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 8; round += 1) {
      await Promise.resolve();
    }
  });
}

function renderList(api: SquadsApi, onSquadChanged = vi.fn(), rows = ROWS, role: 'Owner' | 'Member' = 'Owner') {
  return render(
    <GuestClaims
      squadId={SQUAD_ID}
      api={api}
      rows={rows}
      viewerRole={role}
      viewerState="Active"
      onSquadChanged={onSquadChanged}
    />,
  );
}

function entry(name: string): HTMLElement {
  return screen.getByText(name, { selector: '.squads-guest-claims__name' }).closest('li')!;
}

afterEach(() => {
  cleanup();
});

describe('GuestClaims', () => {
  it('renders nothing, and reads nothing, for a viewer without admin authority', async () => {
    const { api, listGuestClaims } = fakeApi();
    const { container } = renderList(api, vi.fn(), ROWS, 'Member');
    await flush();

    expect(container.innerHTML).toBe('');
    expect(listGuestClaims).not.toHaveBeenCalled();
  });

  it('shows each guest where its claim stands, with the one next step', async () => {
    const { api } = fakeApi();
    renderList(api);
    await flush();

    expect(screen.getByRole('heading', { name: CLAIMS_HEADING, level: 4 })).toBeInTheDocument();
    expect(within(entry('Fresh')).getByRole('button')).toHaveTextContent(CREATE_CLAIM_LINK_LABEL);
    expect(within(entry('Sent')).getByRole('button')).toHaveTextContent(NEW_CLAIM_LINK_LABEL);
    expect(within(entry('Sent')).getByText((_, element) => element?.tagName === 'TIME')).toBeInTheDocument();
    expect(entry('Expired')).toHaveTextContent(CLAIM_LINK_EXPIRED);
    expect(entry('Accepted')).toHaveTextContent(`${CLAIM_ACCEPTED_BY_LABEL} Sam Player`);
    expect(within(entry('Accepted')).getByRole('button')).toHaveTextContent(COMPLETE_CLAIM_LABEL);
    expect(entry('Claimed')).toHaveTextContent(CLAIM_CLAIMED);
    expect(within(entry('Claimed')).getByRole('button')).toHaveTextContent(UNDO_CLAIM_LABEL);

    // The owner was never a guest, and an inactive guest is out of selection.
    expect(screen.queryByText('Olu', { selector: '.squads-guest-claims__name' })).toBeNull();
    expect(screen.queryByText('Left', { selector: '.squads-guest-claims__name' })).toBeNull();
  });

  it('reveals a new link once, re-reads the list, and drops the link when dismissed', async () => {
    const { api, issueClaimLink, listGuestClaims } = fakeApi();
    const user = userEvent.setup();
    renderList(api);
    await flush();

    await user.click(within(entry('Fresh')).getByRole('button'));
    await flush();

    expect(issueClaimLink).toHaveBeenCalledTimes(1);
    expect(issueClaimLink.mock.calls[0]!.slice(0, 2)).toEqual([SQUAD_ID, FRESH]);
    expect(listGuestClaims).toHaveBeenCalledTimes(2);
    const reveal = screen.getByRole('group', { name: CLAIM_REVEAL_HEADING });
    expect(within(reveal).getByRole('link', { name: LINK.redeemableLink })).toBeInTheDocument();

    await user.click(within(reveal).getByRole('button', { name: DISMISS_INVITE_REVEAL_LABEL }));
    expect(screen.queryByText(LINK.redeemableLink)).toBeNull();
  });

  it('completes an accepted claim after confirming who accepted, and refreshes the squad', async () => {
    const { api, completeGuestClaim } = fakeApi();
    const onSquadChanged = vi.fn();
    const user = userEvent.setup();
    renderList(api, onSquadChanged);
    await flush();

    await user.click(within(entry('Accepted')).getByRole('button'));
    const dialog = screen.getByRole('dialog', { name: COMPLETE_CLAIM_CONFIRM_HEADING });
    expect(dialog).toHaveTextContent('Sam Player');
    expect(completeGuestClaim).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: COMPLETE_CLAIM_LABEL }));
    await flush();

    expect(completeGuestClaim).toHaveBeenCalledTimes(1);
    expect(completeGuestClaim.mock.calls[0]!.slice(0, 2)).toEqual([SQUAD_ID, ACCEPTED]);
    expect(onSquadChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByText(COMPLETE_CLAIM_SUCCEEDED)).toBeInTheDocument();
  });

  it('undoes a claim only after confirming', async () => {
    const { api, reverseGuestClaim } = fakeApi();
    const user = userEvent.setup();
    renderList(api);
    await flush();

    await user.click(within(entry('Claimed')).getByRole('button'));
    const dialog = screen.getByRole('dialog', { name: UNDO_CLAIM_CONFIRM_HEADING });
    await user.keyboard('{Escape}');
    expect(reverseGuestClaim).not.toHaveBeenCalled();
    expect(dialog).not.toBeInTheDocument();

    await user.click(within(entry('Claimed')).getByRole('button'));
    await user.click(
      within(screen.getByRole('dialog', { name: UNDO_CLAIM_CONFIRM_HEADING })).getByRole('button', {
        name: UNDO_CLAIM_LABEL,
      }),
    );
    await flush();

    expect(reverseGuestClaim).toHaveBeenCalledTimes(1);
    expect(reverseGuestClaim.mock.calls[0]!.slice(0, 2)).toEqual([SQUAD_ID, CLAIMED]);
    expect(screen.getByText(UNDO_CLAIM_SUCCEEDED)).toBeInTheDocument();
  });

  it('reports the action that ran last, not an older one', async () => {
    const { api } = fakeApi();
    const user = userEvent.setup();
    renderList(api);
    await flush();

    await user.click(within(entry('Accepted')).getByRole('button'));
    await user.click(
      within(screen.getByRole('dialog', { name: COMPLETE_CLAIM_CONFIRM_HEADING })).getByRole('button', {
        name: COMPLETE_CLAIM_LABEL,
      }),
    );
    await flush();
    expect(screen.getByText(COMPLETE_CLAIM_SUCCEEDED)).toBeInTheDocument();

    await user.click(within(entry('Claimed')).getByRole('button'));
    await user.click(
      within(screen.getByRole('dialog', { name: UNDO_CLAIM_CONFIRM_HEADING })).getByRole('button', {
        name: UNDO_CLAIM_LABEL,
      }),
    );
    await flush();

    expect(screen.getByText(UNDO_CLAIM_SUCCEEDED)).toBeInTheDocument();
    expect(screen.queryByText(COMPLETE_CLAIM_SUCCEEDED)).toBeNull();
  });

  it('says so when there are no guests to link', async () => {
    const { api } = fakeApi([]);
    renderList(api, vi.fn(), [ROWS[0]!]);
    await flush();

    expect(screen.getByText(CLAIMS_NO_GUESTS)).toBeInTheDocument();
  });
});
