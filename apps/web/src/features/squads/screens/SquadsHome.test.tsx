/**
 * Worked examples for the Squads_Home (task 10.5).
 *
 * The quantified claims about this screen — one card per parsed summary in the
 * ordering rule's sequence, and both entry points in every load state — are
 * Properties 1 and 4, and they live in their own files (task 10.6). What is
 * pinned here is what a property would only obscure: the four load states as
 * rendered surfaces, the retry issuing exactly one further call, and the four
 * ways a submission can end.
 *
 * Two seams are supplied and nothing else is stubbed: a `SquadsApi` that answers
 * with settled `CallResult` values, and a `SessionManager` reporting
 * `authenticated`. The screen runs inside a real `MemoryRouter`, so navigation is
 * observed as a location change rather than as a spy call — which is also how
 * "no full-document reload" stays true without asserting it.
 *
 * Requirements: 1.2, 1.9, 1.10, 2.1, 2.2, 2.5, 2.6, 3.6, 4.7, 4.8, 4.9
 */
import { type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { HOME_ROUTE } from '../../app-shell';
import { AuthProvider, type AuthState, type SessionManager } from '../../auth';
import type { CallResult, SquadsApi } from '../api/squadsApi';
import { FAILURE_NOTICE_SELECTOR } from '../components/FailureNotice';
import { LOADING_INDICATION_SELECTOR } from '../components/LoadingIndication';
import {
  SQUAD_CARD_ID_ATTRIBUTE,
  SQUAD_CARD_SELECTOR,
} from '../components/SquadCard';
import { SQUADS_EMPTY_STATE_SELECTOR } from '../components/SquadsEmptyState';
import {
  CREATE_SQUAD_HEADING,
  CREATE_SQUAD_SUBMIT_LABEL,
  CREATOR_DISPLAY_NAME_LABEL,
  DISPLAY_NAME_UNAVAILABLE,
  GENERIC_SQUADS_FAILURE,
  INVITE_SECRET_LABEL,
  INVITE_UNUSABLE,
  JOIN_SQUAD_HEADING,
  JOIN_SQUAD_SUBMIT_LABEL,
  SQUAD_NAME_LABEL,
  SQUADS_HOME_HEADING,
  SQUADS_RETRY_LABEL,
} from '../lib/messages';
import type { CreatedSquad } from '../lib/parse/createdSquad';
import type { Redemption } from '../lib/parse/redemption';
import type { SquadSummary } from '../lib/parse/squadSummary';
import { squadPath } from '../lib/routePaths';
import { SquadsHome } from './SquadsHome';

// --- the seams ---------------------------------------------------------------

/** A method the screen must not call in a given example. */
function unavailable(name: string): () => never {
  return () => {
    throw new Error(`${name} must not be called`);
  };
}

/** What the fake Squads_Api was asked to do. */
interface ApiCallLog {
  listCalls: number;
  readonly createCommands: unknown[];
  readonly redeemCommands: unknown[];
}

interface FakeApiOptions {
  /** One outcome per `listMySquads` call; the last is reused once exhausted. */
  readonly listOutcomes: readonly (
    | CallResult<readonly SquadSummary[]>
    | Promise<CallResult<readonly SquadSummary[]>>
  )[];
  readonly createOutcome?: CallResult<CreatedSquad>;
  readonly redeemOutcome?: CallResult<Redemption>;
}

/**
 * A Squads_Api answering the three calls this screen can issue and refusing the
 * rest, so a call the screen has no business making fails loudly.
 */
function createFakeApi(options: FakeApiOptions): {
  readonly api: SquadsApi;
  readonly log: ApiCallLog;
} {
  const log: ApiCallLog = { listCalls: 0, createCommands: [], redeemCommands: [] };
  const { listOutcomes, createOutcome, redeemOutcome } = options;

  const api: SquadsApi = {
    listMySquads: () => {
      const index = Math.min(log.listCalls, listOutcomes.length - 1);
      log.listCalls += 1;
      return Promise.resolve(listOutcomes[index]);
    },
    createSquad: (command) => {
      log.createCommands.push(command);
      if (createOutcome === undefined) {
        throw new Error('createSquad must not be called');
      }
      return Promise.resolve(createOutcome);
    },
    redeemInvite: (command) => {
      log.redeemCommands.push(command);
      if (redeemOutcome === undefined) {
        throw new Error('redeemInvite must not be called');
      }
      return Promise.resolve(redeemOutcome);
    },
    getSquad: unavailable('getSquad'),
    getDisplayRatingLeaderboard: unavailable('getDisplayRatingLeaderboard'),
    previewInvite: unavailable('previewInvite'),
    listInvites: unavailable('listInvites'),
    generateInvite: unavailable('generateInvite'),
    revokeInvite: unavailable('revokeInvite'),
    createGuest: unavailable('createGuest'),
    editGuest: unavailable('editGuest'),
    promoteToAdmin: unavailable('promoteToAdmin'),
    getFeatureFlags: unavailable('getFeatureFlags'),
    setFeatureFlag: unavailable('setFeatureFlag'),
  };

  return { api, log };
}

/**
 * A `SessionManager` reporting one fixed Auth_State.
 *
 * `AuthProvider` reads only `getState()` and `subscribe()`, and no example here
 * moves the session, so the remaining members are inert.
 */
function sessionManager(state: AuthState = 'authenticated'): SessionManager {
  return {
    bootstrap: () => state,
    establish: () => undefined,
    getState: () => state,
    getAccessTokenForRequest: () => Promise.resolve({ token: 'test-token' }),
    signOut: () => Promise.resolve(),
    subscribe: () => () => undefined,
  };
}

/** Reports the rendered path, so a navigation is observable as a change. */
function LocationProbe(): ReactElement {
  const location = useLocation();

  return <output data-testid="location">{location.pathname}</output>;
}

function renderHome(api: SquadsApi): void {
  render(
    <AuthProvider manager={sessionManager()}>
      <MemoryRouter initialEntries={[HOME_ROUTE]}>
        <SquadsHome api={api} />
        <LocationProbe />
      </MemoryRouter>
    </AuthProvider>,
  );
}

function summary(squadId: string, name: string): SquadSummary {
  return { squadId, name, role: 'owner', state: 'active' };
}

function cardIdentities(): readonly (string | null)[] {
  return Array.from(document.querySelectorAll(SQUAD_CARD_SELECTOR)).map((card) =>
    card.getAttribute(SQUAD_CARD_ID_ATTRIBUTE),
  );
}

function renderedPath(): string {
  return screen.getByTestId('location').textContent ?? '';
}

function entryPoint(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

// --- the examples ------------------------------------------------------------

describe('SquadsHome — the load states', () => {
  // Requirements: 1.2, 1.9
  it('renders one level-one heading and one card per parsed summary, ordered', async () => {
    const { api } = createFakeApi({
      listOutcomes: [
        {
          kind: 'success',
          value: [summary('b-squad', 'Zebra FC'), summary('a-squad', 'alpha AFC')],
        },
      ],
    });

    renderHome(api);

    await waitFor(() => {
      expect(cardIdentities()).toHaveLength(2);
    });

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(SQUADS_HOME_HEADING);

    // The case-insensitive name order, not the response order.
    expect(cardIdentities()).toEqual(['a-squad', 'b-squad']);
    expect(document.querySelector(SQUADS_EMPTY_STATE_SELECTOR)).toBeNull();
    expect(document.querySelector(FAILURE_NOTICE_SELECTOR)).toBeNull();
  });

  // Requirements: 1.10, 2.2
  it('renders a busy indication and neither cards nor the empty state while awaiting the first response', async () => {
    let settle: ((result: CallResult<readonly SquadSummary[]>) => void) | null = null;
    const pending = new Promise<CallResult<readonly SquadSummary[]>>((resolve) => {
      settle = resolve;
    });
    const { api } = createFakeApi({ listOutcomes: [pending] });

    renderHome(api);

    expect(document.querySelector(LOADING_INDICATION_SELECTOR)).not.toBeNull();
    expect(cardIdentities()).toEqual([]);
    expect(document.querySelector(SQUADS_EMPTY_STATE_SELECTOR)).toBeNull();
    expect(document.querySelector(FAILURE_NOTICE_SELECTOR)).toBeNull();
    // 2.2: both entry points are rendered here too, not only beside cards.
    expect(entryPoint(CREATE_SQUAD_HEADING)).toBeInTheDocument();
    expect(entryPoint(JOIN_SQUAD_HEADING)).toBeInTheDocument();

    await act(async () => {
      settle?.({ kind: 'success', value: [] });
      await pending;
    });

    expect(document.querySelector(LOADING_INDICATION_SELECTOR)).toBeNull();
  });

  // Requirements: 2.1, 2.2
  it('renders the empty state, no card, and no error for an accepted empty collection', async () => {
    const { api } = createFakeApi({ listOutcomes: [{ kind: 'success', value: [] }] });

    renderHome(api);

    await waitFor(() => {
      expect(document.querySelector(SQUADS_EMPTY_STATE_SELECTOR)).not.toBeNull();
    });

    expect(cardIdentities()).toEqual([]);
    expect(document.querySelector(FAILURE_NOTICE_SELECTOR)).toBeNull();
    expect(screen.queryByText(GENERIC_SQUADS_FAILURE)).toBeNull();
    expect(entryPoint(CREATE_SQUAD_HEADING)).toBeInTheDocument();
    expect(entryPoint(JOIN_SQUAD_HEADING)).toBeInTheDocument();
  });

  // Requirements: 2.5, 2.6
  it('renders the generic failure with a retry that issues exactly one further list call', async () => {
    const { api, log } = createFakeApi({
      listOutcomes: [
        { kind: 'transport-failure' },
        { kind: 'success', value: [summary('only-squad', 'Only FC')] },
      ],
    });
    const user = userEvent.setup();

    renderHome(api);

    await waitFor(() => {
      expect(screen.getByText(GENERIC_SQUADS_FAILURE)).toBeInTheDocument();
    });

    // 2.5: no card, no empty state, and both entry points still rendered.
    expect(cardIdentities()).toEqual([]);
    expect(document.querySelector(SQUADS_EMPTY_STATE_SELECTOR)).toBeNull();
    expect(entryPoint(CREATE_SQUAD_HEADING)).toBeInTheDocument();
    expect(entryPoint(JOIN_SQUAD_HEADING)).toBeInTheDocument();
    expect(log.listCalls).toBe(1);

    await user.click(
      within(
        document.querySelector(FAILURE_NOTICE_SELECTOR) as HTMLElement,
      ).getByRole('button', { name: SQUADS_RETRY_LABEL }),
    );

    await waitFor(() => {
      expect(cardIdentities()).toEqual(['only-squad']);
    });

    expect(log.listCalls).toBe(2);
    expect(screen.queryByText(GENERIC_SQUADS_FAILURE)).toBeNull();
  });
});

describe('SquadsHome — creating a squad', () => {
  // Requirements: 3.6
  it('navigates to the created squad and closes the form', async () => {
    const { api, log } = createFakeApi({
      listOutcomes: [{ kind: 'success', value: [] }],
      createOutcome: {
        kind: 'success',
        value: { squadId: 'new-squad', ownerMembershipId: 'owner-membership' },
      },
    });
    const user = userEvent.setup();

    renderHome(api);
    await waitFor(() => {
      expect(document.querySelector(SQUADS_EMPTY_STATE_SELECTOR)).not.toBeNull();
    });

    await user.click(entryPoint(CREATE_SQUAD_HEADING));
    await user.type(screen.getByLabelText(SQUAD_NAME_LABEL), '  Sunday League  ');
    await user.type(screen.getByLabelText(CREATOR_DISPLAY_NAME_LABEL), ' Dave ');
    await user.click(screen.getByRole('button', { name: CREATE_SQUAD_SUBMIT_LABEL }));

    await waitFor(() => {
      expect(renderedPath()).toBe(squadPath('new-squad'));
    });

    // The submitted values are trimmed, and the form is no longer the surface.
    expect(log.createCommands).toEqual([
      { name: 'Sunday League', displayName: 'Dave' },
    ]);
    expect(screen.queryByLabelText(SQUAD_NAME_LABEL)).toBeNull();
    // 3.6: one further list call is *not* issued — the squad was navigated to.
    expect(log.listCalls).toBe(1);
  });
});

describe('SquadsHome — joining a squad', () => {
  /** Open the Join_Code_Form and submit the given Invite_Secret. */
  async function join(
    user: ReturnType<typeof userEvent.setup>,
    secret: string,
  ): Promise<void> {
    await user.click(entryPoint(JOIN_SQUAD_HEADING));
    await user.type(screen.getByLabelText(INVITE_SECRET_LABEL), secret);
    await user.click(screen.getByRole('button', { name: JOIN_SQUAD_SUBMIT_LABEL }));
  }

  // Requirements: 4.7
  it('returns to the squads home and lists again when the redemption carries no squad identity', async () => {
    const { api, log } = createFakeApi({
      listOutcomes: [
        { kind: 'success', value: [] },
        { kind: 'success', value: [summary('joined-squad', 'Joined FC')] },
      ],
      // The shape the backend answers with today: a membership and an outcome,
      // and no squad identity at all.
      redeemOutcome: {
        kind: 'success',
        value: { membershipId: 'my-membership', outcome: 'joined', squadId: null },
      },
    });
    const user = userEvent.setup();

    renderHome(api);
    await waitFor(() => {
      expect(document.querySelector(SQUADS_EMPTY_STATE_SELECTOR)).not.toBeNull();
    });

    await join(user, 'SHORTCODE1');

    await waitFor(() => {
      expect(cardIdentities()).toEqual(['joined-squad']);
    });

    expect(log.redeemCommands).toEqual([{ presentedSecret: 'SHORTCODE1' }]);
    expect(renderedPath()).toBe(HOME_ROUTE);
    expect(log.listCalls).toBe(2);
    expect(screen.queryByLabelText(INVITE_SECRET_LABEL)).toBeNull();
  });

  // Requirements: 4.8
  it('renders the one unusable-invite message with the form and its value retained', async () => {
    const { api, log } = createFakeApi({
      listOutcomes: [{ kind: 'success', value: [] }],
      redeemOutcome: { kind: 'rejected-input', reason: 'invite-unusable' },
    });
    const user = userEvent.setup();

    renderHome(api);
    await waitFor(() => {
      expect(document.querySelector(SQUADS_EMPTY_STATE_SELECTOR)).not.toBeNull();
    });

    await join(user, 'REVOKED123');

    await waitFor(() => {
      expect(screen.getByText(INVITE_UNUSABLE)).toBeInTheDocument();
    });

    expect(screen.getByLabelText(INVITE_SECRET_LABEL)).toHaveValue('REVOKED123');
    expect(
      screen.getByRole('button', { name: JOIN_SQUAD_SUBMIT_LABEL }),
    ).not.toHaveAttribute('aria-disabled');
    expect(renderedPath()).toBe(HOME_ROUTE);
    expect(log.listCalls).toBe(1);
    // The secret is not echoed into the outcome message.
    expect(INVITE_UNUSABLE).not.toContain('REVOKED123');
  });

  // Requirements: 4.9
  it('renders the display-name message when the backend rejects the display name', async () => {
    const { api } = createFakeApi({
      listOutcomes: [{ kind: 'success', value: [] }],
      redeemOutcome: { kind: 'rejected-input', reason: 'display-name-in-use' },
    });
    const user = userEvent.setup();

    renderHome(api);
    await waitFor(() => {
      expect(document.querySelector(SQUADS_EMPTY_STATE_SELECTOR)).not.toBeNull();
    });

    await join(user, 'GOODCODE12');

    await waitFor(() => {
      expect(screen.getByText(DISPLAY_NAME_UNAVAILABLE)).toBeInTheDocument();
    });

    expect(screen.queryByText(INVITE_UNUSABLE)).toBeNull();
    expect(screen.getByLabelText(INVITE_SECRET_LABEL)).toHaveValue('GOODCODE12');
  });
});
