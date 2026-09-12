/**
 * Property test for the Invite_Landing_Route's redemption discipline (task 7.7).
 *
 * **Property 11: Redemption from the landing route is attempted at most once per
 * rendered path.** *For any* sequence of Auth_State values observed while one
 * Invite_Landing_Route path is rendered — authenticated at mount, becoming
 * authenticated later, and any number of subsequent transitions and re-renders —
 * at most one `RedeemInvite` call is issued for that path, no `PreviewInvite`
 * call is issued while the Auth_State is authenticated, and a successful
 * redemption navigates *replacing* the current history entry rather than adding
 * one.
 *
 * Three claims, from three requirements, checked over the same generated
 * sequences:
 *
 * 1. **Requirement 5.7** — exactly one `RedeemInvite` per rendered path. The
 *    generators reach an authenticated Auth_State by construction, so "at most
 *    one" is checked in its sharp form, *exactly* one: a machine that issued
 *    none would fail just as loudly as one that issued two. Every shape the
 *    requirement names is generated — authenticated at mount, becoming
 *    authenticated later, `authenticated → unauthenticated → authenticated`
 *    repeated several times, and repeated re-renders with unchanged props.
 * 2. **Requirement 5.2** — no `PreviewInvite` at all while the Auth_State is
 *    `authenticated`. Counted as a *delta across each render step* rather than
 *    as a total, so the step during which a call was issued is identified rather
 *    than inferred; a mount that was already authenticated is additionally held
 *    to a total of zero.
 * 3. **Requirement 5.8** — a success navigates once, and always with
 *    `{ replace: true }`. Both destinations are covered: `squadPath(squadId)`
 *    when the parsed Redemption carries a squad identity, and the Squads_Home
 *    fallback when it does not — which is the *normal* path today, because the
 *    backend sends no `squadId`.
 *
 * The machine is driven through its injected seams alone: no router, no
 * `AuthProvider`, and no transport. The Auth_State is a prop, re-rendered to
 * move it; `navigate` is a recording spy; and the Squads_Api is a fake returning
 * {@link CallResult} values directly, whose every other method throws if
 * touched — so "this route issues these two calls and no others" is asserted
 * rather than assumed.
 *
 * {@link InviteRedemptionMachine.retry} is deliberately **not** exercised here.
 * It issues a further call past the `redeemAttempted` latch on purpose
 * (Requirement 5.13): a person activating a control is neither a re-render nor
 * an Auth_State transition, so it lies outside the bound this property states.
 *
 * Feature: web-squads-screens, Property 11: Redemption from the landing route is attempted at most once per rendered path
 * Validates: Requirements 5.2, 5.7, 5.8
 */
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import fc from 'fast-check';

import { HOME_ROUTE } from '../../app-shell';
import type { AuthState } from '../../auth';
import type {
  CallResult,
  RedeemInviteRequest,
  SquadsApi,
} from '../api/squadsApi';
import type { InvitePreview } from '../lib/parse/invitePreview';
import type { Redemption } from '../lib/parse/redemption';
import { inviteLandingPath, squadPath } from '../lib/routePaths';
import {
  useInviteRedemption,
  type InviteRedemptionNavigate,
  type InviteRedemptionOptions,
} from './useInviteRedemption';

// --- The recording Squads_Api fake ------------------------------------------

/** What the two calls this route may issue were asked, and how often. */
interface ApiCallLog {
  /** How many `PreviewInvite` calls were issued (Requirement 5.2). */
  previewCalls: number;
  /** Every `RedeemInvite` body issued, in order (Requirement 5.7). */
  readonly redeemCommands: RedeemInviteRequest[];
}

/**
 * A Squads_Api method the Invite_Landing_Route must never call.
 *
 * Throwing rather than answering is what makes the counting claim total: the
 * property does not merely count `redeemInvite`, it fails outright if this route
 * reaches for any other operation.
 */
function unavailable(method: string): () => never {
  return () => {
    throw new Error(`the Invite_Landing_Route must not call ${method}`);
  };
}

/** The preview the fake answers with — generic wording, naming no squad. */
const PREVIEW_RESULT: CallResult<InvitePreview> = {
  kind: 'success',
  value: {
    requiresAuthentication: true,
    message: 'Sign in or create an account to join this squad.',
  },
};

/**
 * A Squads_Api that records the two calls this route may issue and refuses the
 * rest, answering `redeemInvite` with the given settled outcome.
 *
 * Both methods resolve immediately: this property is about *how many* calls are
 * issued and where a success navigates, not about the Squad_Call_Timeout, so the
 * transport is reduced to a resolved {@link CallResult}. The real transport, the
 * generated client, and `fetch` are all untouched.
 */
