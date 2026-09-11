/**
 * **Property 18: Optimistic marking is applied immediately and restored exactly
 * on failure**
 *
 * *For any* displayed notification list and any unread record within it,
 * activating that record sets its displayed read state to `read` and reduces the
 * displayed unread count by 1 while that count is 1 or greater, before any
 * response to the resulting call, and issues exactly one mark-read call carrying
 * that record's identity; and *for any* subsequent failure outcome of that call —
 * transport failure, timeout, not-found, or any other failing status — the
 * displayed read states and unread count are restored to the values held
 * immediately before the activation and the affected control remains available
 * for a further attempt.
 *
 * The sentence carries two claims and a rider, and this suite takes them one at a
 * time.
 *
 * 1. **The optimistic apply happens first.** The first test activates one unread
 *    record and asserts the whole displayed pair *while the resulting mark-read
 *    call is still unsettled*: the activated record reads `read`, every other
 *    record is untouched, the count is one lower (or still 0), and exactly one
 *    mark-read call went out carrying that record's identity and nothing else.
 *    "Before any response" is not timed in milliseconds — it is checked
 *    structurally, by making the transport answer nothing at all and asserting
 *    the displayed values anyway. A machine that waited for the backend would
 *    show the pre-activation pair here.
 * 2. **A failure restores exactly.** The second test captures the pre-activation
 *    pair, activates, confirms the optimistic pair differs where it should, then
 *    fails the call under each of the failing arms and holds the displayed pair
 *    against the captured one. *Exactly* is the operative word: not "the record
 *    goes back to unread" but "both displayed values are the ones held
 *    immediately before the activation".
 * 3. **The control survives the failure.** Same test: after the rollback the
 *    record is unread again, no mark-read call is recorded as awaiting a response
 *    for it, and a second activation issues a second call and re-applies the
 *    optimistic pair. A rollback that left the row disabled, or that left the
 *    identity latched as pending, would satisfy claim 2 and still strand the
 *    person.
 *
 * The third test then runs claims 1 and 2 as a **sequence**: a generated
 * programme of activations, each settled — successfully or under a generated
 * failing arm — before the next begins. Success retains the optimistic pair
 * (Requirement 6.2) and failure restores the pre-activation pair, over and over,
 * which is what shows the snapshot is taken per activation rather than once. It
 * also walks the count down to 0 and past it, where "reduces by 1 while the count
 * is 1 or greater" stops being a subtraction.
 *
 * ### The expected transition is restated, not imported
 *
 * `lib/readStateTransitions.ts` is the pure function the machine itself applies,
 * so asserting against it would only show the machine calls it. The expectation
 * below is therefore written out longhand in {@link viewAfterActivation} — map the
 * activated identity to `read`, take one off a count of 1 or above — as the
 * property's own words. The transition's algebra (idempotence, the bound, the
 * no-ops) is Property 13's subject, beside the function.
 *
 * ### How each failing arm is reached
 *
 * The Notification_Call_Timeout and the response-status mapping both live inside
 * the Notifications_Api facade (Requirements 11.4, 11.6), so by the time an
 * outcome reaches the state machine the arms the property names have folded onto
 * two outcome kinds: `not-found`, and `failure` for everything else. A lapsed
 * timeout is therefore driven by advancing the clock ten seconds and *then*
 * failing the call. The arms stay distinct in the generator because the claim is
 * that arms differing upstream restore identically downstream.
 *
 * `unauthenticated` is deliberately absent from the failing arms: it begins the
 * session-expiry handover, which discards the displayed values rather than
 * restoring them and is expressly *not* a failed marking (Requirement 9.6). That
 * is Property 28's subject.
 *
 * The clock is faked, so no run waits out a poll interval or a timeout. The
 * hanging transport, the mounting, and the `act`-wrapped advances all come from
 * `notificationCentreTestHarness`.
 *
 * **Validates: Requirements 6.1, 6.2, 6.6**
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import { GENERIC_NOTIFICATION_FAILURE } from '../lib/messages';
import type { NotificationRecord } from '../lib/notificationParsing';
import {
  advanceClock,
  notificationRecord,
  renderNotificationCentre,
  type NotificationCentreHarness,
  type RecordedCall,
} from './notificationCentreTestHarness';

// --- Constants --------------------------------------------------------------

/**
 * The configured Poll_Interval every harness here mounts with.
 *
 * The maximum, so the poll loop stays out of the way: the ten-second advances the
 * timeout arm needs can never also fire the poll timer, and no unread-count call
 * arrives to interact with a mark-read in flight.
 */
const POLL_INTERVAL_SECONDS = 600;

