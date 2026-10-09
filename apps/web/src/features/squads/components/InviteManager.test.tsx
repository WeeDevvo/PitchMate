/**
 * Worked examples for the Invite_Manager and the Invite_Reveal (task 12.1).
 *
 * The quantified claims about these two surfaces are Properties 28 and 29, and
 * they live in their own files (tasks 12.2 and 12.3). What is pinned here is what
 * a property would only obscure: the listing as a rendered surface, the two halves
 * of the validity choice as submitted bodies, the reveal's copy and dismissal, and
 * the confirmation standing between a revoke control and a `RevokeInvite` call.
 *
 * One seam is supplied and nothing else is stubbed: a `SquadsApi` answering with
 * settled `CallResult` values. The component runs the real
 * `state/useInviteManager.ts`, so "exactly one further list after a success" is
 * observed as a call count rather than as a spy on an internal.
 *
 * Requirements: 11.2, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 11.12
 */
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { CallResult, GenerateInviteRequest, SquadsApi } from '../api/squadsApi';
import {
  CANCEL_LABEL,
  COPY_INVITE_LINK_LABEL,
  DISMISS_INVITE_REVEAL_LABEL,
  GENERATE_INVITE_HEADING,
  GENERATE_INVITE_SUBMIT_LABEL,
  GENERIC_SQUADS_FAILURE,
  INVITE_ACTIVE_STATE_LABEL,
  INVITE_EXPIRED_STATE_LABEL,
  INVITE_LINK_COPIED,
  INVITE_NEVER_EXPIRES_LABEL,
  INVITE_REVOKED_STATE_LABEL,
  INVITE_SHOWN_ONCE,
  INVITE_VALIDITY_LABEL,
  REVOKE_INVITE_CONFIRM_LABEL,
  REVOKE_INVITE_LABEL,
} from '../lib/messages';
import type { GeneratedInvite } from '../lib/parse/generatedInvite';
import type { InviteSummary } from '../lib/parse/inviteSummary';
import {
  formatInviteInstant,
  inviteInstantAttribute,
} from '../lib/inviteInstant';
import {
  INVITE_CREATED_SELECTOR,
  INVITE_ENTRY_ATTRIBUTE,
  INVITE_ENTRY_SELECTOR,
  INVITE_EXPIRES_SELECTOR,
  INVITE_NEVER_EXPIRES_SELECTOR,
  INVITE_REVOKE_SELECTOR,
  INVITE_STATE_LABEL_SELECTOR,
  InviteManager,
} from './InviteManager';
import {
  INVITE_REVEAL_CODE_SELECTOR,
  INVITE_REVEAL_LINK_SELECTOR,
  INVITE_REVEAL_SELECTOR,
} from './InviteReveal';

const SQUAD_ID = '9f1b3c1e-6d2a-4c6f-9b57-2c1a0d5e7f31';

const ACTIVE_INVITE_ID = '11111111-1111-4111-8111-111111111111';
const REVOKED_INVITE_ID = '22222222-2222-4222-8222-222222222222';
const EXPIRED_INVITE_ID = '33333333-3333-4333-8333-333333333333';

/** An expiring, live invite — the only kind that carries a revoke control. */
const ACTIVE_INVITE: InviteSummary = {
  inviteId: ACTIVE_INVITE_ID,
  state: 'Active',
  createdAtMs: Date.UTC(2025, 2, 1, 10, 0, 0),
  createdBy: 'admin',
  expiresAtMs: Date.UTC(2025, 2, 8, 10, 0, 0),
};

/** A non-expiring invite that has been revoked. Same creation millisecond as… */
const REVOKED_INVITE: InviteSummary = {
  inviteId: REVOKED_INVITE_ID,
  state: 'Revoked',
  createdAtMs: Date.UTC(2025, 2, 5, 9, 30, 0),
  createdBy: null,
  expiresAtMs: null,
};

/** …this one, so the identity tie-break decides which of the two sorts first. */
const EXPIRED_INVITE: InviteSummary = {
  inviteId: EXPIRED_INVITE_ID,
  state: 'Expired',
  createdAtMs: Date.UTC(2025, 2, 5, 9, 30, 0),
  createdBy: 'admin',
  expiresAtMs: Date.UTC(2025, 2, 6, 9, 30, 0),
};

const LISTING: readonly InviteSummary[] = [ACTIVE_INVITE, EXPIRED_INVITE, REVOKED_INVITE];

