/**
 * **Property 17: Unread-count calls are single-flight and coalescing**
 *
 * *For any* sequence of unread-count triggers — poll-interval elapses and
 * notification-panel openings — occurring while an unread-count call awaits a
 * response, at most one unread-count call is in flight at any instant and exactly
 * one further call is issued after that call settles, however many triggers were
 * suppressed; and each successive call is scheduled one effective poll interval
 * after the previous call settled by returning, failing, or reaching the
 * 10-second timeout.
 *
 * That sentence carries three separable claims, and this suite takes them one at
 * a time.
 *
 * 1. **Coalescing.** Triggers arriving during a call buy *one* follow-up, not one
 *    each, and that follow-up goes out the moment the awaited call settles rather
 *    than after another interval. The first test drives a generated number of
 *    suppressed triggers per round, over several rounds, so the queue flag is
 *    shown to reset rather than latch.
 * 2. **Settle-to-settle scheduling.** With nothing suppressed, the next call is
 *    issued exactly one effective Poll_Interval after the previous call *settled*
 *    — not after it was *issued*. The second test separates the two by making the
 *    call take a generated time to settle, including the 10 seconds of the
 *    Notification_Call_Timeout, and pins the follow-up's issue instant to the
 *    arithmetic that distinguishes them.
 * 3. **Single-flight, under any interleaving.** The third test generates
 *    arbitrary programmes of panel openings, clock elapses, and settlements and
 *    holds two invariants after every single step: never more than one
 *    unread-count call in flight, and never more calls issued in total than one
 *    plus the number that have settled — the precise sense in which one settle
 *    can yield at most one call.
 *
 * ### What stands in for what
 *
 * The Notification_Call_Timeout lives inside the Notifications_Api facade, not in
 * the state machine, so from the machine's side a lapsed timeout is
 * indistinguishable from any other failed call. The "reaching the 10-second
 * timeout" arm of the property is therefore driven by advancing the clock ten
 * seconds and then settling the call as a failure; the facade's own timeout
 * behaviour is pinned by Property 23 beside the facade.
 *
 * A poll-interval elapse cannot, by construction, occur *during* a call: the
 * timer is only ever set from a settle path, so no timer is pending while a call
 * is in flight. The programmes still advance the clock during calls, and the fact
 * that this issues nothing is itself part of the single-flight claim.
 *
 * The clock is faked, so no run waits out an interval, and time moves only where
 * the test moves it. Everything else — the hanging transport, the mounting, the
 * `act`-wrapped advances — comes from `notificationCentreTestHarness`.
 *
 * **Validates: Requirements 4.6, 4.11**
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import {
  advanceClock,
  renderNotificationCentre,
  type RecordedCall,
} from './notificationCentreTestHarness';

// --- Arbitraries ------------------------------------------------------------

/**
 * A configured Poll_Interval paired with the interval it actually produces.
 *
 * The expected interval is stated in the generator rather than computed by
 * calling `effectivePollIntervalSeconds`, so this suite does not check the
 * machine against the same function the machine uses. The folding and clamping
 * rules themselves are Property 16's subject; here they only need to be *known*.
 */
interface PollInterval {
  readonly configured: unknown;
  readonly effectiveMs: number;
}

const pollIntervalArb: fc.Arbitrary<PollInterval> = fc.oneof(
  // The three ways a configured value folds to the 60-second default.
  fc.constant({ configured: undefined, effectiveMs: 60_000 }),
  fc.constant({ configured: 'every minute', effectiveMs: 60_000 }),
  fc.constant({ configured: Number.NaN, effectiveMs: 60_000 }),
  // Both clamps.
  fc.constant({ configured: 4, effectiveMs: 15_000 }),
  fc.constant({ configured: 5_000, effectiveMs: 600_000 }),
  // Both bounds and everything between them.
  fc.integer({ min: 15, max: 600 }).map((seconds) => ({
    configured: seconds,
    effectiveMs: seconds * 1000,
  })),
);

/**
 * How a settled unread-count call went.
 *
 * `unauthenticated` is deliberately absent: it begins the session-expiry handover
 * and stops the loop by design, which is Property 28's subject. Every outcome
 * here is one the loop must survive.
 */
type CountSettlement = 'success' | 'failure' | 'not-found';

const settlementArb: fc.Arbitrary<CountSettlement> = fc.constantFrom(
  'success',
  'failure',
  'not-found',
);

/** Settle one call the way a {@link CountSettlement} describes. */
async function settleCount(
  call: RecordedCall,
  settlement: CountSettlement,
  value: number,
): Promise<void> {
  switch (settlement) {
    case 'success':
      await call.succeed(value);
      return;
    case 'failure':
      await call.fail();
      return;
    case 'not-found':
      await call.notFound();
      return;
  }
}

