/**
 * Property test for the Squads_Home's two entry points surviving every load state
 * (task 10.6).
 *
 * **Property 4: Both entry points are rendered in every load state.** *For any*
 * state of the Squads_Home load machine — awaiting the first response, holding a
 * non-empty collection, holding an empty collection, refreshing, and failed — the
 * Create_Squad entry point and the Join_Squad entry point are each rendered as
 * exactly one keyboard-operable control carrying an accessible name naming its
 * action.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | 2.2 — both entry points rendered beside cards and beside the empty state | the property, over all five states |
 * | 2.3 — *exactly one* control each, keyboard-operable, named for its action | {@link expectExactlyOneEntryPoint} |
 *
 * ### Exactly one, not at least one
 *
 * Requirement 2.3 says *exactly one* control per entry point, so
 * {@link expectExactlyOneEntryPoint} counts rather than fetches: a screen that
 * rendered a second Create_Squad button — one in the header and one inside the
 * empty state, say — fails here. That is the failure mode worth guarding, because
 * the empty state and the failure surface are the two places a duplicate entry
 * point is a natural thing to add.
 *
 * "Keyboard-operable" is asserted structurally: a native `<button>` that is
 * enabled, not removed from the tab order, and able to take focus. Native buttons
 * are activated by Enter and Space by the platform, so there is nothing
 * behavioural left to assert that would not be testing jsdom; what the *panels*
 * do once opened belongs to the Form_Panel focus property and to the worked
 * examples beside this screen.
 *
 * ### Reaching all five states through the screen, not around it
 *
 * Each state is established by driving the real screen over a fake Squads_Api
 * rather than by rendering a hand-made state, so the property covers the states
 * the screen can actually be in:
 *
 * | State | How it is reached |
 * | --- | --- |
 * | awaiting the first response | a `ListMySquads` promise that never settles |
 * | holding a non-empty collection | one accepted non-empty collection |
 * | holding an empty collection | one accepted empty collection |
 * | refreshing | an accepted collection, then a redemption with no squad identity, whose Requirement 4.7 fallback issues a second `ListMySquads` that never settles |
 * | failed | any non-success arm, all of which fold into the one failed phase |
 *
 * `refreshing` is the awkward one: with a collection held there is no retry
 * control on screen, so the only way in is the relist path — which is also the
 * path a person actually takes after joining a squad. Each run therefore proves
 * it *is* in that state ({@link expectLoadStateReached} demands the held cards and
 * the busy indication together) before asserting anything about the entry points,
 * so a scenario that quietly failed to arrive cannot pass the property.
 *
 * Feature: web-squads-screens, Property 4: Both entry points are rendered in every load state
 * Validates: Requirements 2.2, 2.3
 */
import { describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import fc from 'fast-check';
import { MemoryRouter } from 'react-router-dom';

import { HOME_ROUTE } from '../../app-shell';
import { AuthProvider, type SessionManager } from '../../auth';
import type { CallResult, SquadsApi } from '../api/squadsApi';
import { FAILURE_NOTICE_SELECTOR } from '../components/FailureNotice';
import { LOADING_INDICATION_SELECTOR } from '../components/LoadingIndication';
import { SQUAD_CARD_SELECTOR } from '../components/SquadCard';
import { SQUADS_EMPTY_STATE_SELECTOR } from '../components/SquadsEmptyState';
import type { MemberRole, MembershipStateValue } from '../lib/enumCodes';
import type { Redemption } from '../lib/parse/redemption';
import type { SquadSummary } from '../lib/parse/squadSummary';
import {
  CREATE_SQUAD_HEADING,
  INVITE_SECRET_LABEL,
  JOIN_SQUAD_HEADING,
  JOIN_SQUAD_SUBMIT_LABEL,
} from '../lib/messages';
import { SQUADS_HOME_SELECTOR, SquadsHome } from './SquadsHome';

// --- The load states ---------------------------------------------------------

/** Every state the Squads_Home load machine can render from. */
type LoadStateName =
  | 'awaiting-first-response'
  | 'listed-non-empty'
  | 'listed-empty'
  | 'refreshing'
  | 'failed';

const LOAD_STATES: readonly LoadStateName[] = [
  'awaiting-first-response',
  'listed-non-empty',
  'listed-empty',
  'refreshing',
  'failed',
];

// --- Generators --------------------------------------------------------------

const identityArb: fc.Arbitrary<string> = fc.uuid();

const roleArb: fc.Arbitrary<MemberRole | null> = fc.constantFrom(
  'owner' as const,
  'admin' as const,
  'member' as const,
  null,
);

const stateArb: fc.Arbitrary<MembershipStateValue | null> = fc.constantFrom(
  'active' as const,
  'inactive' as const,
  null,
);

/**
 * A held collection, with distinct identities as `ListMySquads` returns them.
 *
 * What these summaries *say* is Property 2's business and how they are *ordered*
 * is Property 1's; here they exist only so the held-collection and refreshing
 * states have something to hold.
 */
const summariesArb: fc.Arbitrary<readonly SquadSummary[]> = fc
  .array(
    fc.record({
      name: fc.constantFrom('Alpha AFC', 'Brackens', 'Thursday Ballers', 'Zebra FC'),
      role: roleArb,
      state: stateArb,
    }),
    { minLength: 1, maxLength: 4 },
  )
  .chain((bodies) =>
    fc
      .uniqueArray(identityArb, {
        minLength: bodies.length,
        maxLength: bodies.length,
      })
      .map((identities) =>
        bodies.map((body, index) => ({ ...body, squadId: identities[index] })),
      ),
  );

/**
 * Every non-success arm a `ListMySquads` call can settle on. All of them fold
 * into the single failed phase, so the property covers the failure surface
 * whatever produced it (Requirements 2.5, 17.2).
 */
const failureArb: fc.Arbitrary<CallResult<readonly SquadSummary[]>> =
  fc.constantFrom(
    { kind: 'transport-failure' } as const,
    { kind: 'timeout' } as const,
    { kind: 'parse-failure' } as const,
    { kind: 'auth-failure' } as const,
    { kind: 'not-found' } as const,
    { kind: 'rejected-input', reason: 'conflict' } as const,
  );

/** Either shape of invite, since the refreshing path goes through the form. */
const secretArb: fc.Arbitrary<string> = fc.constantFrom(
  'SHORTCODE1',
  'https://pitch-mate.co.uk/join/abcdef123456',
  'a',
);

interface Scenario {
  readonly loadState: LoadStateName;
  readonly summaries: readonly SquadSummary[];
  readonly failure: CallResult<readonly SquadSummary[]>;
  readonly secret: string;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  loadState: fc.constantFrom(...LOAD_STATES),
  summaries: summariesArb,
  failure: failureArb,
  secret: secretArb,
});

// --- The seams ---------------------------------------------------------------

/** A method no scenario here reaches. */
function unreached(method: string): () => never {
  return () => {
    throw new Error(`the ${method} call is not part of Property 4`);
  };
}

/** A call that never settles, so its state is the one under test. */
function neverSettles<T>(): Promise<CallResult<T>> {
  return new Promise<CallResult<T>>(() => undefined);
}

/**
 * A Squads_Api answering `ListMySquads` from a queue — the last outcome is reused
 * once the queue is exhausted — and `RedeemInvite` from one fixed outcome, which
 * is how the refreshing state is reached.
 */