function createRecordingSquadsApi(redeemOutcome: CallResult<Redemption>): {
  readonly api: SquadsApi;
  readonly log: ApiCallLog;
} {
  const log: ApiCallLog = { previewCalls: 0, redeemCommands: [] };

  const api: SquadsApi = {
    previewInvite: () => {
      log.previewCalls += 1;
      return Promise.resolve(PREVIEW_RESULT);
    },
    redeemInvite: (command) => {
      log.redeemCommands.push(command);
      return Promise.resolve(redeemOutcome);
    },
    listMySquads: unavailable('listMySquads'),
    getSquad: unavailable('getSquad'),
    getDisplayRatingLeaderboard: unavailable('getDisplayRatingLeaderboard'),
    createSquad: unavailable('createSquad'),
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

// --- The recording navigation seam ------------------------------------------

/** One navigation the machine performed, with the options it passed. */
interface NavigationRecord {
  readonly path: string;
  readonly options: { readonly replace: boolean };
}

/**
 * A `navigate` that records rather than navigates.
 *
 * The options are recorded **as given** rather than reduced to a boolean, so a
 * push — `navigate(path)` with no options, or `{ replace: false }` — is visible
 * as a difference rather than lost in a truthiness check (Requirement 5.8).
 */
function createRecordingNavigate(): {
  readonly navigate: InviteRedemptionNavigate;
  readonly calls: NavigationRecord[];
} {
  const calls: NavigationRecord[] = [];
  return {
    navigate: (path, options) => {
      calls.push({ path, options });
    },
    calls,
  };
}

// --- The harness ------------------------------------------------------------

/** The machine's options with the Auth_State made explicit, as a prop. */
interface HarnessProps extends Omit<InviteRedemptionOptions, 'authState'> {
  readonly authState: AuthState;
}

/**
 * The machine under test, with every seam a prop.
 *
 * The Auth_State moves by re-rendering this with a new value, which is exactly
 * how it moves in the app — `useAuth().state` changing re-renders the screen —
 * so no `AuthProvider` is needed to drive the transitions Requirement 5.7 is
 * stated over. The phase is rendered so a settled redemption is observable.
 */
function InviteRedemptionHarness(props: HarnessProps): ReactElement {
  const machine = useInviteRedemption(props);
  return <span data-testid="phase">{machine.phase}</span>;
}

// --- Generators -------------------------------------------------------------

const AUTH_STATES: readonly AuthState[] = ['authenticated', 'unauthenticated'];

const authStateArb = fc.constantFrom(...AUTH_STATES);

/**
 * The characters an Invite_Secret is generated from: URL-safe, non-empty, and
 * free of the leading or trailing whitespace `extractInviteSecretFromPath`
 * trims — so `inviteLandingPath` and the extraction round-trip exactly and the
 * issued request body can be asserted character-for-character.
 */
const SECRET_CHARACTERS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'.split('');

const inviteSecretArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...SECRET_CHARACTERS), { minLength: 6, maxLength: 24 })
  .map((characters) => characters.join(''));

/**
 * One step of a generated sequence: an Auth_State, and how many consecutive
 * renders it is observed for.
 *
 * `renders` above one is the "repeated re-renders with unchanged props" case
 * Requirement 5.7 names — a re-render that changes nothing must still issue
 * nothing.
 */
interface AuthStep {
  readonly authState: AuthState;
  readonly renders: number;
}

const authStepArb: fc.Arbitrary<AuthStep> = fc.record({
  authState: authStateArb,
  renders: fc.integer({ min: 1, max: 3 }),
});

/**
 * An arbitrary sequence of Auth_State steps that **reaches** `authenticated` at
 * least once, with the authentication placed anywhere in it.
 *
 * Placing it by construction rather than by filtering is what lets the property
 * assert *exactly* one redemption: every generated sequence owes one, whether
 * the authentication is at the mount (an empty prefix) or arrives later.
 */
const sequenceReachingAuthenticationArb: fc.Arbitrary<readonly AuthStep[]> = fc
  .tuple(
    fc.array(authStepArb, { maxLength: 4 }),
    fc.integer({ min: 1, max: 3 }),
    fc.array(authStepArb, { maxLength: 4 }),
  )
  .map(([before, renders, after]) => [
    ...before,
    { authState: 'authenticated' as AuthState, renders },
    ...after,
  ]);

/**
 * A sequence of `authenticated → unauthenticated` cycles, ending authenticated:
 * the "repeated transitions" case of Requirement 5.7, where the latch must hold
 * across a session that comes and goes several times.
 */
const transitionCycleSequenceArb: fc.Arbitrary<readonly AuthStep[]> = fc
  .tuple(
    fc.integer({ min: 1, max: 5 }),
    fc.integer({ min: 1, max: 2 }),
    fc.integer({ min: 1, max: 2 }),
  )
  .map(([cycles, authenticatedRenders, unauthenticatedRenders]) => {
    const steps: AuthStep[] = [];
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      steps.push({ authState: 'authenticated', renders: authenticatedRenders });
      steps.push({
        authState: 'unauthenticated',
        renders: unauthenticatedRenders,
      });
    }
    steps.push({ authState: 'authenticated', renders: authenticatedRenders });
    return steps;
  });