/** The Notification_Call_Timeout (Requirement 11.4). */
const NOTIFICATION_CALL_TIMEOUT_MS = 10_000;

// --- Arbitraries ------------------------------------------------------------

/**
 * The ways the property says the resulting mark-read call can fail.
 *
 * Two of them reach the machine as the same outcome kind, and that is the point:
 * a transport failure, a lapsed timeout, and a 500 must all restore the same
 * values, so collapsing them in the generator would assume what is under test.
 */
type FailingArm =
  | 'transport-failure'
  | 'timeout'
  | 'not-found'
  | 'other-failing-status';

const failingArmArb: fc.Arbitrary<FailingArm> = fc.constantFrom(
  'transport-failure',
  'timeout',
  'not-found',
  'other-failing-status',
);

/** Settle one call the way a {@link FailingArm} describes. */
async function settleFailing(call: RecordedCall, arm: FailingArm): Promise<void> {
  switch (arm) {
    case 'not-found':
      await call.notFound();
      return;

    case 'timeout':
      // 11.4: the facade abandons a request unsettled for the
      // Notification_Call_Timeout and reports it as a failed call, so from the
      // machine's side a lapsed timeout *is* a failure, ten seconds in.
      await advanceClock(NOTIFICATION_CALL_TIMEOUT_MS);
      await call.fail();
      return;

    case 'transport-failure':
    case 'other-failing-status':
      await call.fail();
      return;
  }
}

/** How one activation in a generated programme was answered. */
type Settlement = { readonly kind: 'success' } | { readonly kind: 'failure'; readonly arm: FailingArm };

const settlementArb: fc.Arbitrary<Settlement> = fc.oneof(
  fc.constant({ kind: 'success' as const }),
  failingArmArb.map((arm) => ({ kind: 'failure' as const, arm })),
);

/**
 * A Squad_Scope, active or absent.
 *
 * Marking one record read is never scoped by squad, so both settings must behave
 * the same; generating the scope keeps that from being assumed.
 */
const scopeArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.uuid(),
);

/**
 * An Unread_Count the backend accepted before the activation.
 *
 * 0 and 1 are the two boundaries of "reduces the displayed unread count by 1
 * while that count is 1 or greater": at 1 the reduction lands on 0, and at 0
 * there is nothing to reduce even though an unread record is displayed — which is
 * reachable in production, since the count covers a whole Squad_Scope while the
 * displayed list is a capped window on it.
 */
const countArb: fc.Arbitrary<number> = fc.oneof(
  { arbitrary: fc.constant(0), weight: 2 },
  { arbitrary: fc.constant(1), weight: 2 },
  { arbitrary: fc.integer({ min: 2, max: 99 }), weight: 3 },
  { arbitrary: fc.integer({ min: 100, max: 2_147_483_647 }), weight: 1 },
);

/**
 * A displayed Notification_List of 1 to 5 records with distinct identities.
 *
 * The first is forced `unread` so there is always something to activate: a
 * mark-read for a record that is absent or already read issues no call at all
 * (Requirement 6.3), which would leave this property nothing to observe. The
 * others are free, so runs mix read and unread records and the "every other
 * record is untouched" assertion has read neighbours to protect too.
 */
const recordsArb: fc.Arbitrary<readonly NotificationRecord[]> = fc
  .uniqueArray(
    fc.record({
      notificationId: fc.uuid(),
      readState: fc.constantFrom('read' as const, 'unread' as const),
      createdAtMs: fc.integer({
        min: Date.UTC(2025, 0, 1),
        max: Date.UTC(2025, 0, 31),
      }),
    }),
    {
      minLength: 1,
      maxLength: 5,
      selector: (candidate) => candidate.notificationId,
    },
  )
  .map((candidates) =>
    candidates.map((candidate, index) =>
      notificationRecord({
        ...candidate,
        readState: index === 0 ? 'unread' : candidate.readState,
      }),
    ),
  );

/**
 * Which unread displayed record is activated, as an offset into the unread ones.
 *
 * An offset rather than an identity, because the machine orders and caps the list
 * it displays: the record to activate has to be chosen from what is *displayed*,
 * which is only known once the list has loaded.
 */
const targetOffsetArb: fc.Arbitrary<number> = fc.nat({ max: 20 });

/** A programme of activations, each settled before the next begins. */
const programmeArb: fc.Arbitrary<readonly (readonly [number, Settlement])[]> = fc.array(
  fc.tuple(targetOffsetArb, settlementArb),
  { minLength: 1, maxLength: 5 },
);

// --- The displayed pair -----------------------------------------------------

