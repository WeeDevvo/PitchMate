/**
 * Property test for what losing the session does to the feature (task 7.9).
 *
 * **Property 42: Losing the session stops the feature rendering squad data and
 * navigates nothing.** Two halves, asserted separately because they are separate
 * claims:
 *
 * 1. *For any* set of Squads_Api calls awaiting a response when the Auth_State
 *    becomes `unauthenticated`: **every such call is aborted**, **no response of
 *    such a call is rendered**, **no Squad_Summary, Squad_Detail, Player_Row, or
 *    Invite_Summary value remains rendered**, and **the feature performs no
 *    navigation of its own** — the log-in boundary is the App_Shell's Route_Guard
 *    to enforce, not this feature's (Requirements 1.11, 5.14, 17.5).
 * 2. *For any* mount occurring while the Auth_State is `unauthenticated`: the
 *    Squads_Home **issues no `ListMySquads` call** and **renders no Squad_Card**
 *    (Requirement 1.13).
 *
 * ### How "aborted, and then disregarded" is checked
 *
 * The generated set of in-flight calls is held open by a transport that records
 * each call's caller `AbortSignal` and hands back a promise nobody has resolved.
 * At the transition, every one of those signals is asserted `aborted`.
 *
 * Then — and this is the half a weaker test would skip — every held-open call is
 * **released with a successful response**. A machine that merely stopped
 * *asking* would pass the abort assertion and then quietly render the answer
 * anyway; the assertions after the release are what rule that out. Nothing may
 * appear, and nothing may navigate, even though every abandoned call came back
 * with a perfectly good Squad_Detail, Player_List, Invite_Summary listing, and
 * redemption.
 *
 * ### How "remains rendered" is checked
 *
 * Every generated squad name, player name, and identity carries a unique `pmz-…`
 * token, and the harness renders them. The assertion searches the rendered text
 * *and every rendered attribute value* for those tokens: present before the
 * transition wherever a value had been accepted (the non-vacuity guard), absent
 * after it, whatever the abandoned calls then answered with.
 *
 * ### One harness, every machine that holds squad data
 *
 * The Auth_State is a **prop** threaded into all seven machines at once, which is
 * exactly how it moves in the app — `useAuth().state` changing re-renders the
 * screens — so no `AuthProvider` is needed for the first half. The second half
 * uses the real `AuthProvider` and the real Squads_Home, because "a mount while
 * unauthenticated" is a claim about that screen.
 *
 * Feature: web-squads-screens, Property 42: Losing the session stops the feature rendering squad data and navigates nothing
 * Validates: Requirements 1.11, 1.13, 5.14, 17.5
 */