/** A settled `RedeemInvite` outcome, successful or not. */
const redeemOutcomeArb: fc.Arbitrary<CallResult<Redemption>> = fc.oneof(
  // The normal success today: the backend sends no `squadId`, so the
  // Squads_Home fallback is the ordinary destination.
  fc.constant<CallResult<Redemption>>({
    kind: 'success',
    value: { membershipId: null, outcome: null, squadId: null },
  }),
  // The identity-bearing success the parser already accepts.
  fc.uuid().map<CallResult<Redemption>>((squadId) => ({
    kind: 'success',
    value: { membershipId: null, outcome: 'joined', squadId },
  })),
  fc.constant<CallResult<Redemption>>({ kind: 'not-found' }),
  fc.constant<CallResult<Redemption>>({
    kind: 'rejected-input',
    reason: 'invite-unusable',
  }),
  fc.constant<CallResult<Redemption>>({ kind: 'timeout' }),
  fc.constant<CallResult<Redemption>>({ kind: 'transport-failure' }),
  fc.constant<CallResult<Redemption>>({ kind: 'parse-failure' }),
);

// --- Driving the machine ----------------------------------------------------

/** The Auth_State observed at each render, flattened from the steps. */
function rendersOf(sequence: readonly AuthStep[]): readonly AuthState[] {
  return sequence.flatMap((step) =>
    Array.from({ length: step.renders }, () => step.authState),
  );
}

/**
 * Mount the machine on `path` and re-render it once for each Auth_State in
 * `states`, flushing effects and settled calls after every render.
 *
 * Flushing at each step is what makes the assertions deterministic: a call
 * issued at one step has settled before the next one, so a later loss of session
 * cannot silently swallow an outcome that a differently-timed run would have
 * accepted.
 *
 * @returns the `PreviewInvite` count *delta* for each render, index-aligned with
 *   `states`, which is how "no preview while authenticated" is localised to the
 *   step whose Auth_State was authenticated
 */
async function driveRenders(
  states: readonly AuthState[],
  options: {
    readonly api: SquadsApi;
    readonly log: ApiCallLog;
    readonly path: string;
    readonly navigate: InviteRedemptionNavigate;
    readonly squadsHomePath?: string;
  },
): Promise<readonly number[]> {
  const { api, log, path, navigate, squadsHomePath } = options;

  const harnessFor = (authState: AuthState): ReactElement => (
    <InviteRedemptionHarness
      api={api}
      path={path}
      navigate={navigate}
      authState={authState}
      squadsHomePath={squadsHomePath}
    />
  );

  const [mountState, ...laterStates] = states;
  if (mountState === undefined) {
    throw new Error('a generated sequence must contain at least one render');
  }

  const deltas: number[] = [];

  let before = log.previewCalls;
  const view = render(harnessFor(mountState));
  await act(async () => {});
  deltas.push(log.previewCalls - before);

  for (const state of laterStates) {
    before = log.previewCalls;
    view.rerender(harnessFor(state));
    await act(async () => {});
    deltas.push(log.previewCalls - before);
  }

  return deltas;
}

/**
 * The three claims of Property 11, over one completed run.
 *
 * Kept in one place so the two sequence generators — arbitrary sequences and
 * repeated transition cycles — are held to exactly the same standard.
 */
function expectPropertyEleven(observation: {
  readonly states: readonly AuthState[];
  readonly previewDeltas: readonly number[];
  readonly log: ApiCallLog;
  readonly secret: string;
  readonly outcome: CallResult<Redemption>;
  readonly navigations: readonly NavigationRecord[];
  readonly squadsHomePath?: string;
}): void {
  const {
    states,
    previewDeltas,
    log,
    secret,
    outcome,
    navigations,
    squadsHomePath,
  } = observation;

  // 5.7: exactly one `RedeemInvite` for the rendered path, however many renders
  // and transitions the sequence contained — and carrying the path's own secret.
  expect(log.redeemCommands).toHaveLength(1);
  expect(log.redeemCommands[0]).toEqual({ presentedSecret: secret });

  // 5.2: no `PreviewInvite` is issued at any step whose Auth_State is
  // `authenticated`...
  expect(previewDeltas).toHaveLength(states.length);
  states.forEach((state, index) => {
    if (state === 'authenticated') {
      expect(previewDeltas[index]).toBe(0);
    }
  });
  // ...and a mount that was already authenticated issues none at all.
  if (states[0] === 'authenticated') {
    expect(log.previewCalls).toBe(0);
  }

  if (outcome.kind !== 'success') {
    // Nothing but a success navigates: `unusable` and the generic failure both
    // stay on the route.
    expect(navigations).toEqual([]);
    return;
  }

  // 5.8: one navigation, to the redeemed squad where the Redemption carried an
  // identity and to the Squads_Home otherwise, **replacing** the history entry
  // in both cases — the current path carries the Invite_Secret, so a push would
  // leave it one back-activation away.
  const squadId = outcome.value.squadId;
  const expectedPath =
    squadId === null ? (squadsHomePath ?? HOME_ROUTE) : squadPath(squadId);

  expect(navigations).toEqual([
    { path: expectedPath, options: { replace: true } },
  ]);
}