/** Creation instant descending, ties broken by invite identity ascending. */
const EXPECTED_ORDER: readonly string[] = [
  REVOKED_INVITE_ID,
  EXPIRED_INVITE_ID,
  ACTIVE_INVITE_ID,
];

const GENERATED: GeneratedInvite = {
  inviteId: '44444444-4444-4444-8444-444444444444',
  redeemableLink: '/join/qO1x9-TOKEN-2f7',
  code: 'PM-4K7Q2',
  expiresAtMs: Date.UTC(2025, 2, 8, 10, 0, 0),
};

// --- the seam ----------------------------------------------------------------

/** A method the component must not call in a given example. */
function unavailable(name: string): () => never {
  return () => {
    throw new Error(`${name} must not be called`);
  };
}

/** What the fake Squads_Api was asked to do. */
interface ApiCallLog {
  listCalls: number;
  readonly generateCommands: GenerateInviteRequest[];
  readonly revokedInviteIds: string[];
}

interface FakeApiOptions {
  readonly listOutcomes: readonly CallResult<readonly InviteSummary[]>[];
  readonly generateOutcome?: CallResult<GeneratedInvite>;
  readonly revokeOutcome?: CallResult<void>;
}

/**
 * A Squads_Api answering the three invite calls and refusing the rest, so a call
 * this surface has no business making fails loudly.
 */
function createFakeApi(options: FakeApiOptions): {
  readonly api: SquadsApi;
  readonly log: ApiCallLog;
} {
  const log: ApiCallLog = { listCalls: 0, generateCommands: [], revokedInviteIds: [] };
  const { listOutcomes, generateOutcome, revokeOutcome } = options;

  const api: SquadsApi = {
    listInvites: () => {
      const index = Math.min(log.listCalls, listOutcomes.length - 1);
      log.listCalls += 1;
      return Promise.resolve(listOutcomes[index]);
    },
    generateInvite: (_squadId, command) => {
      log.generateCommands.push(command);
      if (generateOutcome === undefined) {
        throw new Error('generateInvite must not be called');
      }
      return Promise.resolve(generateOutcome);
    },
    revokeInvite: (_squadId, inviteId) => {
      log.revokedInviteIds.push(inviteId);
      if (revokeOutcome === undefined) {
        throw new Error('revokeInvite must not be called');
      }
      return Promise.resolve(revokeOutcome);
    },
    listMySquads: unavailable('listMySquads'),
    getSquad: unavailable('getSquad'),
    getDisplayRatingLeaderboard: unavailable('getDisplayRatingLeaderboard'),
    createSquad: unavailable('createSquad'),
    redeemInvite: unavailable('redeemInvite'),
    previewInvite: unavailable('previewInvite'),
    createGuest: unavailable('createGuest'),
    editGuest: unavailable('editGuest'),
    promoteToAdmin: unavailable('promoteToAdmin'),
    getFeatureFlags: unavailable('getFeatureFlags'),
    setFeatureFlag: unavailable('setFeatureFlag'),
  };

  return { api, log };
}

/** Mounts the manager and waits for its one `ListInvites` to settle. */
async function mountManager(options: FakeApiOptions): Promise<{
  readonly log: ApiCallLog;
  readonly user: ReturnType<typeof userEvent.setup>;
}> {
  const { api, log } = createFakeApi(options);
  const user = userEvent.setup();

  render(<InviteManager api={api} squadId={SQUAD_ID} />);
  await waitFor(() => {
    expect(log.listCalls).toBe(1);
  });

  return { log, user };
}

/** The rendered entries, in document order. */
function renderedEntries(): readonly HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(INVITE_ENTRY_SELECTOR));
}

/** Opens the generator and submits whatever validity is selected. */
async function submitGenerator(
  user: ReturnType<typeof userEvent.setup>,
  choiceLabel?: string,
): Promise<void> {
  await user.click(screen.getByRole('button', { name: GENERATE_INVITE_HEADING }));

  if (choiceLabel !== undefined) {
    await user.selectOptions(
      screen.getByLabelText(INVITE_VALIDITY_LABEL),
      screen.getByRole('option', { name: choiceLabel }),
    );
  }

  await user.click(screen.getByRole('button', { name: GENERATE_INVITE_SUBMIT_LABEL }));
}