import { useEffect, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import fc from 'fast-check';
import { MemoryRouter } from 'react-router-dom';

import { HOME_ROUTE } from '../../app-shell';
import { AuthProvider, type AuthState, type SessionManager } from '../../auth';
import type { CallResult, SquadsApi } from '../api/squadsApi';
import { SQUAD_CARD_SELECTOR } from '../components/SquadCard';
import type { InviteSummary } from '../lib/parse/inviteSummary';
import type { DisplayRatingLeaderboard } from '../lib/parse/leaderboard';
import type { Redemption } from '../lib/parse/redemption';
import type { SquadDetail } from '../lib/parse/squadDetail';
import type { SquadSummary } from '../lib/parse/squadSummary';
import { inviteLandingPath } from '../lib/routePaths';
import { DO_NOT_SEED_TIER, LEAVE_TIER_UNCHANGED } from '../lib/skillTier';
import { SquadsHome } from '../screens/SquadsHome';
import { useFeatureToggles } from './useFeatureToggles';
import { useGuestManager } from './useGuestManager';
import { useInviteManager } from './useInviteManager';
import { useInviteRedemption } from './useInviteRedemption';
import { usePromotion } from './usePromotion';
import { useSquadScreen } from './useSquadScreen';
import { useSquadsHome } from './useSquadsHome';

// --- The transport ----------------------------------------------------------

/** Every method of the seam. */
type MethodName = keyof SquadsApi;

/** One call the transport is holding open, with the signal it was given. */
interface HeldCall {
  readonly method: MethodName;
  /** The caller `AbortSignal` the machine supplied — what the abort claim reads. */
  readonly signal: AbortSignal | undefined;
  /** Answer this call, however long after the session ended. */
  settle(result: CallResult<unknown>): void;
}

/** What the transport answers for one method. */
type Answer = 'held-open' | CallResult<unknown>;

/** The fake seam: it counts, it records signals, and it holds calls open. */
interface Transport {
  readonly api: SquadsApi;
  count(method: MethodName): number;
  /** Every call still awaiting an answer. */
  readonly held: HeldCall[];
  readonly answers: Map<MethodName, Answer>;
}

/**
 * A Squads_Api that answers from {@link Transport.answers} and refuses whatever a
 * scenario did not configure.
 *
 * Each method extracts the caller `AbortSignal` from its own argument list, which
 * is what makes "every such call is aborted" observable at all: the signal
 * recorded here *is* the one the machine's own `AbortController` produced.
 */
function createTransport(): Transport {
  const counts = new Map<MethodName, number>();
  const answers = new Map<MethodName, Answer>();
  const held: HeldCall[] = [];

  const respond = (
    method: MethodName,
    signal: AbortSignal | undefined,
  ): Promise<CallResult<never>> => {
    counts.set(method, (counts.get(method) ?? 0) + 1);

    const answer = answers.get(method);
    if (answer === undefined) {
      throw new Error(`no scenario of Property 42 issues ${method}`);
    }

    if (answer !== 'held-open') {
      return Promise.resolve(answer as CallResult<never>);
    }

    return new Promise<CallResult<never>>((resolve) => {
      held.push({
        method,
        signal,
        settle: (result) => {
          resolve(result as CallResult<never>);
        },
      });
    });
  };

  const api: SquadsApi = {
    listMySquads: (signal) => respond('listMySquads', signal),
    getSquad: (_squadId, signal) => respond('getSquad', signal),
    getDisplayRatingLeaderboard: (_squadId, signal) =>
      respond('getDisplayRatingLeaderboard', signal),
    createSquad: (_command, signal) => respond('createSquad', signal),
    redeemInvite: (_command, signal) => respond('redeemInvite', signal),
    previewInvite: (signal) => respond('previewInvite', signal),
    listInvites: (_squadId, signal) => respond('listInvites', signal),
    generateInvite: (_squadId, _command, signal) =>
      respond('generateInvite', signal),
    revokeInvite: (_squadId, _inviteId, signal) =>
      respond('revokeInvite', signal),
    createGuest: (_squadId, _command, signal) => respond('createGuest', signal),
    editGuest: (_squadId, _membershipId, _command, signal) =>
      respond('editGuest', signal),
    promoteToAdmin: (_squadId, _membershipId, signal) =>
      respond('promoteToAdmin', signal),
    getFeatureFlags: (_squadId, signal) => respond('getFeatureFlags', signal),
    setFeatureFlag: (_squadId, _command, signal) =>
      respond('setFeatureFlag', signal),
  };

  return { api, count: (method) => counts.get(method) ?? 0, held, answers };
}

/** Let every settled call deliver and every resulting React update apply. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 16; round += 1) {
      await Promise.resolve();
    }
  });
}

// --- The harness ------------------------------------------------------------

/** The machines' activations, so a scenario can put a mutation in flight. */
interface Controls {
  generateInvite(): void;
  revokeInvite(): void;
  createGuest(): void;
  editGuest(): void;
  promoteToAdmin(): void;
  setFeatureFlag(): void;
}

interface HarnessProps {
  readonly api: SquadsApi;
  readonly authState: AuthState;
  readonly squadId: string;
  readonly membershipId: string;
  readonly inviteId: string;
  readonly invitePath: string;
  readonly navigate: (path: string) => void;
  /** Filled after every render, so the test can activate the admin operations. */
  readonly controlsRef: { current: Controls | null };
}

/** The selector every rendered squad value carries, so the assertion is scoped. */
const VALUE_ATTRIBUTE = 'data-squads-value';

/**
 * Every machine of the feature that holds squad data, under one Auth_State prop,
 * rendering exactly the four value kinds Requirement 17.5 names.
 *
 * The rendered output is deliberately plain: this property is about *whether* a
 * Squad_Summary, Squad_Detail, Player_Row, or Invite_Summary value is rendered at
 * all, not about how any surface presents one.
 */
function SessionHarness({
  api,
  authState,
  squadId,
  membershipId,
  inviteId,
  invitePath,
  navigate,
  controlsRef,
}: HarnessProps): ReactElement {
  const home = useSquadsHome({ api, authState });
  const squad = useSquadScreen({ api, squadId, authState });
  const invites = useInviteManager({ api, squadId, authState });
  const guests = useGuestManager({
    api,
    squadId,
    refresh: squad.refresh,
    authState,
  });
  const promotion = usePromotion({
    api,
    squadId,
    refresh: squad.refresh,
    authState,
  });
  const features = useFeatureToggles({
    api,
    squadId,
    refresh: squad.refresh,
    authState,
  });
  const redemption = useInviteRedemption({
    api,
    path: invitePath,
    navigate: (path) => {
      navigate(path);
    },
    authState,
  });

  // Test-only: the activations, refreshed after every render so an activation
  // goes through the current machine rather than a stale closure. Written in an
  // effect rather than during render, so the harness stays a pure component.
  useEffect(() => {
    controlsRef.current = {
      generateInvite: () => invites.generate({ nonExpiring: true }),
      revokeInvite: () => invites.revoke(inviteId),
      createGuest: () =>
        guests.create({
          displayName: 'BigDave',
          skillTier: DO_NOT_SEED_TIER,
          lawfulBasisAcknowledged: true,
        }),
      editGuest: () =>
        guests.edit({
          membershipId,
          displayName: 'Big Dave',
          skillTier: LEAVE_TIER_UNCHANGED,
        }),
      promoteToAdmin: () => promotion.promote(membershipId),
      setFeatureFlag: () => features.setEnabled('live-match-tracking', true),
    };
  });

  return (
    <div>
      {/* Squad_Summary values (Requirement 1.11). */}
      {(home.summaries ?? []).map((summary) => (
        <p key={summary.squadId} {...{ [VALUE_ATTRIBUTE]: 'summary' }}>
          {summary.name} {summary.squadId}
        </p>
      ))}

      {/* The Squad_Detail value. */}
      {squad.detail === null ? null : (
        <p {...{ [VALUE_ATTRIBUTE]: 'detail' }}>
          {squad.detail.name} {squad.detail.squadId}
        </p>
      )}

      {/* Player_Row values. */}
      {squad.players.map((player) => (
        <p key={player.membershipId} {...{ [VALUE_ATTRIBUTE]: 'player' }}>
          {player.displayName} {player.membershipId}
        </p>
      ))}

      {/* Invite_Summary values. */}
      {(invites.invites ?? []).map((invite) => (
        <p key={invite.inviteId} {...{ [VALUE_ATTRIBUTE]: 'invite' }}>
          {invite.inviteId}
        </p>
      ))}

      {/* The revealed Invite_Link and Invite_Code, which must go too (11.7). */}
      {invites.reveal === null ? null : (
        <p {...{ [VALUE_ATTRIBUTE]: 'reveal' }}>
          {invites.reveal.redeemableLink} {invites.reveal.code}
        </p>
      )}

      <span data-testid="redemption-phase">{redemption.phase}</span>
    </div>
  );
}

// --- Reading the rendered output --------------------------------------------

/** How many rendered values of one kind the harness is showing. */
function renderedValueCount(kind: string): number {
  return document.querySelectorAll(`[${VALUE_ATTRIBUTE}="${kind}"]`).length;
}

/** Everything the interface presents: rendered text, and every attribute value. */
function renderedContent(): string {
  const parts: string[] = [document.body.textContent ?? ''];

  for (const element of Array.from(document.body.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      parts.push(attribute.value);
    }
  }

  return parts.join('\n');
}

// --- Generators -------------------------------------------------------------

/** A value that cannot occur in the feature's own copy by accident. */
const tokenArb: fc.Arbitrary<string> = fc.uuid().map((id) => `pmz-${id}`);

/**
 * Whether a read had **accepted a value** before the session ended, or was still
 * awaiting a response at that moment.
 *
 * Both matter, and differently: an accepted value must *stop being rendered*
 * (Requirement 17.5), while a call awaiting a response must be *aborted and then
 * disregarded* (Requirement 1.11).
 */
type ReadFate = 'held-open' | 'accepted';

const readFateArb: fc.Arbitrary<ReadFate> = fc.constantFrom(
  'held-open',
  'accepted',
);

/** The admin operations a scenario may put in flight before the session ends. */
const MUTATIONS = [
  'generateInvite',
  'revokeInvite',
  'createGuest',
  'editGuest',
  'promoteToAdmin',
  'setFeatureFlag',
] as const;

type MutationName = (typeof MUTATIONS)[number];

/** One generated set of calls in flight when the Auth_State changes. */
interface Scenario {
  readonly squadId: string;
  readonly membershipId: string;
  readonly inviteId: string;
  readonly inviteSecret: string;
  readonly squadNameToken: string;
  readonly summaryNameToken: string;
  readonly playerNameToken: string;
  readonly homeRead: ReadFate;
  readonly detailRead: ReadFate;
  readonly leaderboardRead: ReadFate;
  readonly invitesRead: ReadFate;
  readonly mutations: readonly MutationName[];
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  squadId: fc.uuid(),
  membershipId: fc.uuid(),
  inviteId: fc.uuid(),
  inviteSecret: tokenArb,
  squadNameToken: tokenArb,
  summaryNameToken: tokenArb,
  playerNameToken: tokenArb,
  homeRead: readFateArb,
  detailRead: readFateArb,
  leaderboardRead: readFateArb,
  invitesRead: readFateArb,
  mutations: fc.subarray([...MUTATIONS]),
});