// --- The property -----------------------------------------------------------

describe('useInviteRedemption — Property 11 (redemption is attempted at most once per rendered path)', () => {
  // Feature: web-squads-screens, Property 11: Redemption from the landing route is attempted at most once per rendered path
  // Validates: Requirements 5.2, 5.7, 5.8
  it('issues exactly one RedeemInvite for any Auth_State sequence that reaches authentication', async () => {
    await fc.assert(
      fc.asyncProperty(
        inviteSecretArb,
        sequenceReachingAuthenticationArb,
        redeemOutcomeArb,
        async (secret, sequence, outcome) => {
          const { api, log } = createRecordingSquadsApi(outcome);
          const { navigate, calls } = createRecordingNavigate();
          const path = inviteLandingPath(secret);
          const states = rendersOf(sequence);

          try {
            const previewDeltas = await driveRenders(states, {
              api,
              log,
              path,
              navigate,
            });

            expectPropertyEleven({
              states,
              previewDeltas,
              log,
              secret,
              outcome,
              navigations: calls,
            });
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 150 },
    );
  }, 120_000);

  // Feature: web-squads-screens, Property 11: Redemption from the landing route is attempted at most once per rendered path
  // Validates: Requirements 5.2, 5.7, 5.8
  it('issues exactly one RedeemInvite across repeated authenticated → unauthenticated → authenticated transitions', async () => {
    await fc.assert(
      fc.asyncProperty(
        inviteSecretArb,
        transitionCycleSequenceArb,
        redeemOutcomeArb,
        async (secret, sequence, outcome) => {
          const { api, log } = createRecordingSquadsApi(outcome);
          const { navigate, calls } = createRecordingNavigate();
          const path = inviteLandingPath(secret);
          const states = rendersOf(sequence);

          try {
            const previewDeltas = await driveRenders(states, {
              api,
              log,
              path,
              navigate,
            });

            expectPropertyEleven({
              states,
              previewDeltas,
              log,
              secret,
              outcome,
              navigations: calls,
            });
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 120 },
    );
  }, 120_000);

  // Feature: web-squads-screens, Property 11: Redemption from the landing route is attempted at most once per rendered path
  // Validates: Requirements 5.2, 5.8
  it('replaces the history entry on success, whether the redemption carries a squad identity or not', async () => {
    await fc.assert(
      fc.asyncProperty(
        inviteSecretArb,
        fc.option(fc.uuid(), { nil: null }),
        fc.option(fc.constantFrom('/app', '/app/squads'), { nil: undefined }),
        fc.array(authStateArb, { maxLength: 4 }),
        async (secret, squadId, squadsHomePath, laterStates) => {
          const outcome: CallResult<Redemption> = {
            kind: 'success',
            value: { membershipId: null, outcome: 'joined', squadId },
          };
          const { api, log } = createRecordingSquadsApi(outcome);
          const { navigate, calls } = createRecordingNavigate();
          const path = inviteLandingPath(secret);
          // Authenticated at the mount, so no preview is owed at all, then any
          // number of further renders — none of which may navigate again.
          const states: readonly AuthState[] = [
            'authenticated',
            ...laterStates,
          ];

          try {
            const previewDeltas = await driveRenders(states, {
              api,
              log,
              path,
              navigate,
              squadsHomePath,
            });

            expectPropertyEleven({
              states,
              previewDeltas,
              log,
              secret,
              outcome,
              navigations: calls,
              squadsHomePath,
            });

            // Nothing was pushed: every recorded navigation replaced.
            for (const navigation of calls) {
              expect(navigation.options).toEqual({ replace: true });
            }

            // The redemption settled while the session was still present, so
            // the route reports the redeemed phase — unless the session was
            // then lost at any point, which returns it to the handover surface
            // without navigating (Requirement 5.14) and, because the latch
            // holds, without redeeming again when authentication returns.
            const expectedPhase = states.includes('unauthenticated')
              ? 'handover'
              : 'redeemed';
            expect(screen.getByTestId('phase')).toHaveTextContent(
              expectedPhase,
            );
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 150 },
    );
  }, 120_000);
});
