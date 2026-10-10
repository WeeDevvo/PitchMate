/**
 * Property test for what leaving does to the Player_Stats_Screen (task 7.6).
 *
 * **Property 32: Leaving the screen or the session abandons everything.** Two
 * abandonments, asserted separately because they are separate triggers of the
 * same requirement, and one consequence asserted of each:
 *
 * 1. *For any* `GetPlayerProfile` call awaiting a response when the screen
 *    **unmounts**: the call is aborted, its response is disregarded, and no
 *    Player_Profile value, Generic_Profile_Failure, Not_Found_Treatment
 *    statement, or live-region announcement is rendered thereafter. A
 *    **remount** then issues exactly one fresh call.
 * 2. *For any* such call awaiting a response when the Auth_State transitions
 *    from `authenticated` to `unauthenticated`: the same — aborted,
 *    disregarded, and nothing rendered afterwards, with the screen still
 *    mounted and therefore still able to render something if the machine let
 *    it.
 *
 * Requirement 2.5 is the whole claim: *abort every call awaiting a response,
 * disregard the response of every such call, and render no Player_Profile value
 * thereafter.*
 *
 * ### How "aborted, and then disregarded" is checked
 *
 * The injected {@link PlayerStatsApi} is a stub that records the `AbortSignal`
 * the hook bounded each call with and answers nothing until a run says so. At
 * the abandonment, that signal is asserted `aborted`.
 *
 * Then — and this is the half a weaker test would skip — the abandoned call is
 * **released with a response**, including a perfectly good `success` carrying a
 * whole Player_Profile. A machine that merely stopped *asking* would pass the
 * abort assertion and then quietly render the answer anyway; every assertion
 * after the release is what rules that out. The stub therefore leaves an aborted
 * call **unsettled** rather than failing it the way the real seam does, which is
 * strictly harder: the hook must disregard a late response whatever it says, not
 * merely a late failure.
 *
 * The lapse of the Profile_Call_Timeout is one of the generated late arrivals,
 * driven by `vi.useFakeTimers()` on a `setTimeout` like the seam's own, so that
 * arm is reached by advancing the clock rather than by waiting ten seconds out.
 *
 * ### How "nothing rendered" is checked, and why it is not vacuous
 *
 * The Player_Stats_Screen does not exist yet, so the machine is rendered through
 * a harness defined in this file — a deliberately plain one, because this
 * property is about *whether* a profile value, a failure, or an announcement is
 * rendered at all, not about how any surface presents one. The harness renders a
 * live region carrying exactly the failure and not-found announcements, a busy
 * indication, and the held profile's name and identity.
 *
 * Every generated profile carries a unique `pmz-…` display name, and the
 * assertion searches the rendered text *and every rendered attribute value* for
 * those tokens. Two guards keep the absence assertions honest:
 *
 * - **Inline:** where a run held a profile before abandoning, its token is
 *   asserted **present** first, so "absent afterwards" is a change rather than a
 *   restatement of an empty tree.
 * - **Per run, after the remount:** the fresh call is settled with the same
 *   outcome the abandoned one was released with, and the harness is asserted to
 *   render exactly what that outcome owes — the profile token, the
 *   Generic_Profile_Failure, or the Not_Found_Treatment statement. So every
 *   token the absence assertions look for is one the harness demonstrably
 *   renders when it should.
 *
 * A standing {@link describe} block below also asserts the harness renders each
 * of the four presentations from first principles, so a harness that quietly
 * stopped rendering one of them fails loudly rather than making a suite pass.
 *
 * ### Why the harness, and not `renderHook`
 *
 * Requirement 2.5 is a claim about what is **rendered** after an abandonment,
 * and a live-region announcement is not readable off a hook's return value. The
 * Auth_State arrives as a **prop**, which is exactly how it moves in the app —
 * `useAuth().state` changing re-renders the screen — so no `AuthProvider` is
 * needed, and no router: the subject is handed over as a resolved `Subject` the
 * way the screen will hand it over once `readSubject` has read the route's two
 * parameters.
 *
 * ### Not claimed here
 *
 * That the reducer is pure and total (Property 29), that one call is issued per
 * subject (Property 30), or that an unidentifiable subject is indistinguishable
 * from a concealed absence (Property 31). Each is its own file; nothing below
 * re-decides any of them.
 *
 * Feature: web-player-stats-screen, Property 32: Leaving the screen or the session abandons everything
 * Validates: Requirements 2.5
 */

import { useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import fc from 'fast-check';

import type { AuthState } from '../../auth';
import {
  PROFILE_CALL_TIMEOUT_MS,
  type CallResult,
  type PlayerStatsApi,
} from '../api/playerStatsApi';
import {
  GENERIC_PROFILE_FAILURE,
  NOT_FOUND_TREATMENT_STATEMENT,
  PROFILE_LOADING_LABEL,
  RETRY_LABEL,
} from '../lib/messages';
import type { PlayerProfile } from '../lib/parse/playerProfile';
import { readSubject, subjectKey, type Subject } from '../lib/subject';
import { playerProfileFixtureArb } from '../testing/playerProfileFixtures';
import {
  usePlayerStatsScreen,
  type PlayerStatsScreenMachine,
} from './usePlayerStatsScreen';

/* -------------------------------------------------------------------------- */
/* Driving React and the faked clock                                          */
/* -------------------------------------------------------------------------- */

/**
 * How many microtask turns {@link flush} drains.
 *
 * A settled call runs through several chained `then`s — the stub's promise, the
 * hook's `settle` path, React's update — so one turn is not enough. Sixteen is
 * comfortably more than the deepest chain and costs nothing, since draining an
 * empty queue is free.
 */
const MICROTASK_ROUNDS = 16;

/** Drain the microtask queue without moving the clock. */
async function drainMicrotasks(): Promise<void> {
  for (let round = 0; round < MICROTASK_ROUNDS; round += 1) {
    await Promise.resolve();
  }
}

/**
 * Let every already-resolved promise deliver and every resulting React update
 * apply, without moving the clock.
 *
 * This is how "has the machine reacted yet?" is answered deterministically: no
 * run depends on a real delay, and every assertion is made against settled
 * state.
 */
async function flush(): Promise<void> {
  await act(async () => {
    await drainMicrotasks();
  });
}

/**
 * Move the faked clock forward by `ms`, applying whatever the elapsed timers set
 * in motion.
 *
 * `advanceTimersByTimeAsync` awaits between timer callbacks, so a call the lapse
 * settles has its outcome delivered before this resolves.
 */
async function advanceClock(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await flush();
}

/* -------------------------------------------------------------------------- */
/* The recording Player_Stats_Api                                             */
/* -------------------------------------------------------------------------- */

/** One `GetPlayerProfile` call the hook issued, and the means to answer it. */
interface RecordedCall {
  /** The call's position in the order every call was issued. */
  readonly sequence: number;
  /** The squad identity the call carried. */
  readonly squadId: string;
  /** The membership identity the call carried. */
  readonly membershipId: string;
  /** The {@link subjectKey} of the pair the call carried. */
  readonly key: string;
  /** The signal the hook bounded the call with — what the abort claim reads. */
  readonly signal: AbortSignal | undefined;
  /** Whether this call has been answered, by a run or by the lapsed timeout. */
  settled(): boolean;
  /** Whether the hook has aborted this call (Requirement 2.5). */
  aborted(): boolean;
  /** Answer the call, then let the hook and React react. */
  settle(result: CallResult<PlayerProfile>): Promise<void>;
}

/** A Player_Stats_Api whose one method a run answers by hand. */
interface RecordingApi {
  /** The facade to hand to the harness. */
  readonly api: PlayerStatsApi;
  /** Every call issued, in the order issued. */
  readonly calls: readonly RecordedCall[];
}

/**
 * Create a Player_Stats_Api that records every call — the pair it carried and
 * the `AbortSignal` the hook bounded it with — and answers none until a run says
 * so, except for its Profile_Call_Timeout, which answers an unanswered call at
 * {@link PROFILE_CALL_TIMEOUT_MS} exactly as the real seam does.
 *
 * An abort deliberately does **not** settle the call here, though the real seam
 * settles a caller-aborted call as `transport-failure`. Leaving it open is what
 * lets a run deliver a **success** to an abandoned machine, which is the harder
 * test: the hook must disregard a late response whatever it says.
 */
function createRecordingApi(): RecordingApi {
  const calls: RecordedCall[] = [];

  const api: PlayerStatsApi = {
    getPlayerProfile(squadId, membershipId, signal) {
      let deliver: (result: CallResult<PlayerProfile>) => void = () => undefined;
      const answer = new Promise<CallResult<PlayerProfile>>((resolve) => {
        deliver = resolve;
      });

      let isSettled = false;

      // Answering twice is a no-op rather than an error, so a run can release
      // "whatever is outstanding" without first working out what already is.
      // `timer` is declared below and read only from this closure, which runs no
      // earlier than the timer it clears.
      const finish = (result: CallResult<PlayerProfile>): void => {
        if (isSettled) {
          return;
        }
        isSettled = true;
        clearTimeout(timer);
        deliver(result);
      };

      // 12.3 as the seam implements it: `setTimeout` rather than
      // `AbortSignal.timeout`, so the limit is advanced rather than waited out.
      const timer = setTimeout(() => {
        finish({ kind: 'timeout' });
      }, PROFILE_CALL_TIMEOUT_MS);

      calls.push({
        sequence: calls.length,
        squadId,
        membershipId,
        key: subjectKey({ squadId, membershipId }),
        signal,
        settled: () => isSettled,
        aborted: () => signal?.aborted ?? false,
        settle: async (result) => {
          finish(result);
          await flush();
        },
      });

      return answer;
    },
  };

  return { api, calls };
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** The attribute every rendered Player_Profile value carries. */
const PROFILE_VALUE_ATTRIBUTE = 'data-player-stats-value';

/** The test id of the live region carrying the failure and not-found statements. */
const ANNOUNCEMENT_TEST_ID = 'announcement';

/** The test id of the busy indication rendered while a call awaits a response. */
const BUSY_TEST_ID = 'busy';

interface HarnessProps {
  readonly api: PlayerStatsApi;
  readonly subject: Subject | null;
  readonly authState: AuthState;
  /** Filled after every render, so a run can activate the retry control. */
  readonly machineRef: { current: PlayerStatsScreenMachine | null };
}

/**
 * The load machine, rendered the way the Player_Stats_Screen will render it: the
 * held Player_Profile, a busy indication, a live region carrying the
 * Generic_Profile_Failure and the Not_Found_Treatment statement, and the retry
 * control.
 *
 * Deliberately plain. Requirement 2.5 is a claim about whether any of those four
 * is rendered **at all** after an abandonment, so every presentational decision
 * the real components will make — headings, sections, the chart — would only add
 * surface without putting a further abandonment decision under test.
 *
 * Only the failure and the not-found statement go in the live region, so "no
 * live-region announcement thereafter" is an assertion about an *empty* region
 * on a mounted screen rather than about a missing node.
 */
function AbandonmentHarness({
  api,
  subject,
  authState,
  machineRef,
}: HarnessProps): ReactElement {
  const machine = usePlayerStatsScreen({ api, subject, authState });

  // Test-only: the machine as of the last commit, so an activation goes through
  // the current one rather than a stale closure. Written in an effect rather
  // than during render, so the harness stays a pure component.
  useEffect(() => {
    machineRef.current = machine;
  });

  const announcement = machine.failed
    ? GENERIC_PROFILE_FAILURE
    : machine.notFound
      ? NOT_FOUND_TREATMENT_STATEMENT
      : '';

  return (
    <div>
      <span data-testid="phase">{machine.phase}</span>

      {machine.busy ? (
        <p data-testid={BUSY_TEST_ID}>{PROFILE_LOADING_LABEL}</p>
      ) : null}

      {/* The Player_Profile value Requirement 2.5 forbids after abandonment. */}
      {machine.profile === null ? null : (
        <p
          data-testid="profile"
          {...{ [PROFILE_VALUE_ATTRIBUTE]: machine.profile.membershipId }}
        >
          {machine.profile.displayName} {machine.profile.membershipId}
        </p>
      )}

      <p data-testid={ANNOUNCEMENT_TEST_ID} role="status" aria-live="polite">
        {announcement}
      </p>

      <button
        type="button"
        data-testid="retry"
        onClick={() => {
          machine.retry();
        }}
      >
        {RETRY_LABEL}
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Reading the rendered output                                                */
/* -------------------------------------------------------------------------- */

/** Everything the interface presents at one instant. */
interface Rendered {
  /** The rendered text, plus every rendered attribute value. */
  readonly content: string;
  /** The text of the live region, or `''` when none is mounted. */
  readonly announcement: string;
  /** How many Player_Profile values are rendered. */
  readonly profileValues: number;
  /** How many busy indications are rendered. */
  readonly busyIndications: number;
}

/**
 * Read the whole document — rendered text *and* every attribute value, since a
 * value can reach the interface through either.
 *
 * Works whether or not the harness is mounted, which is what lets the same
 * assertion serve the unmount and the session-loss abandonment.
 */
function readRendered(): Rendered {
  const parts: string[] = [document.body.textContent ?? ''];

  for (const element of Array.from(document.body.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      parts.push(attribute.value);
    }
  }

  const region = document.querySelector(
    `[data-testid="${ANNOUNCEMENT_TEST_ID}"]`,
  );

  return {
    content: parts.join('\n'),
    announcement: region?.textContent ?? '',
    profileValues: document.querySelectorAll(`[${PROFILE_VALUE_ATTRIBUTE}]`)
      .length,
    busyIndications: document.querySelectorAll(
      `[data-testid="${BUSY_TEST_ID}"]`,
    ).length,
  };
}

/**
 * Assert that the interface presents no Player_Profile value, no failure, no
 * not-found statement, no live-region announcement, and no busy state — and that
 * neither of the run's two profile tokens appears anywhere in it.
 *
 * The one assertion Requirement 2.5 asks for after an abandonment, made at every
 * point after it: immediately, and again once the abandoned call has answered.
 */
function expectNothingPresented(tokens: readonly string[]): void {
  const rendered = readRendered();

  expect(rendered.profileValues).toBe(0);
  expect(rendered.busyIndications).toBe(0);
  expect(rendered.announcement).toBe('');
  expect(rendered.content).not.toContain(GENERIC_PROFILE_FAILURE);
  expect(rendered.content).not.toContain(NOT_FOUND_TREATMENT_STATEMENT);
  expect(rendered.content).not.toContain(PROFILE_LOADING_LABEL);

  for (const token of tokens) {
    expect(rendered.content).not.toContain(token);
  }
}

/* -------------------------------------------------------------------------- */
/* Generated scenario parts                                                   */
/* -------------------------------------------------------------------------- */

/**
 * How the abandoned call answers, *after* it has been abandoned.
 *
 * All six are generated because "its response is disregarded" has to hold for
 * every response the seam can produce, and the first is the one that matters
 * most: a `success` carrying a whole Player_Profile is what a machine that
 * merely stopped asking would happily render.
 *
 * `timeout` is delivered by hand and `lapsed-timeout` by advancing the faked
 * clock through the whole Profile_Call_Timeout, because the two reach the arm by
 * different routes and only the second exercises a timer that outlived the
 * screen.
 */
const LATE_ANSWERS = [
  'success',
  'not-found',
  'transport-failure',
  'parse-failure',
  'timeout',
  'lapsed-timeout',
] as const;

/** One way an abandoned call answers. */
type LateAnswer = (typeof LATE_ANSWERS)[number];

/** A subject the Player_Stats_Route could carry, resolved by `readSubject`. */
function requireSubject(squadId: string, membershipId: string): Subject {
  const subject = readSubject(squadId, membershipId);

  if (subject === null) {
    throw new Error(
      `the generated pair ${squadId}/${membershipId} is not a valid subject`,
    );
  }

  return subject;
}

/** One subject of the Player_Stats_Screen. */
const subjectArb: fc.Arbitrary<Subject> = fc
  .tuple(fc.uuid(), fc.uuid())
  .map(([squadId, membershipId]) => requireSubject(squadId, membershipId));

/** A value that cannot occur in the feature's own copy by accident. */
const tokenArb: fc.Arbitrary<string> = fc.uuid().map((id) => `pmz-${id}`);

/**
 * A parsed Player_Profile whose display name is a unique token, so "this value
 * is not rendered" can be asserted by searching the interface for it.
 *
 * Deliberately a *small* profile: this suite never looks inside one beyond the
 * name and the identity, so the 200-by-500 extremes `playerProfileArb` reaches
 * would cost a great deal per run and prove nothing further here. Every value is
 * still the parsed side of a valid `GetPlayerProfile` body.
 */
const tokenProfileArb: fc.Arbitrary<PlayerProfile> = fc
  .tuple(
    playerProfileFixtureArb({
      pairwise: { minLength: 0, maxLength: 2 },
      progression: { minLength: 0, maxLength: 3 },
    }),
    tokenArb,
  )
  .map(([fixture, token]) => ({ ...fixture.parsed, displayName: token }));

/** One generated abandonment. */
interface Scenario {
  readonly subject: Subject;
  /**
   * Whether a Player_Profile had already been accepted and rendered when the
   * abandonment happened, with a second call then put in flight by the retry
   * control.
   *
   * Both cases matter, and differently: a held profile must **stop being
   * rendered**, while a call awaiting a response must be **aborted and then
   * disregarded**. The held case is also this suite's inline non-vacuity guard,
   * since its token is asserted present before it is asserted absent.
   */
  readonly holdFirst: boolean;
  /** The profile held before the abandonment, where one is. */
  readonly heldProfile: PlayerProfile;
  /** The profile the abandoned call answers with, where it answers `success`. */
  readonly lateProfile: PlayerProfile;
  /** How the abandoned call answers once it has been abandoned. */
  readonly lateAnswer: LateAnswer;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  subject: subjectArb,
  holdFirst: fc.boolean(),
  heldProfile: tokenProfileArb,
  lateProfile: tokenProfileArb,
  lateAnswer: fc.constantFrom(...LATE_ANSWERS),
});

/* -------------------------------------------------------------------------- */
/* Driving one scenario                                                       */
/* -------------------------------------------------------------------------- */

/** One mounted harness, and the recorder beneath it. */
interface Mounted {
  readonly recorder: RecordingApi;
  /** The machine as of the last commit. */
  machine(): PlayerStatsScreenMachine;
  /** Hand over a changed Auth_State, as `useAuth().state` changing does. */
  setAuthState(next: AuthState): Promise<void>;
  /** Activate the retry control. */
  activateRetry(): Promise<void>;
  /** Leave the screen. */
  unmount(): Promise<void>;
}

/** Mount the harness over a fresh recorder, and settle its mount effects. */
async function mountHarness(
  subject: Subject,
  recorder: RecordingApi = createRecordingApi(),
): Promise<Mounted> {
  const machineRef: { current: PlayerStatsScreenMachine | null } = {
    current: null,
  };

  let props: HarnessProps = {
    api: recorder.api,
    subject,
    authState: 'authenticated',
    machineRef,
  };

  const rendered = render(<AbandonmentHarness {...props} />);
  await flush();

  const commit = async (next: HarnessProps): Promise<void> => {
    props = next;
    await act(async () => {
      rendered.rerender(<AbandonmentHarness {...next} />);
      await drainMicrotasks();
    });
  };

  const machine = (): PlayerStatsScreenMachine => {
    const current = machineRef.current;

    if (current === null) {
      throw new Error('the harness has not committed a machine');
    }

    return current;
  };

  return {
    recorder,
    machine,
    setAuthState: (next) => commit({ ...props, authState: next }),
    activateRetry: async () => {
      await act(async () => {
        machine().retry();
        await drainMicrotasks();
      });
    },
    unmount: async () => {
      await act(async () => {
        rendered.unmount();
        await drainMicrotasks();
      });
    },
  };
}

/**
 * Bring the screen to the state the abandonment happens in, and return the call
 * that will be abandoned.
 *
 * Either the mount's own call is still awaiting a response, or a profile has
 * been accepted and rendered and the retry control has put a second call in
 * flight behind it — which is the case where Requirement 2.5's "render no
 * Player_Profile value thereafter" has something to take away.
 */
async function reachAbandonmentPoint(
  mounted: Mounted,
  scenario: Scenario,
): Promise<RecordedCall> {
  const { recorder } = mounted;

  // The mount issues exactly one call, so a machine that issued none could not
  // satisfy the rest of this property by doing nothing at all.
  expect(recorder.calls).toHaveLength(1);
  expect(recorder.calls[0].key).toBe(subjectKey(scenario.subject));
  expect(recorder.calls[0].signal).toBeDefined();
  expect(recorder.calls[0].aborted()).toBe(false);
  expect(mounted.machine().busy).toBe(true);
  expect(readRendered().busyIndications).toBe(1);
  expect(readRendered().announcement).toBe('');

  if (!scenario.holdFirst) {
    return recorder.calls[0];
  }

  await recorder.calls[0].settle({
    kind: 'success',
    value: scenario.heldProfile,
  });

  // Non-vacuity: the held profile really is on screen, so its absence after the
  // abandonment is a change rather than a restatement of an empty tree.
  expect(mounted.machine().profile).toBe(scenario.heldProfile);
  expect(readRendered().content).toContain(scenario.heldProfile.displayName);
  expect(readRendered().profileValues).toBe(1);

  await mounted.activateRetry();

  // 2.3: the held profile keeps rendering beside the busy state while the
  // re-read is in flight — which is the value the abandonment must then drop.
  expect(recorder.calls).toHaveLength(2);
  expect(mounted.machine().phase).toBe('refreshing');
  expect(readRendered().content).toContain(scenario.heldProfile.displayName);
  expect(readRendered().busyIndications).toBe(1);

  return recorder.calls[1];
}

/** Release the abandoned call with the answer the scenario generated. */
async function releaseLate(
  call: RecordedCall,
  scenario: Scenario,
): Promise<void> {
  if (scenario.lateAnswer === 'lapsed-timeout') {
    // The whole Profile_Call_Timeout, advanced rather than waited out — a timer
    // that outlived the abandonment, firing into a machine that has left.
    await advanceClock(PROFILE_CALL_TIMEOUT_MS);
    return;
  }

  await call.settle(
    scenario.lateAnswer === 'success'
      ? { kind: 'success', value: scenario.lateProfile }
      : { kind: scenario.lateAnswer },
  );
}

/** Both profile tokens of a run, neither of which may be presented after it. */
function tokensOf(scenario: Scenario): readonly string[] {
  return [scenario.heldProfile.displayName, scenario.lateProfile.displayName];
}

/**
 * Settle a call with the scenario's answer and assert the harness renders
 * exactly what that answer owes.
 *
 * The per-run non-vacuity guard. Every token the absence assertions look for —
 * a profile display name, the Generic_Profile_Failure, the Not_Found_Treatment
 * statement — is demonstrated here to be one this harness really renders when
 * the machine reaches that condition, on the same generated inputs and in the
 * same run.
 */
async function expectAnswerPresented(
  mounted: Mounted,
  call: RecordedCall,
  scenario: Scenario,
): Promise<void> {
  await releaseLate(call, scenario);

  const rendered = readRendered();

  switch (scenario.lateAnswer) {
    case 'success':
      expect(mounted.machine().phase).toBe('loaded');
      expect(rendered.profileValues).toBe(1);
      expect(rendered.content).toContain(scenario.lateProfile.displayName);
      expect(rendered.announcement).toBe('');
      break;

    case 'not-found':
      expect(mounted.machine().notFound).toBe(true);
      expect(rendered.profileValues).toBe(0);
      expect(rendered.announcement).toBe(NOT_FOUND_TREATMENT_STATEMENT);
      break;

    default:
      // 4.1, 4.3: every other arm is the generic failure, never the
      // Not_Found_Treatment.
      expect(mounted.machine().failed).toBe(true);
      expect(rendered.profileValues).toBe(0);
      expect(rendered.announcement).toBe(GENERIC_PROFILE_FAILURE);
      break;
  }
}

/* -------------------------------------------------------------------------- */
/* Clause one: unmounting                                                     */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 32: Leaving the screen or the session abandons everything
// Validates: Requirements 2.5
describe('Property 32 — unmounting aborts the call, disregards its response, and renders nothing thereafter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('aborts the call awaiting a response and presents nothing, whatever that call then answers', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const mounted = await mountHarness(scenario.subject);
        const abandoned = await reachAbandonmentPoint(mounted, scenario);
        const tokens = tokensOf(scenario);
        const issuedBeforeLeaving = mounted.recorder.calls.length;

        await mounted.unmount();

        // 2.5: the call awaiting a response is aborted by leaving the screen.
        expect(abandoned.signal).toBeDefined();
        expect(abandoned.aborted()).toBe(true);

        // Nothing is presented the moment the screen is left — including the
        // profile that was on screen a moment ago.
        expectNothingPresented(tokens);

        // 2.5: and the abandoned call's response is disregarded. This is the
        // half that matters: the answer below is as often as not a perfectly
        // good Player_Profile.
        await releaseLate(abandoned, scenario);

        expectNothingPresented(tokens);

        // Leaving issues nothing either, and neither does the late answer: no
        // re-read, no fallback, no retry (Requirement 2.6).
        expect(mounted.recorder.calls).toHaveLength(issuedBeforeLeaving);
      }),
      // Comfortably above the 100-run floor, and enough that each of the six
      // late answers meets both the held and the unheld case many times over.
      { numRuns: 150 },
    );
  }, 180_000);

  it('issues exactly one fresh call on a remount, and renders that call’s own answer', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        // One recorder across both mounts, so the remount's call is counted
        // against every call the first mount issued rather than against a
        // cleared slate.
        const recorder = createRecordingApi();
        const first = await mountHarness(scenario.subject, recorder);
        const abandoned = await reachAbandonmentPoint(first, scenario);
        const tokens = tokensOf(scenario);
        const issuedBeforeLeaving = recorder.calls.length;

        await first.unmount();
        await releaseLate(abandoned, scenario);
        expectNothingPresented(tokens);

        const second = await mountHarness(scenario.subject, recorder);

        // A remount is a fresh load: exactly one further call, for the same
        // subject, on a signal of its own rather than the abandoned one.
        const fresh = recorder.calls.slice(issuedBeforeLeaving);
        expect(fresh).toHaveLength(1);
        expect(fresh[0].key).toBe(subjectKey(scenario.subject));
        expect(fresh[0].squadId).toBe(scenario.subject.squadId);
        expect(fresh[0].membershipId).toBe(scenario.subject.membershipId);
        expect(fresh[0].signal).toBeDefined();
        expect(fresh[0].signal).not.toBe(abandoned.signal);
        expect(fresh[0].aborted()).toBe(false);

        // The fresh load holds nothing from before it: no profile of the
        // abandoned mount, and no failure or not-found carried over.
        expect(second.machine().phase).toBe('loading');
        expect(second.machine().profile).toBeNull();
        expect(readRendered().profileValues).toBe(0);
        expect(readRendered().announcement).toBe('');
        for (const token of tokens) {
          expect(readRendered().content).not.toContain(token);
        }

        // Non-vacuity for the whole file: this harness does render a profile
        // value, the Generic_Profile_Failure, and the Not_Found_Treatment
        // statement when the machine reaches those conditions un-abandoned.
        await expectAnswerPresented(second, fresh[0], scenario);

        await second.unmount();
      }),
      { numRuns: 150 },
    );
  }, 180_000);
});