// --- The values the abandoned calls answer with ------------------------------

/** The Squad_Summary collection a `ListMySquads` answers with. */
function summariesOf(scenario: Scenario): readonly SquadSummary[] {
  return [
    {
      squadId: scenario.squadId,
      name: `Squad ${scenario.summaryNameToken}`,
      role: 'owner',
      state: 'active',
    },
  ];
}

/** The Squad_Detail a `GetSquad` answers with. */
function detailOf(scenario: Scenario): SquadDetail {
  return {
    squadId: scenario.squadId,
    name: `Squad ${scenario.squadNameToken}`,
    members: [
      {
        membershipId: scenario.membershipId,
        displayName: `Player ${scenario.playerNameToken}`,
        role: 'member',
        state: 'active',
        isGuest: false,
      },
    ],
    features: [{ feature: 'live-match-tracking', isEnabled: true }],
  };
}

/** The Display_Rating_Leaderboard a `GetSquadLeaderboard` answers with. */
function leaderboardOf(scenario: Scenario): DisplayRatingLeaderboard {
  return {
    entries: [
      {
        membershipId: scenario.membershipId,
        displayName: `Player ${scenario.playerNameToken}`,
        value: 1234,
      },
    ],
  };
}

/** The Invite_Summary listing a `ListInvites` answers with. */
function invitesOf(scenario: Scenario): readonly InviteSummary[] {
  return [
    {
      inviteId: scenario.inviteId,
      state: 'active',
      createdAtMs: 1_700_000_000_000,
      createdBy: null,
      expiresAtMs: null,
    },
  ];
}