/** A count the backend might return. Irrelevant to scheduling, so kept small. */
const countArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: 250 });

/** A Squad_Scope, active or not: scheduling is the same either way. */
const scopeArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.uuid(),
);

/**
 * How long a call takes to settle.
 *
 * 0 is the degenerate case where settle-to-settle and issue-to-settle scheduling
 * agree; every other value separates them, and 10,000 is the
 * Notification_Call_Timeout the property names explicitly.
 */
const settleDelayArb: fc.Arbitrary<number> = fc.oneof(
  { arbitrary: fc.constant(0), weight: 1 },
  { arbitrary: fc.constant(1), weight: 1 },
  { arbitrary: fc.constant(10_000), weight: 2 },
  { arbitrary: fc.integer({ min: 0, max: 9_999 }), weight: 3 },
);

/** One round of "suppress some triggers, then settle the awaited call". */
interface CoalescingRound {
  /** Panel openings arriving while the call is in flight. */
  readonly suppressedTriggers: number;
  /** Clock movement between those triggers — which must issue nothing. */
  readonly elapseBetweenMs: number;
  readonly settlement: CountSettlement;
  readonly count: number;
}

const coalescingRoundArb: fc.Arbitrary<CoalescingRound> = fc.record({
  suppressedTriggers: fc.integer({ min: 0, max: 4 }),
  elapseBetweenMs: fc.integer({ min: 0, max: 30_000 }),
  settlement: settlementArb,
  count: countArb,
});

// --- Programmes for the interleaving invariant ------------------------------

/**
 * One step of a generated programme.
 *
 * `advance` carries a multiple of the effective Poll_Interval rather than a
 * duration, so a programme is meaningful whichever interval was generated: 0 and
 * a quarter land inside an interval, 1 lands exactly on the boundary, and 2 or 3
 * overshoot it — which is where a scheduler that re-armed per elapse rather than
 * per settle would show up as a pile-up.
 */
type ProgrammeStep =
  | { readonly type: 'open-panel' }
  | { readonly type: 'advance'; readonly intervals: number }
  | { readonly type: 'settle'; readonly settlement: CountSettlement; readonly count: number };

const programmeStepArb: fc.Arbitrary<ProgrammeStep> = fc.oneof(
  { arbitrary: fc.constant({ type: 'open-panel' as const }), weight: 3 },
  {
    arbitrary: fc
      .constantFrom(0, 0.25, 0.5, 1, 2, 3)
      .map((intervals) => ({ type: 'advance' as const, intervals })),
    weight: 3,
  },
  {
    arbitrary: fc
      .tuple(settlementArb, countArb)
      .map(([settlement, count]) => ({ type: 'settle' as const, settlement, count })),
    weight: 4,
  },
);

const programmeArb: fc.Arbitrary<readonly ProgrammeStep[]> = fc.array(
  programmeStepArb,
  { minLength: 1, maxLength: 10 },
);

// --- The property -----------------------------------------------------------