/** The two displayed values this property is about (Requirement 6.10). */
interface DisplayedView {
  readonly records: readonly NotificationRecord[];
  readonly unreadCount: number;
}

/** Read the displayed pair off the machine's surface, detached from its state. */
function displayedView(harness: NotificationCentreHarness): DisplayedView {
  return {
    records: harness.centre.records.map((record) => ({ ...record })),
    unreadCount: harness.centre.unreadCount,
  };
}

/**
 * The displayed pair the property says an activation produces, written out
 * longhand rather than borrowed from the machine's own transition.
 */
function viewAfterActivation(
  view: DisplayedView,
  notificationId: string,
): DisplayedView {
  return {
    records: view.records.map((record) =>
      record.notificationId === notificationId
        ? { ...record, readState: 'read' as const }
        : { ...record },
    ),
    // "by 1 while that count is 1 or greater" — and not below 0 otherwise.
    unreadCount: view.unreadCount >= 1 ? view.unreadCount - 1 : 0,
  };
}

/** The displayed records that are still unread, in display order. */
function unreadRecords(
  harness: NotificationCentreHarness,
): readonly NotificationRecord[] {
  return harness.centre.records.filter((record) => record.readState === 'unread');
}

/**
 * The unread displayed record a generated offset selects, or `undefined` when
 * every displayed record is already read.
 */
function targetRecord(
  harness: NotificationCentreHarness,
  offset: number,
): NotificationRecord | undefined {
  const unread = unreadRecords(harness);

  return unread.length === 0 ? undefined : unread[offset % unread.length];
}

/**
 * The same selection where the run guarantees one: {@link recordsArb} forces a
 * record `unread`, so a run that finds none has already gone wrong and says so
 * here rather than through a confusing assertion further down.
 */
function requireTargetRecord(
  harness: NotificationCentreHarness,
  offset: number,
): NotificationRecord {
  const target = targetRecord(harness, offset);

  if (target === undefined) {
    throw new Error('expected a displayed unread Notification_Record to activate');
  }

  return target;
}

// --- Seeding a displayed list -----------------------------------------------

/**
 * Put a Notification_List and an accepted Unread_Count on screen, leaving nothing
 * in flight.
 *
 * Three settlements in an order that keeps them independent: the mount's count
 * call, then a panel opening's list call supplying the records, then that
 * opening's count call. Nothing is marking while the counts settle, so both are
 * accepted rather than discarded (Requirement 6.7), and the poll timer is left
 * armed for a whole 600-second interval — far beyond anything this suite
 * advances — so no unread-count call arrives mid-activation.
 */
async function seedDisplayedList(
  harness: NotificationCentreHarness,
  records: readonly NotificationRecord[],
  unreadCount: number,
): Promise<void> {
  await harness.countCalls()[0].succeed(unreadCount);

  await harness.openPanel();
  await harness.listCalls()[0].succeed([...records]);
  await harness.countCalls()[1].succeed(unreadCount);

  expect(harness.centre.records).toHaveLength(records.length);
  expect(harness.centre.unreadCount).toBe(unreadCount);
  expect(harness.centre.failureMessage).toBeNull();
  expect(harness.transport.callsOf('markRead')).toHaveLength(0);
}

/** Mount a machine with a displayed list and an accepted count. */
async function mountWithDisplayedList(
  records: readonly NotificationRecord[],
  unreadCount: number,
  squadScope: string | null,
): Promise<NotificationCentreHarness> {
  const harness = await renderNotificationCentre({
    pollIntervalSeconds: POLL_INTERVAL_SECONDS,
    squadScope,
  });

  await seedDisplayedList(harness, records, unreadCount);

  return harness;
}

// --- The property -----------------------------------------------------------