describe('InviteManager — the listing', () => {
  it('renders one ordered entry per invite, each stating its state, creation instant, and expiry or that it does not expire', async () => {
    await mountManager({ listOutcomes: [{ kind: 'success', value: LISTING }] });

    await waitFor(() => {
      expect(renderedEntries()).toHaveLength(LISTING.length);
    });

    // 11.3: creation instant descending, ties broken by identity ascending — the
    // pure `orderInviteSummaries`, applied once inside the machine.
    expect(
      renderedEntries().map((entry) => entry.getAttribute(INVITE_ENTRY_ATTRIBUTE)),
    ).toEqual(EXPECTED_ORDER);

    const expectations: readonly (readonly [InviteSummary, string])[] = [
      [REVOKED_INVITE, INVITE_REVOKED_STATE_LABEL],
      [EXPIRED_INVITE, INVITE_EXPIRED_STATE_LABEL],
      [ACTIVE_INVITE, INVITE_ACTIVE_STATE_LABEL],
    ];

    renderedEntries().forEach((entry, index) => {
      const [summary, stateLabel] = expectations[index];

      // 11.2: a text label naming the Invite_State.
      expect(entry.querySelector(INVITE_STATE_LABEL_SELECTOR)).toHaveTextContent(
        stateLabel,
      );

      // 11.2: the creation instant, with an unambiguous machine-readable form.
      const created = entry.querySelector(INVITE_CREATED_SELECTOR);
      expect(created).toHaveTextContent(formatInviteInstant(summary.createdAtMs));
      expect(created).toHaveAttribute(
        'datetime',
        inviteInstantAttribute(summary.createdAtMs) ?? '',
      );

      // 11.2: either the expiry instant, or the label stating it does not expire —
      // exactly one of the two, never both and never neither.
      if (summary.expiresAtMs === null) {
        expect(entry.querySelector(INVITE_NEVER_EXPIRES_SELECTOR)).toHaveTextContent(
          INVITE_NEVER_EXPIRES_LABEL,
        );
        expect(entry.querySelector(INVITE_EXPIRES_SELECTOR)).toBeNull();
      } else {
        expect(entry.querySelector(INVITE_EXPIRES_SELECTOR)).toHaveTextContent(
          formatInviteInstant(summary.expiresAtMs),
        );
        expect(entry.querySelector(INVITE_NEVER_EXPIRES_SELECTOR)).toBeNull();
      }

      // 11.9: a revoke control on the `Active` invite, and on neither of the
      // others — there is nothing left to revoke.
      const revoke = entry.querySelector(INVITE_REVOKE_SELECTOR);
      if (summary.state === 'Active') {
        expect(revoke).not.toBeNull();
      } else {
        expect(revoke).toBeNull();
      }
    });

    // 11.4: no listed entry discloses a redeemable value — an `InviteSummary`
    // carries none, so there is nothing for an entry to render.
    expect(document.body.textContent).not.toContain(GENERATED.redeemableLink);
    expect(document.body.textContent).not.toContain(GENERATED.code);
  });
});