function fakeApi(options: {
  readonly listOutcomes: readonly Promise<CallResult<readonly SquadSummary[]>>[];
  readonly redeemOutcome?: CallResult<Redemption>;
}): SquadsApi {
  let listCalls = 0;

  return {
    listMySquads: () => {
      const index = Math.min(listCalls, options.listOutcomes.length - 1);
      listCalls += 1;
      return options.listOutcomes[index];
    },
    redeemInvite: () => {
      if (options.redeemOutcome === undefined) {
        throw new Error('RedeemInvite is not part of this scenario');
      }
      return Promise.resolve(options.redeemOutcome);
    },
    getSquad: unreached('GetSquad'),
    getDisplayRatingLeaderboard: unreached('GetSquadLeaderboard'),
    createSquad: unreached('CreateSquad'),
    previewInvite: unreached('PreviewInvite'),
    listInvites: unreached('ListInvites'),
    generateInvite: unreached('GenerateInvite'),
    revokeInvite: unreached('RevokeInvite'),
    createGuest: unreached('CreateGuest'),
    editGuest: unreached('EditGuest'),
    promoteToAdmin: unreached('PromoteToAdmin'),
    getFeatureFlags: unreached('GetFeatureFlags'),
    setFeatureFlag: unreached('SetFeatureFlag'),
  };
}

/** A `SessionManager` reporting `authenticated`, the only listing state. */
function sessionManager(): SessionManager {
  return {
    bootstrap: () => 'authenticated',
    establish: () => undefined,
    getState: () => 'authenticated',
    getAccessTokenForRequest: () => Promise.resolve({ token: 'test-token' }),
    signOut: () => Promise.resolve(),
    subscribe: () => () => undefined,
  };
}

// --- Reaching a load state ---------------------------------------------------

/** Let every settled call deliver and every resulting React update apply. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 24; round += 1) {
      await Promise.resolve();
    }
  });
}

/** The `ListMySquads` queue a scenario needs. */
function listOutcomesFor(
  scenario: Scenario,
): readonly Promise<CallResult<readonly SquadSummary[]>>[] {
  const accepted = Promise.resolve<CallResult<readonly SquadSummary[]>>({
    kind: 'success',
    value: scenario.summaries,
  });

  switch (scenario.loadState) {
    case 'awaiting-first-response':
      return [neverSettles<readonly SquadSummary[]>()];
    case 'listed-non-empty':
      return [accepted];
    case 'listed-empty':
      return [Promise.resolve({ kind: 'success', value: [] })];
    case 'refreshing':
      // The held collection, then a second call left awaiting a response.
      return [accepted, neverSettles<readonly SquadSummary[]>()];
    case 'failed':
      return [Promise.resolve(scenario.failure)];
  }
}

/**
 * Render the Squads_Home into the scenario's load state.
 *
 * The refreshing state is the only one needing an interaction: joining with an
 * invite whose redemption carries no squad identity, which is the shape the
 * backend answers with today, takes the Requirement 4.7 fallback and issues the
 * second `ListMySquads` while the collection is still held.
 */
async function reachLoadState(scenario: Scenario): Promise<void> {
  const api = fakeApi({
    listOutcomes: listOutcomesFor(scenario),
    redeemOutcome:
      scenario.loadState === 'refreshing'
        ? {
            kind: 'success',
            value: {
              membershipId: '11111111-2222-4333-8444-555555555555',
              outcome: 'joined',
              squadId: null,
            },
          }
        : undefined,
  });

  render(
    <AuthProvider manager={sessionManager()}>
      <MemoryRouter initialEntries={[HOME_ROUTE]}>
        <SquadsHome api={api} />
      </MemoryRouter>
    </AuthProvider>,
  );

  await flush();

  if (scenario.loadState !== 'refreshing') {
    return;
  }

  fireEvent.click(screen.getByRole('button', { name: JOIN_SQUAD_HEADING }));
  fireEvent.change(screen.getByLabelText(INVITE_SECRET_LABEL), {
    target: { value: scenario.secret },
  });
  fireEvent.click(screen.getByRole('button', { name: JOIN_SQUAD_SUBMIT_LABEL }));

  await flush();
}

// --- The assertions ----------------------------------------------------------

function cardCount(): number {
  return document.querySelectorAll(SQUAD_CARD_SELECTOR).length;
}

function isRendered(selector: string): boolean {
  return document.querySelector(selector) !== null;
}