describe('Property 18: optimistic marking is applied immediately and restored exactly on failure', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Validates: Requirement 6.1 (applied before any response, one call with the
  // record's identity)
  it('flips the activated record and decrements the count before the resulting call is answered', async () => {
    await fc.assert(
      fc.asyncProperty(
        recordsArb,
        countArb,
        targetOffsetArb,
        scopeArb,
        async (records, unreadCount, offset, squadScope) => {
          const harness = await mountWithDisplayedList(records, unreadCount, squadScope);

          try {
            const before = displayedView(harness);
            const { notificationId } = requireTargetRecord(harness, offset);

            await harness.markRead(notificationId);

            // 6.1: exactly one call, carrying that record's identity — and,
            // crucially, still unanswered. Every assertion below is therefore
            // made *before any response*.
            const markReadCalls = harness.transport.callsOf('markRead');
            expect(markReadCalls).toHaveLength(1);
            expect(markReadCalls[0].notificationId).toBe(notificationId);
            expect(markReadCalls[0].isSettled()).toBe(false);

            // 6.1: the Read_State flipped and the count came down by 1 — unless it
            // was already 0, which is not a count to reduce.
            expect(displayedView(harness)).toEqual(
              viewAfterActivation(before, notificationId),
            );

            // Nothing else moved: no other record's Read_State changed, the list
            // kept its length and its order, and no failure was announced for a
            // call that has not answered.
            expect(harness.centre.records.map((record) => record.notificationId)).toEqual(
              before.records.map((record) => record.notificationId),
            );
            expect(harness.centre.failureMessage).toBeNull();
            expect(harness.centre.markReadPending).toEqual([notificationId]);
          } finally {
            harness.unmount();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Validates: Requirement 6.6 (restore the pre-activation values, control stays
  // available)
  it('restores the exact pre-activation read states and count under every failing outcome, and stays activatable', async () => {
    await fc.assert(
      fc.asyncProperty(
        recordsArb,
        countArb,
        targetOffsetArb,
        failingArmArb,
        scopeArb,
        async (records, unreadCount, offset, arm, squadScope) => {
          const harness = await mountWithDisplayedList(records, unreadCount, squadScope);

          try {
            const before = displayedView(harness);
            const { notificationId } = requireTargetRecord(harness, offset);

            await harness.markRead(notificationId);

            // The optimistic pair, which the rollback has to undo.
            const optimistic = viewAfterActivation(before, notificationId);
            expect(displayedView(harness)).toEqual(optimistic);

            const call = harness.transport.callsOf('markRead')[0];
            await settleFailing(call, arm);

            // 6.6: *exactly* the pair held immediately before the activation —
            // every Read_State and the count, not merely the activated record.
            expect(displayedView(harness)).toEqual(before);
            expect(harness.centre.failureMessage).toBe(GENERIC_NOTIFICATION_FAILURE);

            // 6.6: the control is available again. The record reads `unread`, no
            // call is recorded as awaiting a response for it, and activating it a
            // second time issues a second call and re-applies the optimistic pair.
            expect(harness.centre.markReadPending).toEqual([]);
            const restored = harness.centre.records.find(
              (record) => record.notificationId === notificationId,
            );
            expect(restored?.readState).toBe('unread');

            await harness.markRead(notificationId);

            const markReadCalls = harness.transport.callsOf('markRead');
            expect(markReadCalls).toHaveLength(2);
            expect(markReadCalls[1].notificationId).toBe(notificationId);
            expect(displayedView(harness)).toEqual(optimistic);
          } finally {
            harness.unmount();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Validates: Requirements 6.1, 6.2, 6.6 (per-activation snapshot, over a
  // sequence)
  it('applies and settles each activation against its own pre-activation values across a sequence', async () => {
    await fc.assert(
      fc.asyncProperty(
        recordsArb,
        countArb,
        programmeArb,
        scopeArb,
        async (records, unreadCount, programme, squadScope) => {
          const harness = await mountWithDisplayedList(records, unreadCount, squadScope);

          try {
            let issuedCalls = 0;

            for (const [offset, settlement] of programme) {
              const target = targetRecord(harness, offset);

              if (target === undefined) {
                // Every displayed record is read, so there is nothing left to
                // activate and nothing further to observe (Requirement 6.3).
                break;
              }

              const notificationId = target.notificationId;
              const before = displayedView(harness);

              await harness.markRead(notificationId);
              issuedCalls += 1;

              // 6.1: one call per activation, and the optimistic pair applied
              // against the values displayed at *this* activation.
              const markReadCalls = harness.transport.callsOf('markRead');
              expect(markReadCalls).toHaveLength(issuedCalls);
              expect(markReadCalls[issuedCalls - 1].notificationId).toBe(notificationId);

              const optimistic = viewAfterActivation(before, notificationId);
              expect(displayedView(harness)).toEqual(optimistic);

              const call = markReadCalls[issuedCalls - 1];

              if (settlement.kind === 'success') {
                await call.succeed();

                // 6.2: the optimistic pair stands, and no failure is announced
                // for a call that succeeded.
                expect(displayedView(harness)).toEqual(optimistic);
                expect(harness.centre.failureMessage).toBeNull();
              } else {
                await settleFailing(call, settlement.arm);

                // 6.6: back to this activation's own pre-activation pair.
                expect(displayedView(harness)).toEqual(before);
                expect(harness.centre.failureMessage).toBe(GENERIC_NOTIFICATION_FAILURE);
              }

              expect(harness.centre.markReadPending).toEqual([]);
            }
          } finally {
            harness.unmount();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