/** A redemption that would navigate, if anything were allowed to. */
function redemptionOf(scenario: Scenario): Redemption {
  return { membershipId: scenario.membershipId, outcome: 'joined', squadId: scenario.squadId };
}

/**
 * The successful answer each abandoned call is released with.
 *
 * Deliberately generous: every one of them carries the value its machine would
 * have rendered, so "nothing is rendered afterwards" is a statement about the
 * machines rather than about an empty response.
 */
function releaseValueFor(
  method: MethodName,
  scenario: Scenario,
): CallResult<unknown> {
  switch (method) {
    case 'listMySquads':
      return { kind: 'success', value: summariesOf(scenario) };
    case 'getSquad':
      return { kind: 'success', value: detailOf(scenario) };
    case 'getDisplayRatingLeaderboard':
      return { kind: 'success', value: leaderboardOf(scenario) };
    case 'listInvites':
      return { kind: 'success', value: invitesOf(scenario) };
    case 'redeemInvite':
      return { kind: 'success', value: redemptionOf(scenario) };
    case 'generateInvite':
      return {
        kind: 'success',
        value: {
          inviteId: scenario.inviteId,
          redeemableLink: inviteLandingPath(scenario.inviteSecret),
          code: scenario.inviteSecret,
          expiresAtMs: null,
        },
      };
    case 'createGuest':
      return { kind: 'success', value: { guestMembershipId: scenario.membershipId } };
    default:
      // Revoke, edit guest, promote, and set feature flag carry no value.
      return { kind: 'success', value: undefined };
  }
}

