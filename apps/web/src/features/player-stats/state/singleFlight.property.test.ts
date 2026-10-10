// Feature: web-player-stats-screen, Property 30: One call per subject
// Validates: Requirements 2.1, 2.4, 2.9

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import {
  PROFILE_CALL_TIMEOUT_MS,
  type CallResult,
  type PlayerStatsApi,
} from '../api/playerStatsApi';
import type { PlayerProfile } from '../lib/parse/playerProfile';
import { readSubject, subjectKey, type Subject } from '../lib/subject';
import { playerProfileFixtureArb } from '../testing/playerProfileFixtures';
import {
  usePlayerStatsScreen,
  type PlayerStatsScreenMachine,
  type PlayerStatsScreenOptions,
} from './usePlayerStatsScreen';

/**
 * Property tests for the Player_Stats_Screen's issue discipline — the claim
 * that the feature issues **one `GetPlayerProfile` call per subject** and never
 * renders a value from a subject it has left.
 *
 * ## The three clauses, and where each is asserted
 *
 * | Clause of Property 30 | Requirement | Where |
 * | --- | --- | --- |
 * | a sequence of re-renders with an unchanged subject issues exactly one call | 2.1 | {@link describe} "re-renders issue nothing further" |
 * | a change of subject aborts the previous call, issues exactly one call for the new subject, and renders no value from a superseded response — the late arrival included | 2.4 | "a change of subject" |
 * | a control activation while a call awaits a response issues no further call | 2.9 | "an activation while a call awaits a response" |
 *
 * ## Why the hook, and not the screen
 *
 * `usePlayerStatsScreen` is the feature's **only** issue site: the screen
 * renders from the machine and calls nothing itself, so "one call per subject"
 * is a fact about this hook rather than about any component above it. The
 * Player_Stats_Screen does not exist yet, and would add a router, an
 * `AuthProvider`, and a squad-scope publication to every one of these runs
 * without putting a single further issue decision under test. The hook is
 * mounted with `renderHook` and the subject is handed in as a plain prop, which
 * is exactly how the screen will hand it over once `readSubject` has resolved
 * the route's two parameters.
 *
 * ## The recording seam
 *
 * The injected {@link PlayerStatsApi} is a stub that **records every call and
 * answers none** until a run says so, which is what makes every activation and
 * every subject change happen while a call is genuinely awaiting a response —
 * the condition all three clauses are stated under. It records the pair each
 * call carried, the `AbortSignal` the hook bounded it with, and how many calls
 * were outstanding at once, so a machine that issued a second call and happened
 * to settle it first fails on the in-flight high-water mark rather than slipping
 * past a final count.
 *
 * Two deliberate choices in the stub:
 *
 * 1. **An abort does not settle the call.** The real seam settles a
 *    caller-aborted call as `transport-failure`; this one leaves it unsettled so
 *    a run can deliver a **success** for a superseded subject afterwards. That
 *    is a strictly harder test than reality: the hook must disregard a late
 *    response whatever it says, not merely a late failure.
 * 2. **The Profile_Call_Timeout is real.** An unanswered call settles as
 *    `timeout` at {@link PROFILE_CALL_TIMEOUT_MS}, on a `setTimeout` like the
 *    seam's own, so a run reaches that arm by advancing `vi.useFakeTimers()`
 *    rather than by waiting ten seconds out. Every suite below installs the
 *    faked clock, and time only ever moves where a run moves it.
 *
 * ## What is deliberately generated
 *
 * - **Every re-render cause the hook distinguishes.** The same props object, a
 *   *new* `Subject` object carrying the same pair, a freshly constructed api
 *   facade, and both at once. The second is the one a guard keyed on object
 *   identity would get wrong; the third is the one a guard keyed on the facade
 *   would.
 * - **Where in the sequence the call settles**, and how: a success, a
 *   not-found, two failing arms, a lapsed Profile_Call_Timeout, or never at all.
 *   "No re-render issues a further call" has to hold from every phase, not only
 *   from `loading`.
 * - **Chains of two to four distinct subjects**, so a navigation is followed by
 *   another navigation — which is what a run of Pairwise_Links is.
 * - **Both deliveries of a superseded response**: before the new subject's
 *   response and *after* it, which is the ordering a token-free guard gets
 *   wrong.
 * - **Bursts of activations inside one commit** as well as separate ones. A
 *   burst is the case a guard derived from rendered state gets wrong, because no
 *   render separates the activations.
 *
 * ## Not claimed here
 *
 * That the reducer is pure and total (Property 29), that an unidentifiable
 * subject is indistinguishable from a concealed absence (Property 31), and that
 * unmounting or an ended session abandons everything (Property 32). Each is its
 * own task and its own file; nothing below re-decides any of them.
 */

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
  /** The signal the hook bounded the call with (Requirements 2.4, 2.5). */
  readonly signal: AbortSignal | undefined;
  /** Whether this call has been answered, by a run or by the lapsed timeout. */
  settled(): boolean;
  /** Whether the hook has aborted this call. */
  aborted(): boolean;
  /** Answer the call, then let the hook and React react. */
  settle(result: CallResult<PlayerProfile>): Promise<void>;
}