describe('Property 17: unread-count calls are single-flight and coalescing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Validates: Requirements 4.11 (single-flight, one follow-up per wait), 4.6
  it('suppresses every trigger arriving during a call and issues exactly one follow-up when it settles', async () => {
    await fc.assert(
      fc.asyncProperty(
        pollIntervalArb,
        fc.array(coalescingRoundArb, { minLength: 1, maxLength: 3 }),
        scopeArb,
        async (poll, rounds, squadScope) => {
          const harness = await renderNotificationCentre({
            pollIntervalSeconds: poll.configured,
            squadScope,
          });

          try {
            // 4.1: mounting issues exactly one unread-count call, which is the
            // call every round below begins by waiting on.
            expect(harness.countCalls()).toHaveLength(1);

            let issued = 1;

            for (const round of rounds) {
              const awaited = harness.countCalls()[issued - 1];
              expect(awaited.isSettled()).toBe(false);

              for (let trigger = 0; trigger < round.suppressedTriggers; trigger += 1) {
                // A clock elapse during a call issues nothing: the loop's timer
                // is only ever set from a settle path, so none is pending.
                await advanceClock(round.elapseBetweenMs);
                expect(harness.countCalls()).toHaveLength(issued);

                await harness.openPanel();

                // 4.11: no second concurrent call, however many triggers arrive.
                expect(harness.countCalls()).toHaveLength(issued);
                expect(harness.pendingCountCalls()).toHaveLength(1);
              }

              const settleInstant = Date.now();
              await settleCount(awaited, round.settlement, round.count);

              if (round.suppressedTriggers > 0) {
                // 4.11: exactly one follow-up, however many triggers were
                // suppressed, and issued at the settle rather than an interval
                // later — the suppressed triggers wanted a count *now*.
                issued += 1;
                expect(harness.countCalls()).toHaveLength(issued);
                expect(harness.countCalls()[issued - 1].issuedAtMs).toBe(settleInstant);
              } else {
                // Nothing was owed, so the next call waits for the interval.
                expect(harness.countCalls()).toHaveLength(issued);

                await advanceClock(poll.effectiveMs - 1);
                expect(harness.countCalls()).toHaveLength(issued);

                await advanceClock(1);
                issued += 1;
                expect(harness.countCalls()).toHaveLength(issued);
              }

              // Either way the loop is alive with exactly one call in flight,
              // ready for the next round.
              expect(harness.pendingCountCalls()).toHaveLength(1);
            }
          } finally {
            harness.unmount();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Validates: Requirements 4.6 (each call timed from the previous settle)
  it('schedules each successive call one effective poll interval after the previous call settled', async () => {
    await fc.assert(
      fc.asyncProperty(
        pollIntervalArb,
        settleDelayArb,
        settlementArb,
        countArb,
        async (poll, settleDelayMs, settlement, count) => {
          const harness = await renderNotificationCentre({
            pollIntervalSeconds: poll.configured,
          });

          try {
            const first = harness.countCalls()[0];
            const issuedAtMs = first.issuedAtMs;

            // The call takes its time — a slow response, or the ten seconds of
            // the Notification_Call_Timeout. Nothing else goes out meanwhile.
            await advanceClock(settleDelayMs);
            expect(harness.countCalls()).toHaveLength(1);

            const settleInstant = Date.now();
            expect(settleInstant).toBe(issuedAtMs + settleDelayMs);

            await settleCount(first, settlement, count);

            // The next call is *scheduled*, not issued: had it been timed from
            // the issue instant, a call that took longer than an interval to
            // settle would have gone out immediately here.
            expect(harness.countCalls()).toHaveLength(1);

            await advanceClock(poll.effectiveMs - 1);
            expect(harness.countCalls()).toHaveLength(1);

            await advanceClock(1);
            const counts = harness.countCalls();
            expect(counts).toHaveLength(2);

            // One interval after the settle, which is `settleDelayMs` later than
            // one interval after the issue.
            expect(counts[1].issuedAtMs).toBe(settleInstant + poll.effectiveMs);
            expect(counts[1].issuedAtMs).toBe(
              issuedAtMs + settleDelayMs + poll.effectiveMs,
            );
          } finally {
            harness.unmount();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Validates: Requirements 4.11 (at most one in flight at any instant), 4.6
  it('keeps at most one call in flight across any interleaving of triggers, elapses, and settlements', async () => {
    await fc.assert(
      fc.asyncProperty(
        pollIntervalArb,
        programmeArb,
        scopeArb,
        async (poll, programme, squadScope) => {
          const harness = await renderNotificationCentre({
            pollIntervalSeconds: poll.configured,
            squadScope,
          });

          try {
            /** How many unread-count calls the programme has settled so far. */
            let settledCalls = 0;

            /**
             * The two invariants, checked after every single step.
             *
             * The second is the exact sense of "exactly one further call": every
             * call after the mount call is owed to a settle, and no settle owes
             * two — whether the follow-up went out at the settle because a
             * trigger was suppressed, or an interval later because none was.
             */
            const holdInvariants = () => {
              expect(harness.pendingCountCalls().length).toBeLessThanOrEqual(1);
              expect(harness.countCalls().length).toBeLessThanOrEqual(settledCalls + 1);
            };

            expect(harness.countCalls()).toHaveLength(1);
            holdInvariants();

            for (const step of programme) {
              switch (step.type) {
                case 'open-panel':
                  await harness.openPanel();
                  break;

                case 'advance':
                  await advanceClock(Math.ceil(poll.effectiveMs * step.intervals));
                  break;

                case 'settle': {
                  const pending = harness.pendingCountCalls()[0];
                  if (pending !== undefined) {
                    settledCalls += 1;
                    await settleCount(pending, step.settlement, step.count);
                  }
                  break;
                }
              }

              holdInvariants();
            }

            // The loop is still alive at the end of any programme: settle
            // everything in flight — including the coalesced follow-up a settle
            // may issue at once — then let one interval pass, and exactly one
            // further call goes out.
            for (
              let pending = harness.pendingCountCalls()[0];
              pending !== undefined;
              pending = harness.pendingCountCalls()[0]
            ) {
              settledCalls += 1;
              await settleCount(pending, 'success', 0);
              holdInvariants();
            }
            const beforeInterval = harness.countCalls().length;

            await advanceClock(poll.effectiveMs);

            expect(harness.countCalls().length).toBe(beforeInterval + 1);
            expect(harness.pendingCountCalls()).toHaveLength(1);
          } finally {
            harness.unmount();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