/** The tokens the harness would render if any abandoned value reached it. */
function tokensOf(scenario: Scenario): readonly string[] {
  return [
    scenario.summaryNameToken,
    scenario.squadNameToken,
    scenario.playerNameToken,
    scenario.inviteSecret,
    scenario.squadId,
    scenario.membershipId,
    scenario.inviteId,
  ];
}

// --- The Squads_Home mounted while unauthenticated ---------------------------

/** A `SessionManager` reporting one fixed Auth_State. */
function sessionManager(state: AuthState): SessionManager {
  return {
    bootstrap: () => state,
    establish: () => undefined,
    getState: () => state,
    getAccessTokenForRequest: () => Promise.resolve({ token: 'test-token' }),
    signOut: () => Promise.resolve(),
    subscribe: () => () => undefined,
  };
}

// --- The properties ---------------------------------------------------------

describe('Property 42 — losing the session stops the feature rendering squad data and navigates nothing', () => {
  // Feature: web-squads-screens, Property 42: Losing the session stops the feature rendering squad data and navigates nothing
  // Validates: Requirements 1.11, 5.14, 17.5
  it('aborts every call awaiting a response, renders no value of it, and navigates nowhere', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        try {
          const transport = createTransport();
          const navigations: string[] = [];
          const controlsRef: { current: Controls | null } = { current: null };

          // The four reads: each either settles successfully before the session
          // ends, or is still awaiting a response at that moment.
          transport.answers.set(
            'listMySquads',
            scenario.homeRead === 'accepted'
              ? { kind: 'success', value: summariesOf(scenario) }
              : 'held-open',
          );
          transport.answers.set(
            'getSquad',
            scenario.detailRead === 'accepted'
              ? { kind: 'success', value: detailOf(scenario) }
              : 'held-open',
          );
          transport.answers.set(
            'getDisplayRatingLeaderboard',
            scenario.leaderboardRead === 'accepted'
              ? { kind: 'success', value: leaderboardOf(scenario) }
              : 'held-open',
          );
          transport.answers.set(
            'listInvites',
            scenario.invitesRead === 'accepted'
              ? { kind: 'success', value: invitesOf(scenario) }
              : 'held-open',
          );
          // The Invite_Landing_Route's redemption is always in flight: it is the
          // one call whose success would navigate, so it is what the "navigates
          // nothing" claim is stated over (Requirement 5.14).
          transport.answers.set('redeemInvite', 'held-open');
          for (const mutation of MUTATIONS) {
            transport.answers.set(mutation, 'held-open');
          }

          const props = {
            api: transport.api,
            squadId: scenario.squadId,
            membershipId: scenario.membershipId,
            inviteId: scenario.inviteId,
            invitePath: inviteLandingPath(scenario.inviteSecret),
            navigate: (path: string) => {
              navigations.push(path);
            },
            controlsRef,
          };

          const view = render(
            <SessionHarness {...props} authState="authenticated" />,
          );
          await flush();

          // The generated mutations are put in flight by activating them, which
          // is the only way any of them is ever issued (Requirement 17.4).
          await act(async () => {
            for (const mutation of scenario.mutations) {
              controlsRef.current?.[mutation]();
            }
          });
          await flush();

          // Non-vacuity, one: every accepted read really is rendered before the
          // session ends, so "no longer rendered" below is a change of state.
          const before = renderedContent();
          if (scenario.homeRead === 'accepted') {
            expect(renderedValueCount('summary')).toBe(1);
            expect(before).toContain(scenario.summaryNameToken);
          }
          if (scenario.detailRead === 'accepted') {
            expect(renderedValueCount('detail')).toBe(1);
            expect(renderedValueCount('player')).toBe(1);
            expect(before).toContain(scenario.squadNameToken);
            expect(before).toContain(scenario.playerNameToken);
          }
          if (scenario.invitesRead === 'accepted') {
            expect(renderedValueCount('invite')).toBe(1);
            expect(before).toContain(scenario.inviteId);
          }

          // Non-vacuity, two: the set of calls awaiting a response is exactly the
          // generated one, and none of them has been aborted yet.
          const awaiting = [...transport.held];
          expect(awaiting.length).toBeGreaterThan(0);
          for (const call of awaiting) {
            expect(call.signal?.aborted).toBe(false);
          }

          // The session ends.
          view.rerender(<SessionHarness {...props} authState="unauthenticated" />);
          await flush();

          // 1.11, 17.5: every call awaiting a response is aborted, through the
          // caller signal the Squads_Api accepts.
          for (const call of awaiting) {
            expect(call.signal).toBeDefined();
            expect(call.signal?.aborted).toBe(true);
          }

          // Every abandoned call now answers — successfully, and with exactly the
          // value its machine would have rendered.
          await act(async () => {
            for (const call of awaiting) {
              call.settle(releaseValueFor(call.method, scenario));
            }
          });
          await flush();

          // 1.11, 17.5: no response of an abandoned call is rendered, and no
          // Squad_Summary, Squad_Detail, Player_Row, or Invite_Summary value
          // remains rendered.
          expect(renderedValueCount('summary')).toBe(0);
          expect(renderedValueCount('detail')).toBe(0);
          expect(renderedValueCount('player')).toBe(0);
          expect(renderedValueCount('invite')).toBe(0);
          // 11.7: nor the revealed Invite_Link and Invite_Code.
          expect(renderedValueCount('reveal')).toBe(0);

          const after = renderedContent();
          for (const token of tokensOf(scenario)) {
            expect(after).not.toContain(token);
          }

          // 5.14, 17.5: the feature navigated nowhere of its own accord — not on
          // the transition, and not on the redemption that succeeded after it.
          // The log-in boundary is the Route_Guard's to enforce.
          expect(navigations).toEqual([]);

          // 5.14: the Invite_Landing_Route is back on its handover surface rather
          // than on a redeemed one.
          expect(
            view.container.querySelector('[data-testid="redemption-phase"]')
              ?.textContent,
          ).toBe('handover');
        } finally {
          cleanup();
        }
      }),
      { numRuns: 120 },
    );
  }, 300_000);

  // Feature: web-squads-screens, Property 42: Losing the session stops the feature rendering squad data and navigates nothing
  // Validates: Requirements 1.13
  it('issues no ListMySquads and renders no Squad_Card for a mount made while unauthenticated', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        try {
          const transport = createTransport();
          // Configured to answer, and generously: the claim is that the call is
          // never issued, not that answering it would have been harmless.
          transport.answers.set('listMySquads', {
            kind: 'success',
            value: summariesOf(scenario),
          });

          render(
            <AuthProvider manager={sessionManager('unauthenticated')}>
              <MemoryRouter initialEntries={[HOME_ROUTE]}>
                <SquadsHome api={transport.api} />
              </MemoryRouter>
            </AuthProvider>,
          );
          await flush();

          // 1.13: no squad data is requested outside an authenticated session…
          expect(transport.count('listMySquads')).toBe(0);
          // …and none is rendered.
          expect(
            document.querySelectorAll(SQUAD_CARD_SELECTOR).length,
          ).toBe(0);
          expect(renderedContent()).not.toContain(scenario.summaryNameToken);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  }, 120_000);
});