/** A Player_Stats_Api whose one method a run answers by hand. */
interface RecordingApi {
  /** The facade to hand to the hook. */
  readonly api: PlayerStatsApi;
  /** Every call issued, in the order issued. */
  readonly calls: readonly RecordedCall[];
  /**
   * The greatest number of unanswered calls at any one instant.
   *
   * The sharp form of "one call per subject" where no abandonment is involved: a
   * machine that issued a second call and settled it before the assertion would
   * still be caught here.
   */
  readonly maxInFlight: number;
  /**
   * The calls that are neither answered nor aborted — the ones whose response
   * the hook would still accept.
   *
   * This is the form the assertion takes once a subject has changed, because an
   * abandoned call stays unanswered in this stub on purpose (see the module
   * comment) and so would inflate {@link maxInFlight} for a wholly correct
   * machine.
   */
  live(): readonly RecordedCall[];
}

/**
 * Create a Player_Stats_Api that records every call and answers none until a run
 * says so — except for its Profile_Call_Timeout, which answers an unanswered
 * call at {@link PROFILE_CALL_TIMEOUT_MS} exactly as the real seam does.
 */
function createRecordingApi(): RecordingApi {
  const calls: RecordedCall[] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const api: PlayerStatsApi = {
    getPlayerProfile(squadId, membershipId, signal) {
      let deliver: (result: CallResult<PlayerProfile>) => void = () => undefined;
      const answer = new Promise<CallResult<PlayerProfile>>((resolve) => {
        deliver = resolve;
      });

      let isSettled = false;

      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);

      // Answering twice is a no-op rather than an error, so a run can settle
      // "every outstanding call" without first working out which already have.
      // `timer` is declared below and read only from this closure, which runs
      // no earlier than the timer it clears.
      const finish = (result: CallResult<PlayerProfile>): void => {
        if (isSettled) {
          return;
        }
        isSettled = true;
        inFlight -= 1;
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

  return {
    api,
    calls,
    get maxInFlight(): number {
      return maxInFlight;
    },
    live: () => calls.filter((call) => !call.settled() && !call.aborted()),
  };
}

/**
 * A fresh facade over the same recorder, for a re-render that hands the hook a
 * newly constructed api object.
 *
 * The hook reads the facade through a ref precisely so this issues nothing
 * (Requirement 2.1); a dependency on the object's identity would issue a call
 * per render instead.
 */
function freshFacade(recorder: RecordingApi): PlayerStatsApi {
  return {
    getPlayerProfile: (squadId, membershipId, signal) =>
      recorder.api.getPlayerProfile(squadId, membershipId, signal),
  };
}

/* -------------------------------------------------------------------------- */
/* The mounted machine                                                        */
/* -------------------------------------------------------------------------- */

/** Everything a run reads off the machine, captured at one instant. */
interface Snapshot {
  readonly phase: PlayerStatsScreenMachine['phase'];
  readonly profile: PlayerProfile | null;
  readonly subjectKey: string | null;
  readonly busy: boolean;
  readonly notFound: boolean;
  readonly failed: boolean;
}

/** The machine's whole readable surface, for a comparison across an event. */
function snapshot(machine: PlayerStatsScreenMachine): Snapshot {
  return {
    phase: machine.phase,
    profile: machine.profile,
    subjectKey: machine.subjectKey,
    busy: machine.busy,
    notFound: machine.notFound,
    failed: machine.failed,
  };
}

/** One mounted hook, driven the way the Player_Stats_Screen will drive it. */
interface Screen {
  /** The machine as of the last commit. */
  machine(): PlayerStatsScreenMachine;
  /** Re-render with the same subject, the given cause of the re-render. */
  rerender(cause: RerenderCause): Promise<void>;
  /** Navigate to another subject, as a Pairwise_Link does. */
  setSubject(next: Subject): Promise<void>;
  /** Activate the retry control `times` times, optionally within one commit. */
  activate(times: number, burst: boolean): Promise<void>;
  /** Leave the screen. */
  unmount(): void;
}

/** Mount the load machine over a recording seam, and settle its mount effects. */
async function mountScreen(
  recorder: RecordingApi,
  subject: Subject,
): Promise<Screen> {
  let props: PlayerStatsScreenOptions = {
    api: recorder.api,
    subject,
    authState: 'authenticated',
  };

  const rendered = renderHook(
    (current: PlayerStatsScreenOptions) => usePlayerStatsScreen(current),
    { initialProps: props },
  );

  await flush();

  const commit = async (next: PlayerStatsScreenOptions): Promise<void> => {
    props = next;
    await act(async () => {
      rendered.rerender(next);
      await drainMicrotasks();
    });
  };

  return {
    machine: () => rendered.result.current,
    rerender: (cause) => commit(nextProps(props, recorder, cause)),
    setSubject: (next) => commit({ ...props, subject: next }),
    activate: async (times, burst): Promise<void> => {
      if (burst) {
        // Every activation inside one commit: no render separates them, so the
        // guard cannot have been a rendered value.
        await act(async () => {
          for (let index = 0; index < times; index += 1) {
            rendered.result.current.retry();
          }
          await drainMicrotasks();
        });
        return;
      }

      for (let index = 0; index < times; index += 1) {
        await act(async () => {
          rendered.result.current.retry();
          await drainMicrotasks();
        });
      }
    },
    unmount: () => {
      rendered.unmount();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Generated scenario parts                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Why the screen re-rendered, with the subject unchanged throughout.
 *
 * Every one of the four is a re-render the Player_Stats_Screen really meets, and
 * each would defeat a differently-keyed guard:
 *
 * - `same-props` — a parent's state change, re-running the effects' identity
 *   checks with nothing new at all;
 * - `new-subject-object` — `readSubject` building a fresh `Subject` from the
 *   same two route parameters, which is what it does on **every** render;
 * - `new-api-facade` — `createPlayerStatsApi` re-invoked above the screen;
 * - `new-both` — both at once.
 */
const RERENDER_CAUSES = [
  'same-props',
  'new-subject-object',
  'new-api-facade',
  'new-both',
] as const;

/** One cause of a re-render with an unchanged subject. */
type RerenderCause = (typeof RERENDER_CAUSES)[number];

/** The props a re-render of the given cause hands over. */
function nextProps(
  props: PlayerStatsScreenOptions,
  recorder: RecordingApi,
  cause: RerenderCause,
): PlayerStatsScreenOptions {
  const subject =
    props.subject === null ? null : { ...props.subject };

  switch (cause) {
    case 'same-props':
      return props;
    case 'new-subject-object':
      return { ...props, subject };
    case 'new-api-facade':
      return { ...props, api: freshFacade(recorder) };
    case 'new-both':
      return { ...props, api: freshFacade(recorder), subject };
  }
}

/**
 * How a call awaiting a response eventually settles.
 *
 * All five arms are generated because "no further call is issued" has to hold
 * from every phase the machine can be left in: a success that holds a profile, a
 * not-found, the two failing arms that hold none, and the lapse of our own
 * Profile_Call_Timeout — which is reached by advancing the faked clock rather
 * than by answering the call.
 */
const SETTLEMENTS = [
  'success',
  'not-found',
  'transport-failure',
  'parse-failure',
  'lapsed-timeout',
] as const;

/** One way a call awaiting a response settles. */
type Settlement = (typeof SETTLEMENTS)[number];

/** The arms a run can deliver by hand, i.e. every one but the lapsed limit. */
const DELIVERABLE_SETTLEMENTS = SETTLEMENTS.filter(
  (settlement): settlement is Exclude<Settlement, 'lapsed-timeout'> =>
    settlement !== 'lapsed-timeout',
);

/** Settle one call the way a {@link Settlement} describes. */
async function settleCall(
  call: RecordedCall,
  settlement: Settlement,
  profile: PlayerProfile,
): Promise<void> {
  if (settlement === 'lapsed-timeout') {
    // The whole Profile_Call_Timeout, advanced rather than waited out.
    await advanceClock(PROFILE_CALL_TIMEOUT_MS);
    return;
  }

  await call.settle(
    settlement === 'success'
      ? { kind: 'success', value: profile }
      : { kind: settlement },
  );
}

/**
 * A subject the Player_Stats_Route could carry, built through `readSubject` so
 * that it is a pair the route really resolves rather than one invented here.
 *
 * Throws rather than returning `null`, because the generators below only ever
 * produce well-formed identities: if the identity check were tightened under
 * this suite, every run would fail loudly instead of quietly testing the
 * unidentifiable path (which is Property 31's, not this one's).
 */
function requireSubject(squadId: string, membershipId: string): Subject {
  const subject = readSubject(squadId, membershipId);

  if (subject === null) {
    throw new Error(
      `the generated pair ${squadId}/${membershipId} is not a valid subject`,
    );
  }

  return subject;
}

/** A well-formed route identity. */
const identityArb: fc.Arbitrary<string> = fc.uuid();

/** One subject of the Player_Stats_Screen. */
const subjectArb: fc.Arbitrary<Subject> = fc
  .tuple(identityArb, identityArb)
  .map(([squadId, membershipId]) => requireSubject(squadId, membershipId));

/**
 * A chain of distinct subjects, as a run of Pairwise_Link navigations produces.
 *
 * Distinctness is by {@link subjectKey} rather than by object identity, because
 * the key is what the hook's guard compares: two subjects with the same key are
 * the *same* subject to it, and would make a "change of subject" assertion
 * vacuous.
 */
const subjectChainArb: fc.Arbitrary<readonly Subject[]> = fc.uniqueArray(
  subjectArb,
  { selector: subjectKey, minLength: 2, maxLength: 4 },
);

/**
 * A parsed Player_Profile, from the shared fixtures.
 *
 * Deliberately a *small* one: this suite never looks inside a profile, it only
 * compares the held value by reference, so the 200-by-500 extremes
 * `playerProfileArb` reaches would cost a great deal per run and prove nothing
 * further here. Every value is still the parsed side of a valid
 * `GetPlayerProfile` body, and every draw is a distinct object — which is what
 * lets "no value from a superseded subject" be asserted by reference.
 */
const heldProfileArb: fc.Arbitrary<PlayerProfile> = playerProfileFixtureArb({
  pairwise: { minLength: 0, maxLength: 2 },
  progression: { minLength: 0, maxLength: 3 },
}).map((fixture) => fixture.parsed);

/* -------------------------------------------------------------------------- */
/* Clause one: a re-render issues nothing                                     */
/* -------------------------------------------------------------------------- */

/** A run of re-renders with the subject unchanged throughout. */
interface RerenderScenario {
  readonly subject: Subject;
  readonly profile: PlayerProfile;
  /** The causes of the successive re-renders. */
  readonly causes: readonly RerenderCause[];
  /**
   * How many re-renders happen before the mount's call settles. Beyond the
   * length of {@link causes} the call never settles at all, so the whole run
   * happens with the call still awaiting a response.
   */
  readonly settleAfter: number;
  /** How that call settles, when it does. */
  readonly settlement: Settlement;
}

const rerenderScenarioArb: fc.Arbitrary<RerenderScenario> = fc.record({
  subject: subjectArb,
  profile: heldProfileArb,
  causes: fc.array(fc.constantFrom(...RERENDER_CAUSES), {
    minLength: 1,
    maxLength: 8,
  }),
  settleAfter: fc.nat({ max: 9 }),
  settlement: fc.constantFrom(...SETTLEMENTS),
});

// Feature: web-player-stats-screen, Property 30: One call per subject
// Validates: Requirements 2.1, 2.4, 2.9
describe('Property 30 — re-renders with an unchanged subject issue nothing further', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('issues exactly one call for a subject, however often and however the screen re-renders', async () => {
    await fc.assert(
      fc.asyncProperty(rerenderScenarioArb, async (scenario) => {
        const recorder = createRecordingApi();
        const screen = await mountScreen(recorder, scenario.subject);
        const key = subjectKey(scenario.subject);

        try {
          // 2.1: the mount issues exactly one call, and it carries the route's
          // own pair — so a machine that issued none could not satisfy the rest
          // of this property by doing nothing.
          expect(recorder.calls).toHaveLength(1);
          expect(recorder.calls[0].key).toBe(key);
          expect(recorder.calls[0].squadId).toBe(scenario.subject.squadId);
          expect(recorder.calls[0].membershipId).toBe(
            scenario.subject.membershipId,
          );
          expect(recorder.calls[0].aborted()).toBe(false);
          expect(screen.machine().subjectKey).toBe(key);
          expect(screen.machine().busy).toBe(true);

          for (const [index, cause] of scenario.causes.entries()) {
            if (index === scenario.settleAfter) {
              await settleCall(
                recorder.calls[0],
                scenario.settlement,
                scenario.profile,
              );

              // The settlement itself issues nothing: there is no automatic
              // re-read of any outcome, the lapsed timeout included.
              expect(recorder.calls).toHaveLength(1);
            }

            await screen.rerender(cause);

            // 2.1: the one claim of this clause, asserted after *every*
            // re-render rather than only at the end — so a run that issued a
            // second call and a third would be caught at the second.
            expect(recorder.calls).toHaveLength(1);
            expect(recorder.maxInFlight).toBe(1);
            expect(screen.machine().subjectKey).toBe(key);
          }

          // Nothing issued, and nothing abandoned either: the call the mount
          // issued is still the hook's own, because no re-render replaced it.
          expect(recorder.calls).toHaveLength(1);
          expect(recorder.calls[0].aborted()).toBe(false);
        } finally {
          screen.unmount();
        }
      }),
      // Comfortably above the 100-run floor, and enough that each of the four
      // re-render causes and five settlements is met many times over.
      { numRuns: 150 },
    );
  }, 180_000);
});

/* -------------------------------------------------------------------------- */
/* Clause two: a change of subject                                            */
/* -------------------------------------------------------------------------- */

/**
 * How one navigation of a chain plays out.
 *
 * The four differ in *when* each subject's response arrives relative to the
 * navigation, which is the only thing the clause turns on:
 *
 * - `held-then-navigate` — the previous subject's call was answered first, so a
 *   profile is on screen when the navigation happens and must be **dropped**
 *   rather than left beside the new subject's loading indication. There is
 *   nothing to abort, which is the one case where the abort claim is vacuous.
 * - `late-before-new` — the previous subject's call was still in flight; its
 *   response arrives while the new subject's call is still awaiting one.
 * - `late-after-new` — likewise in flight, but its response arrives **after**
 *   the new subject's. This is the ordering a guard without a token gets wrong:
 *   by then there is a perfectly good profile on screen for the current
 *   subject, and accepting the straggler would replace it with one belonging to
 *   the subject we left.
 * - `still-pending` — nothing is answered during the step at all, so the next
 *   navigation of the chain finds a call in flight to abandon in turn.
 */
const STEP_SHAPES = [
  'held-then-navigate',
  'late-before-new',
  'late-after-new',
  'still-pending',
] as const;

/** How one navigation of a chain plays out. */
type StepShape = (typeof STEP_SHAPES)[number];

/** One navigation in a chain, and how the two subjects' calls are answered. */
interface NavigationStep {
  /** When each subject's response arrives, relative to the navigation. */
  readonly shape: StepShape;
  /** What the superseded call reports, where the step delivers its response. */
  readonly supersededSettlement: Exclude<Settlement, 'lapsed-timeout'>;
}

const navigationStepArb: fc.Arbitrary<NavigationStep> = fc.record({
  shape: fc.constantFrom(...STEP_SHAPES),
  supersededSettlement: fc.constantFrom(...DELIVERABLE_SETTLEMENTS),
});

/** A chain of navigations, with a distinct profile waiting for each subject. */
interface NavigationScenario {
  readonly subjects: readonly Subject[];
  /** One profile per subject, every one a distinct object. */
  readonly profiles: readonly PlayerProfile[];
  /** One step per navigation, i.e. one fewer than there are subjects. */
  readonly steps: readonly NavigationStep[];
}

const navigationScenarioArb: fc.Arbitrary<NavigationScenario> = subjectChainArb
  .chain((subjects) =>
    fc.record({
      subjects: fc.constant(subjects),
      profiles: fc.array(heldProfileArb, {
        minLength: subjects.length,
        maxLength: subjects.length,
      }),
      steps: fc.array(navigationStepArb, {
        minLength: subjects.length - 1,
        maxLength: subjects.length - 1,
      }),
    }),
  );

// Feature: web-player-stats-screen, Property 30: One call per subject
// Validates: Requirements 2.1, 2.4, 2.9
describe('Property 30 — a change of subject abandons the old call and issues exactly one new one', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts the previous call, issues one call per new subject, and renders no superseded value', async () => {
    await fc.assert(
      fc.asyncProperty(navigationScenarioArb, async (scenario) => {
        const recorder = createRecordingApi();
        const screen = await mountScreen(recorder, scenario.subjects[0]);

        try {
          expect(recorder.calls).toHaveLength(1);
          expect(recorder.calls[0].key).toBe(subjectKey(scenario.subjects[0]));

          /** Every profile belonging to a subject already left behind. */
          const abandonedProfiles: PlayerProfile[] = [];

          /**
           * Whether the call for the subject currently on screen has been
           * answered.
           *
           * Tracked rather than generated, because the previous step decides it:
           * a step that left its own call in flight hands the next navigation
           * something to abort, and a step that answered it hands over a held
           * profile to drop instead. Generating it independently would make the
           * abort claim vacuous on every step after the first, which is exactly
           * the defect this suite was first written with.
           */
          let currentAnswered = false;

          for (const [index, step] of scenario.steps.entries()) {
            const previous = scenario.subjects[index];
            const next = scenario.subjects[index + 1];
            const nextKey = subjectKey(next);

            const supersededCall = recorder.calls[recorder.calls.length - 1];
            expect(supersededCall.key).toBe(subjectKey(previous));

            if (!currentAnswered && step.shape === 'held-then-navigate') {
              // A profile on screen for the subject we are about to leave, so
              // the navigation has something to drop rather than merely
              // something to abort.
              await supersededCall.settle({
                kind: 'success',
                value: scenario.profiles[index],
              });
              expect(screen.machine().profile).toBe(scenario.profiles[index]);
              currentAnswered = true;
            }

            /** Whether the navigation below has a call to abandon. */
            const supersedesInFlight = !currentAnswered;

            const floor = recorder.calls.length;

            await screen.setSubject(next);

            const issued = recorder.calls.slice(floor);

            // 2.4: exactly one call for the new subject, carrying the new
            // subject's own pair — not two, and not one for the old pair.
            expect(issued).toHaveLength(1);
            expect(issued[0].key).toBe(nextKey);
            expect(issued[0].squadId).toBe(next.squadId);
            expect(issued[0].membershipId).toBe(next.membershipId);
            expect(issued[0].aborted()).toBe(false);

            // 2.4: the previous subject's call is aborted. An already-answered
            // one has nothing to abort, which is why the claim is conditional —
            // the unconditional claim is the one below it.
            if (supersedesInFlight) {
              expect(supersededCall.signal).toBeDefined();
              expect(supersededCall.aborted()).toBe(true);
            }

            // At most one call whose response the hook would still accept: the
            // new subject's own.
            expect(recorder.live()).toEqual([issued[0]]);

            // 2.4: no value from the subject we have left — not even
            // transiently, beside the new subject's loading indication.
            expect(screen.machine().profile).toBeNull();
            expect(screen.machine().phase).toBe('loading');
            expect(screen.machine().busy).toBe(true);
            expect(screen.machine().notFound).toBe(false);
            expect(screen.machine().failed).toBe(false);
            expect(screen.machine().subjectKey).toBe(nextKey);

            /** Deliver the superseded response and claim it changed nothing. */
            const deliverSuperseded = async (): Promise<void> => {
              const before = snapshot(screen.machine());

              await settleCall(
                supersededCall,
                step.supersededSettlement,
                scenario.profiles[index],
              );

              // 2.4: a response for a subject we have left changes **nothing
              // at all** — no profile, no phase, no failure, no not-found — and
              // issues nothing either. The `late-after-new` ordering is what
              // makes this assertion sharp.
              expect(snapshot(screen.machine())).toEqual(before);
              expect(recorder.calls).toHaveLength(floor + 1);
            };

            /** Whether this step delivers the abandoned call's response. */
            const deliversSuperseded =
              supersedesInFlight &&
              (step.shape === 'late-before-new' ||
                step.shape === 'late-after-new');

            if (deliversSuperseded && step.shape === 'late-before-new') {
              await deliverSuperseded();
            }

            if (step.shape === 'still-pending') {
              // Nothing answered during the step, so the next navigation finds
              // a call in flight to abandon in turn — and the screen holds no
              // value in the meantime.
              expect(screen.machine().profile).toBeNull();
              expect(screen.machine().phase).toBe('loading');
              expect(screen.machine().subjectKey).toBe(nextKey);
              currentAnswered = false;
            } else {
              await issued[0].settle({
                kind: 'success',
                value: scenario.profiles[index + 1],
              });

              // The new subject's own profile, and only now.
              expect(screen.machine().profile).toBe(
                scenario.profiles[index + 1],
              );
              expect(screen.machine().phase).toBe('loaded');
              expect(screen.machine().subjectKey).toBe(nextKey);
              currentAnswered = true;
            }

            if (deliversSuperseded && step.shape === 'late-after-new') {
              await deliverSuperseded();
            }

            // Whatever arrived and in whichever order, nothing a subject we
            // have left answered with is on screen.
            abandonedProfiles.push(scenario.profiles[index]);
            for (const abandoned of abandonedProfiles) {
              expect(screen.machine().profile).not.toBe(abandoned);
            }
          }

          // One call per subject over the whole chain, and not one more.
          expect(recorder.calls).toHaveLength(scenario.subjects.length);
          expect(
            recorder.calls.map((call) => call.key),
          ).toEqual(scenario.subjects.map(subjectKey));
        } finally {
          screen.unmount();
        }
      }),
      { numRuns: 150 },
    );
  }, 180_000);
});

/* -------------------------------------------------------------------------- */
/* Clause three: an activation while a call awaits a response                  */
/* -------------------------------------------------------------------------- */

/** A run of retry activations made while a call is awaiting a response. */
interface ActivationScenario {
  readonly subject: Subject;
  readonly profile: PlayerProfile;
  /** Whether the pending call is the mount's, or one a retry already issued. */
  readonly fromRetry: boolean;
  /** How many activations are made while that call awaits a response. */
  readonly activations: number;
  /** Whether those activations all happen inside one React commit. */
  readonly burst: boolean;
  /** How the pending call eventually settles. */
  readonly settlement: Settlement;
}

const activationScenarioArb: fc.Arbitrary<ActivationScenario> = fc.record({
  subject: subjectArb,
  profile: heldProfileArb,
  fromRetry: fc.boolean(),
  activations: fc.integer({ min: 1, max: 5 }),
  burst: fc.boolean(),
  settlement: fc.constantFrom(...SETTLEMENTS),
});

// Feature: web-player-stats-screen, Property 30: One call per subject
// Validates: Requirements 2.1, 2.4, 2.9
describe('Property 30 — an activation while a call awaits a response issues nothing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('issues no further call however many times the control is activated, and is available again once the call settles', async () => {
    await fc.assert(
      fc.asyncProperty(activationScenarioArb, async (scenario) => {
        const recorder = createRecordingApi();
        const screen = await mountScreen(recorder, scenario.subject);
        const key = subjectKey(scenario.subject);

        try {
          expect(recorder.calls).toHaveLength(1);

          if (scenario.fromRetry) {
            // The pending call is a retry's rather than the mount's, so the
            // guard is exercised from the phase a person actually retries from.
            await recorder.calls[0].settle({ kind: 'transport-failure' });
            expect(screen.machine().failed).toBe(true);
            expect(screen.machine().busy).toBe(false);

            await screen.activate(1, false);
            expect(recorder.calls).toHaveLength(2);
          }

          const floor = recorder.calls.length;
          const pending = recorder.calls[floor - 1];

          expect(pending.settled()).toBe(false);
          expect(screen.machine().busy).toBe(true);

          // 2.9: every activation while that call awaits a response issues
          // nothing — in a burst inside one commit as well as one at a time —
          // so activations cannot stack concurrent calls for the same subject.
          await screen.activate(scenario.activations, scenario.burst);

          expect(recorder.calls).toHaveLength(floor);
          expect(recorder.maxInFlight).toBe(1);
          expect(recorder.live()).toEqual([pending]);
          expect(screen.machine().busy).toBe(true);
          expect(screen.machine().subjectKey).toBe(key);

          // The guard is single-flight rather than one-shot: once the call
          // settles — on whichever arm — one activation issues exactly one
          // further call, for the same subject.
          await settleCall(pending, scenario.settlement, scenario.profile);

          expect(recorder.calls).toHaveLength(floor);
          expect(screen.machine().busy).toBe(false);

          await screen.activate(1, false);

          expect(recorder.calls).toHaveLength(floor + 1);
          expect(recorder.calls[floor].key).toBe(key);
          expect(recorder.live()).toEqual([recorder.calls[floor]]);
          expect(screen.machine().busy).toBe(true);
        } finally {
          screen.unmount();
        }
      }),
      { numRuns: 150 },
    );
  }, 180_000);
});