/**
 * The scenario is in the load state it claims.
 *
 * Asserted before the entry points so the property cannot be satisfied by five
 * runs of the same state — in particular, so `refreshing` is genuinely a held
 * collection *plus* a call awaiting a response rather than either alone.
 */
function expectLoadStateReached(scenario: Scenario): void {
  switch (scenario.loadState) {
    case 'awaiting-first-response':
      expect(isRendered(LOADING_INDICATION_SELECTOR)).toBe(true);
      expect(cardCount()).toBe(0);
      expect(isRendered(SQUADS_EMPTY_STATE_SELECTOR)).toBe(false);
      expect(isRendered(FAILURE_NOTICE_SELECTOR)).toBe(false);
      break;
    case 'listed-non-empty':
      expect(cardCount()).toBe(scenario.summaries.length);
      expect(isRendered(LOADING_INDICATION_SELECTOR)).toBe(false);
      expect(isRendered(SQUADS_EMPTY_STATE_SELECTOR)).toBe(false);
      expect(isRendered(FAILURE_NOTICE_SELECTOR)).toBe(false);
      break;
    case 'listed-empty':
      expect(isRendered(SQUADS_EMPTY_STATE_SELECTOR)).toBe(true);
      expect(cardCount()).toBe(0);
      expect(isRendered(FAILURE_NOTICE_SELECTOR)).toBe(false);
      break;
    case 'refreshing':
      // 1.15: the held cards keep rendering *and* the busy state is reported.
      expect(cardCount()).toBe(scenario.summaries.length);
      expect(isRendered(LOADING_INDICATION_SELECTOR)).toBe(true);
      expect(isRendered(FAILURE_NOTICE_SELECTOR)).toBe(false);
      break;
    case 'failed':
      expect(isRendered(FAILURE_NOTICE_SELECTOR)).toBe(true);
      expect(cardCount()).toBe(0);
      expect(isRendered(SQUADS_EMPTY_STATE_SELECTOR)).toBe(false);
      break;
  }
}

/**
 * Requirement 2.3: this entry point is *exactly one* control, reachable and
 * operable by keyboard, whose accessible name names its action.
 */
function expectExactlyOneEntryPoint(label: string): HTMLElement {
  const controls = screen.getAllByRole('button', { name: label });

  // Exactly one, so a duplicate added to the empty state or to the failure
  // surface fails rather than passes.
  expect(controls).toHaveLength(1);
  // And no control of another role answers to the same name either.
  expect(screen.queryAllByRole('link', { name: label })).toEqual([]);

  const control = controls[0];

  // Keyboard-operable: a native button, enabled, in the tab order, focusable.
  expect(control.tagName).toBe('BUTTON');
  expect(control.getAttribute('type')).toBe('button');
  expect(control.hasAttribute('disabled')).toBe(false);
  expect(control.getAttribute('aria-disabled')).toBeNull();
  expect(control.tabIndex).toBeGreaterThanOrEqual(0);
  control.focus();
  expect(document.activeElement).toBe(control);

  // Named for its action, in its own text rather than by position.
  expect(control).toHaveAccessibleName(label);
  // And rendered by the Squads_Home itself, not by the surface it sits beside.
  expect(control.closest(SQUADS_HOME_SELECTOR)).not.toBeNull();

  return control;
}

// --- The property ------------------------------------------------------------

describe('Property 4 — both entry points are rendered in every load state', () => {
  // Feature: web-squads-screens, Property 4: Both entry points are rendered in every load state
  // Validates: Requirements 2.2, 2.3
  it('renders each of the Create_Squad and Join_Squad entry points as exactly one keyboard-operable control, in every load state', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        try {
          await reachLoadState(scenario);

          expectLoadStateReached(scenario);

          const create = expectExactlyOneEntryPoint(CREATE_SQUAD_HEADING);
          const join = expectExactlyOneEntryPoint(JOIN_SQUAD_HEADING);

          // Two distinct controls, so neither entry point is the other one.
          expect(create).not.toBe(join);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 150 },
    );
  }, 180_000);
});