/* -------------------------------------------------------------------------- */
/* Clause two: the session ending                                             */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 32: Leaving the screen or the session abandons everything
// Validates: Requirements 2.5
describe('Property 32 — an ended session aborts the call, disregards its response, and renders nothing thereafter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('aborts the call awaiting a response and presents nothing, with the screen still mounted', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const mounted = await mountHarness(scenario.subject);
        const abandoned = await reachAbandonmentPoint(mounted, scenario);
        const tokens = tokensOf(scenario);
        const issuedBeforeLoss = mounted.recorder.calls.length;

        try {
          await mounted.setAuthState('unauthenticated');

          // 2.5: the transition from `authenticated` aborts the call awaiting a
          // response.
          expect(abandoned.signal).toBeDefined();
          expect(abandoned.aborted()).toBe(true);

          // The screen is still mounted, so this is a claim about a rendered
          // tree that *could* be showing something: the live region is present
          // and empty, no profile value remains, and the busy state is gone.
          expect(
            document.querySelector(`[data-testid="${ANNOUNCEMENT_TEST_ID}"]`),
          ).not.toBeNull();
          expect(mounted.machine().profile).toBeNull();
          expect(mounted.machine().busy).toBe(false);
          expect(mounted.machine().notFound).toBe(false);
          expect(mounted.machine().failed).toBe(false);
          expectNothingPresented(tokens);

          // 2.5: and the abandoned call's response is disregarded, however good
          // it is and however long after the session ended it arrives.
          await releaseLate(abandoned, scenario);

          expectNothingPresented(tokens);

          // An ended session issues nothing further either — not on the
          // transition, not on the late answer, and not on an activation of the
          // retry control, which has nothing left to re-read.
          await mounted.activateRetry();

          expect(mounted.recorder.calls).toHaveLength(issuedBeforeLoss);
          expectNothingPresented(tokens);
        } finally {
          await mounted.unmount();
        }
      }),
      { numRuns: 150 },
    );
  }, 180_000);
});