describe('InviteManager — generating an invite', () => {
  it('submits the default validity and reveals the returned link and code, then lists once more', async () => {
    const { log, user } = await mountManager({
      listOutcomes: [{ kind: 'success', value: LISTING }],
      generateOutcome: { kind: 'success', value: GENERATED },
    });

    await submitGenerator(user);

    // 11.5: the selected choice, submitted as the option declares it. Seven days
    // is what the generator opens on, matching the backend's own default.
    expect(log.generateCommands).toEqual([
      { validity: '7.00:00:00', nonExpiring: false },
    ]);

    // 11.6: the reveal presents both returned values, with the shown-once
    // statement in text and a control that copies the link.
    const reveal = await waitFor(() => {
      const surface = document.querySelector<HTMLElement>(INVITE_REVEAL_SELECTOR);
      expect(surface).not.toBeNull();
      return surface as HTMLElement;
    });

    // 11.8: the backend's `redeemableLink`, presented exactly as returned, as both
    // the text and the address — so opening it reaches the Invite_Landing_Route.
    const link = reveal.querySelector(INVITE_REVEAL_LINK_SELECTOR);
    expect(link).toHaveTextContent(GENERATED.redeemableLink);
    expect(link).toHaveAttribute('href', GENERATED.redeemableLink);
    expect(reveal.querySelector(INVITE_REVEAL_CODE_SELECTOR)).toHaveTextContent(
      GENERATED.code,
    );
    expect(reveal).toHaveTextContent(INVITE_SHOWN_ONCE);
    expect(
      within(reveal).getByRole('button', { name: COPY_INVITE_LINK_LABEL }),
    ).toBeInTheDocument();

    // 11.6: exactly one further `ListInvites`.
    await waitFor(() => {
      expect(log.listCalls).toBe(2);
    });
  });

  it('submits a non-expiring invite when that choice is selected', async () => {
    const { log, user } = await mountManager({
      listOutcomes: [{ kind: 'success', value: LISTING }],
      generateOutcome: { kind: 'success', value: { ...GENERATED, expiresAtMs: null } },
    });

    await submitGenerator(user, INVITE_NEVER_EXPIRES_LABEL);

    // 11.5: the other half of the offered choice — no validity at all.
    expect(log.generateCommands).toEqual([{ validity: null, nonExpiring: true }]);
  });

  it('copies the link on request and leaves nothing behind once the reveal is dismissed', async () => {
    // The clipboard is `userEvent`'s own stub, so the copy is observed through the
    // same API a browser would expose rather than through a spy of our own.
    const { user } = await mountManager({
      listOutcomes: [{ kind: 'success', value: LISTING }],
      generateOutcome: { kind: 'success', value: GENERATED },
    });

    await submitGenerator(user);
    await waitFor(() => {
      expect(document.querySelector(INVITE_REVEAL_SELECTOR)).not.toBeNull();
    });

    // 11.6: the copy control copies the returned link, unaltered, and says so in a
    // message that carries no part of the value.
    await user.click(screen.getByRole('button', { name: COPY_INVITE_LINK_LABEL }));
    await waitFor(async () => {
      expect(await navigator.clipboard.readText()).toBe(GENERATED.redeemableLink);
    });
    expect(await screen.findByText(INVITE_LINK_COPIED)).toBeInTheDocument();

    // 11.7: dismissal discards both values from the rendered output. The hook
    // holds the only copy, and this component retains none.
    await user.click(screen.getByRole('button', { name: DISMISS_INVITE_REVEAL_LABEL }));

    await waitFor(() => {
      expect(document.querySelector(INVITE_REVEAL_SELECTOR)).toBeNull();
    });
    expect(document.body.innerHTML).not.toContain(GENERATED.redeemableLink);
    expect(document.body.innerHTML).not.toContain(GENERATED.code);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('states the one generic failure when a generate fails, and leaves the accepted listing unchanged', async () => {
    const { log, user } = await mountManager({
      listOutcomes: [{ kind: 'success', value: LISTING }],
      generateOutcome: { kind: 'transport-failure' },
    });

    await submitGenerator(user);

    // 11.12: an outcome message in a live region — and the same one whatever went
    // wrong, including the active-invite limit.
    const outcome = await waitFor(() => {
      const region = screen
        .getAllByRole('status')
        .find((candidate) => candidate.textContent === GENERIC_SQUADS_FAILURE);
      expect(region).toBeDefined();
      return region as HTMLElement;
    });
    expect(outcome).toHaveAttribute('aria-live', 'polite');

    // 11.12: the listing last accepted keeps rendering, and no reveal appears.
    expect(renderedEntries()).toHaveLength(LISTING.length);
    expect(document.querySelector(INVITE_REVEAL_SELECTOR)).toBeNull();
    expect(log.listCalls).toBe(1);
  });
});

describe('InviteManager — revoking an invite', () => {
  it('asks for confirmation, issues nothing when it is dismissed, and one call plus one further list when it is confirmed', async () => {
    const { log, user } = await mountManager({
      listOutcomes: [{ kind: 'success', value: LISTING }],
      revokeOutcome: { kind: 'success', value: undefined },
    });

    await waitFor(() => {
      expect(renderedEntries()).toHaveLength(LISTING.length);
    });

    // 11.10: the revoke control asks before acting.
    await user.click(screen.getByRole('button', { name: REVOKE_INVITE_LABEL }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // A dismissed confirmation issues no call at all.
    await user.click(screen.getByRole('button', { name: CANCEL_LABEL }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(log.revokedInviteIds).toEqual([]);

    // 11.10: on confirmation, exactly one `RevokeInvite` for that invite identity,
    // then exactly one further `ListInvites`.
    await user.click(screen.getByRole('button', { name: REVOKE_INVITE_LABEL }));
    await user.click(screen.getByRole('button', { name: REVOKE_INVITE_CONFIRM_LABEL }));

    expect(log.revokedInviteIds).toEqual([ACTIVE_INVITE_ID]);
    await waitFor(() => {
      expect(log.listCalls).toBe(2);
    });
  });
});