/* -------------------------------------------------------------------------- */
/* The harness is not silent                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A fixed profile for the standing non-vacuity block, drawn with a pinned seed
 * so the suite is deterministic.
 */
const SAMPLE_PROFILE: PlayerProfile = fc.sample(tokenProfileArb, {
  numRuns: 1,
  seed: 32,
})[0];

/** A fixed subject, for the same reason. */
const SAMPLE_SUBJECT: Subject = requireSubject(
  '0a9d4a1e-1f2b-4c3d-8e5f-6a7b8c9d0e1f',
  '1b8c3b2f-2e3c-4d4e-9f6a-7b8c9d0e1f20',
);

// Feature: web-player-stats-screen, Property 32: Leaving the screen or the session abandons everything
// Validates: Requirements 2.5
describe('Property 32 — the harness renders what the absence assertions look for', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders the busy indication, the profile value, the failure, and the not-found statement when nothing is abandoned', async () => {
    // Every assertion of the two suites above is an absence. This is the guard
    // that each of those absences is observable in the first place: a harness
    // that rendered none of the four would make them all vacuously true.
    const busy = await mountHarness(SAMPLE_SUBJECT);
    expect(readRendered().busyIndications).toBe(1);
    expect(readRendered().content).toContain(PROFILE_LOADING_LABEL);

    await busy.recorder.calls[0].settle({
      kind: 'success',
      value: SAMPLE_PROFILE,
    });
    expect(readRendered().profileValues).toBe(1);
    expect(readRendered().content).toContain(SAMPLE_PROFILE.displayName);
    expect(readRendered().busyIndications).toBe(0);
    await busy.unmount();

    const failing = await mountHarness(SAMPLE_SUBJECT);
    await failing.recorder.calls[0].settle({ kind: 'transport-failure' });
    expect(readRendered().announcement).toBe(GENERIC_PROFILE_FAILURE);
    await failing.unmount();

    const absent = await mountHarness(SAMPLE_SUBJECT);
    await absent.recorder.calls[0].settle({ kind: 'not-found' });
    expect(readRendered().announcement).toBe(NOT_FOUND_TREATMENT_STATEMENT);
    await absent.unmount();
  });
});
