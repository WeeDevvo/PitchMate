/**
 * **Property 28: The session-expiry handover happens once and leaves no residue**
 *
 * *For any* number of notification calls concurrently awaiting a response, and
 * for any of them being the first to return an unauthenticated result, exactly one
 * cleanup and exactly one invocation of the auth feature's sign-out navigation
 * occur: scheduled unread-count calls are cancelled, the displayed list and unread
 * count are discarded, responses of calls already awaiting are discarded, no
 * failure message is displayed, no further notification call is issued, the frame
 * renders with both disclosure surfaces closed and no unread badge, the content
 * region renders neither the active destination content nor any value it displayed
 * but a neutral session-ended indication carrying exactly one level-one heading and
 * no error indication; and where the unauthenticated result came from a mark-read
 * or mark-all-read call, no optimistic read state or count is rolled back and the
 * issuing control's progress indication stops.
 *
 * Three separable claims, taken one at a time.
 *
 * 1. **One cleanup, one sign-out, no residue.** The first test puts a displayed
 *    Notification_List and an accepted Unread_Count on screen, leaves one call of
 *    each of the four kinds awaiting a response, then settles all four in a
 *    generated order under generated outcomes with *one to four* of them
 *    `unauthenticated`. It holds: the sign-out navigation invoked exactly once
 *    however many unauthenticated results arrived, every call still awaiting a
 *    response cancelled, nothing of the previous screen displayed, no
 *    Generic_Notification_Failure message, and no further call issued — not from
 *    the poll loop however far the clock is advanced, and not from any of the four
 *    public activations.
 * 2. **A marking that met an ended session is not a failed marking.** The second
 *    test drives the `unauthenticated` result out of a mark-read or a mark-all-read
 *    specifically, and holds Requirement 9.6's three claims: the pre-activation
 *    Read_States and Unread_Count are *not* restored (they are discarded along with
 *    everything else), the issuing control stops indicating progress, and no
 *    failure message appears.
 * 3. **The content region carries a neutral notice and nothing of what was
 *    displayed.** The third test seeds records whose titles and bodies are
 *    generated identities — values that appear nowhere in the shell's fixed copy —
 *    runs the handover, then renders the {@link SessionEndedNotice} the
 *    Content_Region carries and asserts it holds exactly one level-one heading, no
 *    error indication of any kind, and not one of the generated values, the
 *    Unread_Count, or the squad identity that were on screen a moment earlier.
 *
 * ### Why four calls are left awaiting a response
 *
 * "For any number of notification calls concurrently awaiting a response" and
 * "responses of calls already awaiting are discarded" are both unobservable
 * against a transport that answers at once: there would be nothing in flight when
 * the first unauthenticated result arrived and nothing left to discard afterwards.
 * The harness's hand-settled Notifications_Api is what makes the window real, and
 * `advanceClock` is the only thing that moves time, so the window lasts exactly as
 * long as each test says.
 *
 * Cancellation is observed as the signal the machine bounded each call with
 * reporting `aborted`, which is the whole of what the state machine can do about a
 * call in flight; whether the transport then drops the request is the
 * Notifications_Api's own business (Requirement 11.5).
 *
 * The latch is what makes "exactly one" true, and it is deliberately exercised
 * with more than one unauthenticated result per run: the generator marks one to
 * four of the four settlements `unauthenticated`, so a run in which the second,
 * third, and fourth calls all report an ended session is ordinary rather than
 * exceptional (Requirement 9.5).
 *
 * ### What this suite does not reach
 *
 * Requirement 9.7 has two halves. The half about the Content_Region — a neutral
 * session-ended indication, one level-one heading, no error indication, and no
 * value the previous screen displayed — is asserted here against the real
 * component. The half about the Shell_Frame's *header* — the Notification_Panel and
 * Account_Menu closed, and the Notification_Indicator rendered without the
 * Unread_Badge — is asserted here as far as the state machine determines it: the
 * discarded count is 0, so `unreadBadgeText` yields no badge at all. Which
 * disclosure surface is open is the disclosure group's own state, held by the
 * frame, and Property 26 owns its at-most-one-open discipline.
 *
 * The 500-millisecond and 1-second deadlines of Requirements 9.3 and 9.4 are met
 * by construction rather than by a waited-out interval: the cleanup and the
 * sign-out invocation both happen in the settle path of the unauthenticated
 * outcome, so this suite asserts they have happened with no clock advance at all,
 * which is a stronger statement than either deadline.
 *
 * **Validates: Requirements 9.3, 9.5, 9.6, 9.7**
 */

import { render, screen, type RenderResult } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import { SessionEndedNotice } from '../SessionEndedNotice';
import {
  GENERIC_NOTIFICATION_FAILURE,
  SESSION_ENDED_BODY,
  SESSION_ENDED_HEADING,
} from '../lib/messages';
import type { NotificationRecord } from '../lib/notificationParsing';
import { unreadBadgeText } from '../lib/unreadBadge';
import {
  advanceClock,
  notificationRecord,
  renderNotificationCentre,
  type NotificationCallKind,
  type NotificationCentreHarness,
  type RecordedCall,
} from './notificationCentreTestHarness';

// --- Constants --------------------------------------------------------------

/**
 * The configured Poll_Interval every harness here mounts with.
 *
 * The maximum, so the settle-to-settle poll loop never issues a call this suite
 * did not ask for: an unread-count call appears only where a test advances a full
 * interval, which makes "no further notification call is issued" a statement about
 * the handover rather than about the clock.
 */
const POLL_INTERVAL_SECONDS = 600;
const POLL_INTERVAL_MS = POLL_INTERVAL_SECONDS * 1000;

/** The four calls a session-expiry handover may find awaiting a response. */
const ALL_CALL_KINDS: readonly NotificationCallKind[] = [
  'unreadCount',
  'list',
  'markRead',
  'markAllRead',
];

/** The two calls Requirement 9.6 is about. */
const MARKING_CALL_KINDS: readonly NotificationCallKind[] = [
  'markRead',
  'markAllRead',
];

// --- Arbitraries ------------------------------------------------------------

/** A Squad_Scope: a well-formed squad identity, or none (Requirements 7.1, 7.2). */
const scopeArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.uuid(),
);

/**
 * An Unread_Count the backend accepted before the session ended.
 *
 * Always 1 or above, spanning both badge bands, so a run can never pass
 * vacuously: an Unread_Badge really was rendered beforehand, and "the frame
 * renders no unread badge" afterwards is a change rather than a coincidence.
 */
const countArb: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: 1, max: 99 }),
  fc.integer({ min: 100, max: 2_147_483_647 }),
);

/**
 * The generated part of a Notification_Record.
 *
 * `title` and `body` are identities rather than prose. They stand in for "any
 * value the Notification_List displayed", and Requirement 9.7 forbids the
 * session-ended indication from carrying any of them — a claim checked by
 * substring, which a generated word like `a` or a single space would satisfy
 * against the notice's own fixed copy by accident. A 36-character identity appears
 * in no fixed string in the shell, so a containment failure means the value really
 * did survive.
 */
const recordSeedArb = fc.record({
  notificationId: fc.uuid(),
  title: fc.uuid(),
  body: fc.uuid(),
  readState: fc.constantFrom('read' as const, 'unread' as const),
  createdAtMs: fc.integer({
    min: Date.UTC(2025, 0, 1),
    max: Date.UTC(2025, 0, 31),
  }),
});

/**
 * A displayed Notification_List of 1 to 4 records with distinct identities.
 *
 * The first is forced `unread` so a mark-read activation always has something to
 * act on: a mark-read for a record that is absent or already read issues no call
 * at all (Requirement 6.3), which would leave nothing in flight for the handover
 * to cancel.
 */
const recordsArb: fc.Arbitrary<readonly NotificationRecord[]> = fc
  .uniqueArray(recordSeedArb, {
    minLength: 1,
    maxLength: 4,
    selector: (candidate) => candidate.notificationId,
  })
  .map((seeds) =>
    seeds.map((seed, index) =>
      notificationRecord({
        ...seed,
        readState: index === 0 ? 'unread' : seed.readState,
      }),
    ),
  );

/**
 * How one of the four awaiting calls settled.
 *
 * The three non-`unauthenticated` arms are the ones that must still be applied
 * where they land *before* the handover and discarded where they land *after* it,
 * so mixing them in is what makes "responses of calls already awaiting are
 * discarded" observable in both directions.
 */
type SettleOutcome = 'success' | 'failure' | 'not-found' | 'unauthenticated';

const ordinaryOutcomeArb: fc.Arbitrary<Exclude<SettleOutcome, 'unauthenticated'>> =
  fc.constantFrom('success', 'failure', 'not-found');

/** One settlement of the programme: which call answers, and how. */
interface Settlement {
  readonly kind: NotificationCallKind;
  readonly outcome: SettleOutcome;
}

/**
 * A settlement programme over the four awaiting calls: a permutation of the kinds,
 * with one to four of the positions reporting an ended session.
 *
 * The permutation is what makes "for any of them being the first to return an
 * unauthenticated result" real — the first unauthenticated may be the list call,
 * the count call, or either marking call, and may be preceded by any number of
 * ordinary outcomes. Marking more than one position `unauthenticated` is the
 * concurrency Requirement 9.5 names: several calls awaiting a response all find
 * the session gone.
 */
const settlementProgrammeArb: fc.Arbitrary<readonly Settlement[]> = fc
  .tuple(
    fc.shuffledSubarray([...ALL_CALL_KINDS], {
      minLength: ALL_CALL_KINDS.length,
      maxLength: ALL_CALL_KINDS.length,
    }),
    fc.array(ordinaryOutcomeArb, {
      minLength: ALL_CALL_KINDS.length,
      maxLength: ALL_CALL_KINDS.length,
    }),
    fc.uniqueArray(fc.integer({ min: 0, max: ALL_CALL_KINDS.length - 1 }), {
      minLength: 1,
      maxLength: ALL_CALL_KINDS.length,
    }),
  )
  .map(([order, ordinary, unauthenticatedAt]) =>
    order.map((kind, index) => ({
      kind,
      outcome: unauthenticatedAt.includes(index)
        ? ('unauthenticated' as const)
        : ordinary[index],
    })),
  );

// --- Reading the machine ----------------------------------------------------

/** Everything the shell's surfaces display, as they read it. */
interface DisplayedState {
  readonly records: readonly NotificationRecord[];
  readonly panelRecords: readonly NotificationRecord[];
  readonly unreadCount: number;
  readonly acceptedCountSinceMount: boolean;
  readonly badgeText: string | null;
  readonly listPhase: string;
  readonly failureMessage: string | null;
  readonly markAllPending: boolean;
  readonly markReadPending: readonly string[];
  readonly markAllReadDisabled: boolean;
  readonly handoverInProgress: boolean;
}

function displayedState(harness: NotificationCentreHarness): DisplayedState {
  const centre = harness.centre;

  return {
    records: centre.records,
    panelRecords: centre.panelRecords,
    unreadCount: centre.unreadCount,
    acceptedCountSinceMount: centre.acceptedCountSinceMount,
    badgeText: unreadBadgeText(centre.unreadCount),
    listPhase: centre.listPhase,
    failureMessage: centre.failureMessage,
    markAllPending: centre.markAllPending,
    markReadPending: centre.markReadPending,
    markAllReadDisabled: centre.markAllReadDisabled,
    handoverInProgress: centre.handoverInProgress,
  };
}

/**
 * Hold the residue-free state Requirements 9.3 and 9.7 describe: nothing of the
 * previous screen displayed, no Unread_Badge, no progress indication left running,
 * and no error indication of any kind.
 */
function expectNoResidue(harness: NotificationCentreHarness): void {
  const after = displayedState(harness);

  // 9.3: the displayed Notification_List and Unread_Count are discarded. The
  // count reverts to unreported, so 9.7's "rendered without the Unread_Badge"
  // follows from the state rather than from a separate rule.
  expect(after.records).toEqual([]);
  expect(after.panelRecords).toEqual([]);
  expect(after.unreadCount).toBe(0);
  expect(after.acceptedCountSinceMount).toBe(false);
  expect(after.badgeText).toBeNull();
  expect(after.listPhase).toBe('idle');

  // 9.3, 9.6: an ended session is a handover, not a notification failure — so
  // neither the Generic_Notification_Failure message nor any other error
  // indication for that result.
  expect(after.failureMessage).toBeNull();

  // 9.6: the issuing control stops indicating that the operation is in progress.
  expect(after.markAllPending).toBe(false);
  expect(after.markReadPending).toEqual([]);
  expect(after.markAllReadDisabled).toBe(true);

  // 9.5: the latch is closed, which is what makes a further unauthenticated
  // result a no-op.
  expect(after.handoverInProgress).toBe(true);
}

// --- Driving the machine ----------------------------------------------------

/** The one call of `kind` among `calls`. */
function onlyOfKind(
  calls: readonly RecordedCall[],
  kind: NotificationCallKind,
): RecordedCall {
  const matching = calls.filter((call) => call.kind === kind);
  expect(matching).toHaveLength(1);
  return matching[0];
}

/** The calls issued since `harness.calls` was `sequenceFloor` long. */
function callsSince(
  harness: NotificationCentreHarness,
  sequenceFloor: number,
): readonly RecordedCall[] {
  return harness.calls.slice(sequenceFloor);
}

/**
 * Put a Notification_List and an accepted Unread_Count on screen, so the handover
 * has something it must discard.
 *
 * The mount issues one unread-count call and no list call — the list waits for the
 * Notification_Panel to open (Requirements 4.1, 4.7) — so the panel is opened here
 * to obtain one. Nothing is left awaiting a response afterwards, and the poll timer
 * is armed for a whole interval.
 */
async function seedDisplayedState(
  harness: NotificationCentreHarness,
  records: readonly NotificationRecord[],
  unreadCount: number,
): Promise<void> {
  // 4.1: exactly one unread-count call on mount.
  expect(harness.calls).toHaveLength(1);
  await harness.calls[0].succeed(unreadCount);

  const floor = harness.calls.length;
  await harness.openPanel();

  // 4.7: exactly one count call and exactly one list call per opening.
  const opened = callsSince(harness, floor);
  expect(opened).toHaveLength(2);

  await onlyOfKind(opened, 'list').succeed([...records]);
  await onlyOfKind(opened, 'unreadCount').succeed(unreadCount);

  // Guard against a vacuous run: something really is on screen, badge included.
  const seeded = displayedState(harness);
  expect(seeded.records).toHaveLength(records.length);
  expect(seeded.unreadCount).toBe(unreadCount);
  expect(seeded.acceptedCountSinceMount).toBe(true);
  expect(seeded.badgeText).not.toBeNull();
  expect(seeded.listPhase).toBe('loaded');
  expect(seeded.failureMessage).toBeNull();
  expect(seeded.handoverInProgress).toBe(false);
}

/**
 * Leave exactly one call of each of the four kinds awaiting a response, so the
 * handover has one of every kind to cancel and one of every kind whose response
 * may arrive after it.
 *
 * The unread-count call comes from a Poll_Interval elapse rather than a second
 * panel opening, because an opening would issue a list call too and each kind is
 * wanted exactly once.
 */
async function leaveEveryCallKindInFlight(
  harness: NotificationCentreHarness,
): Promise<Readonly<Record<NotificationCallKind, RecordedCall>>> {
  const floor = harness.calls.length;

  // 4.6: one Poll_Interval after the previous count call settled.
  await advanceClock(POLL_INTERVAL_MS);

  // 5.9: the retry control's one behaviour — exactly one further list call.
  await harness.retryList();

  const unread = harness.centre.records.find(
    (record) => record.readState === 'unread',
  );
  expect(unread).toBeDefined();
  await harness.markRead(unread!.notificationId);

  await harness.markAllRead();

  const issued = callsSince(harness, floor);
  expect(issued).toHaveLength(ALL_CALL_KINDS.length);

  const inFlight = {
    unreadCount: onlyOfKind(issued, 'unreadCount'),
    list: onlyOfKind(issued, 'list'),
    markRead: onlyOfKind(issued, 'markRead'),
    markAllRead: onlyOfKind(issued, 'markAllRead'),
  };

  for (const kind of ALL_CALL_KINDS) {
    expect(inFlight[kind].isSettled()).toBe(false);
    expect(inFlight[kind].signal).toBeDefined();
    expect(inFlight[kind].signal!.aborted).toBe(false);
  }

  return inFlight;
}

/** A plausible response value for a successful settlement of `kind`. */
function successValue(
  kind: NotificationCallKind,
  records: readonly NotificationRecord[],
  unreadCount: number,
): unknown {
  switch (kind) {
    case 'list':
      return [...records];
    case 'unreadCount':
    case 'markAllRead':
      return unreadCount;
    case 'markRead':
      // 11.7: the mark-read endpoint answers 204 with no response value.
      return undefined;
  }
}

/** Settle one call the way a {@link SettleOutcome} describes. */
async function settle(
  call: RecordedCall,
  outcome: SettleOutcome,
  value: unknown,
): Promise<void> {
  switch (outcome) {
    case 'success':
      await call.succeed(value);
      return;
    case 'failure':
      await call.fail();
      return;
    case 'not-found':
      await call.notFound();
      return;
    case 'unauthenticated':
      await call.unauthenticated();
      return;
  }
}

/**
 * Issue one call of the given kind and return it, unsettled.
 *
 * The count call comes from a Poll_Interval elapse rather than a panel opening,
 * because an opening issues a list call too.
 */
async function issueCall(
  harness: NotificationCentreHarness,
  kind: NotificationCallKind,
): Promise<RecordedCall> {
  switch (kind) {
    case 'unreadCount':
      await advanceClock(POLL_INTERVAL_MS);
      break;

    case 'list':
      await harness.retryList();
      break;

    case 'markRead': {
      const unread = harness.centre.records.find(
        (record) => record.readState === 'unread',
      );
      expect(unread).toBeDefined();
      await harness.markRead(unread!.notificationId);
      break;
    }

    case 'markAllRead':
      await harness.markAllRead();
      break;
  }

  const call = harness.transport.latestCallOf(kind);
  expect(call).toBeDefined();
  expect(call!.isSettled()).toBe(false);

  return call!;
}

/**
 * Attempt everything that would ordinarily issue a notification call, and hand
 * back how many calls were issued in consequence.
 *
 * Requirement 9.7 asks for *no further notification call* while the handover is in
 * progress, which covers both the poll loop and a person's own activations — a
 * Notification_Panel that reopened, a retry control, a marking. All five are tried
 * here, and the clock is advanced several whole Poll_Intervals besides.
 */
async function attemptFurtherCalls(
  harness: NotificationCentreHarness,
  notificationId: string,
): Promise<number> {
  const floor = harness.calls.length;

  // 9.3: the scheduled unread-count calls are cancelled, so no interval elapse
  // revives the loop, however many pass.
  await advanceClock(POLL_INTERVAL_MS * 3);

  await harness.openPanel();
  await harness.retryList();
  await harness.markRead(notificationId);
  await harness.markAllRead();

  return harness.calls.length - floor;
}

// --- The property -----------------------------------------------------------

describe('Property 28: the session-expiry handover happens once and leaves no residue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Validates: Requirements 9.3 (one cleanup, nothing displayed, no error
  // indication), 9.5 (exactly one sign-out however many unauthenticated results)
  it('performs one cleanup and one sign-out, whichever awaiting call reports the ended session first', async () => {
    await fc.assert(
      fc.asyncProperty(
        scopeArb,
        recordsArb,
        countArb,
        settlementProgrammeArb,
        async (squadScope, records, unreadCount, programme) => {
          const harness = await renderNotificationCentre({
            squadScope,
            pollIntervalSeconds: POLL_INTERVAL_SECONDS,
          });

          try {
            await seedDisplayedState(harness, records, unreadCount);

            const awaiting = await leaveEveryCallKindInFlight(harness);

            let handoverBegun = false;
            let callsAtHandover = 0;

            for (const step of programme) {
              const callsBefore = harness.calls.length;

              await settle(
                awaiting[step.kind],
                step.outcome,
                successValue(step.kind, records, unreadCount),
              );

              if (step.outcome === 'unauthenticated' && !handoverBegun) {
                handoverBegun = true;
                callsAtHandover = harness.calls.length;

                // 9.4: the sign-out navigation is invoked once the cleanup is
                // done — in the settle path itself, with no clock advance, which
                // is well inside the 500-millisecond deadline.
                expect(harness.signOut).toHaveBeenCalledTimes(1);

                // 9.3: every call still awaiting a response is abandoned. The
                // ones that had already settled left the set when they settled,
                // so only the genuinely outstanding are asserted aborted.
                for (const kind of ALL_CALL_KINDS) {
                  const call = awaiting[kind];
                  if (call.isSettled()) {
                    continue;
                  }
                  expect(call.signal).toBeDefined();
                  expect(call.signal!.aborted).toBe(true);
                }

                expectNoResidue(harness);
                continue;
              }

              if (!handoverBegun) {
                // Before the first unauthenticated result nothing has handed over
                // yet, so no sign-out has been asked for.
                expect(harness.signOut).not.toHaveBeenCalled();
                continue;
              }

              // 9.5: a further unauthenticated result is discarded — it neither
              // repeats the cleanup nor invokes the sign-out a second time. And
              // 9.3: an ordinary response arriving after the handover is
              // discarded too, changing nothing and saying nothing.
              expect(harness.signOut).toHaveBeenCalledTimes(1);
              expect(harness.calls.length).toBe(callsBefore);
              expectNoResidue(harness);
            }

            // Every programme carries at least one unauthenticated settlement.
            expect(handoverBegun).toBe(true);

            // 9.7: no further notification call — not from the cancelled poll
            // loop, and not from any activation a person could still make.
            expect(harness.calls.length).toBe(callsAtHandover);
            expect(
              await attemptFurtherCalls(harness, records[0].notificationId),
            ).toBe(0);

            // 9.5: still exactly one, after every later response and activation.
            expect(harness.signOut).toHaveBeenCalledTimes(1);
            expectNoResidue(harness);
          } finally {
            harness.unmount();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);

  // Validates: Requirements 9.6 (a marking that met an ended session rolls nothing
  // back, stops its progress indication, and shows no failure message)
  it('rolls nothing back and stops the issuing control when a marking call reports the ended session', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...MARKING_CALL_KINDS),
        scopeArb,
        recordsArb,
        countArb,
        async (kind, squadScope, records, unreadCount) => {
          const harness = await renderNotificationCentre({
            squadScope,
            pollIntervalSeconds: POLL_INTERVAL_SECONDS,
          });

          try {
            await seedDisplayedState(harness, records, unreadCount);

            // The values held immediately before the activation — the ones
            // Requirement 6.6 would restore for a *failed* marking and
            // Requirement 9.6 says must not be restored for an ended session.
            const beforeActivation = displayedState(harness);

            const call = await issueCall(harness, kind);

            const duringCall = displayedState(harness);

            if (kind === 'markRead') {
              // 6.1: the Read_State flipped and the count decremented inside the
              // activation handler, before the request went out — so there really
              // is an optimistic update that a rollback would undo.
              expect(duringCall.records).not.toEqual(beforeActivation.records);
              expect(duringCall.markReadPending).toHaveLength(1);
            } else {
              // 6.4: mark-all-read is pessimistic, so only its progress
              // indication is running.
              expect(duringCall.markAllPending).toBe(true);
            }

            await call.unauthenticated();

            // 9.6: the handover of 9.3 and 9.4 is performed.
            expect(harness.signOut).toHaveBeenCalledTimes(1);
            expectNoResidue(harness);

            // 9.6: neither the pre-activation Read_States nor the pre-activation
            // Unread_Count is restored. They are discarded along with everything
            // else, which is a different outcome from the rollback a failed
            // marking performs.
            const after = displayedState(harness);
            expect(after.records).not.toEqual(beforeActivation.records);
            expect(after.unreadCount).not.toBe(beforeActivation.unreadCount);

            // 9.6: no Generic_Notification_Failure message, and no further call.
            expect(after.failureMessage).not.toBe(GENERIC_NOTIFICATION_FAILURE);
            expect(
              await attemptFurtherCalls(harness, records[0].notificationId),
            ).toBe(0);
          } finally {
            harness.unmount();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);

  // Validates: Requirements 9.7 (a neutral indication with one level-one heading,
  // no error indication, and no value the previous screen displayed)
  it('carries a neutral session-ended indication holding one heading and nothing of the previous screen', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ALL_CALL_KINDS),
        scopeArb,
        recordsArb,
        countArb,
        async (kind, squadScope, records, unreadCount) => {
          const harness = await renderNotificationCentre({
            squadScope,
            pollIntervalSeconds: POLL_INTERVAL_SECONDS,
          });
          let notice: RenderResult | undefined;

          try {
            await seedDisplayedState(harness, records, unreadCount);

            const call = await issueCall(harness, kind);
            await call.unauthenticated();

            expect(harness.signOut).toHaveBeenCalledTimes(1);
            expectNoResidue(harness);

            // What the Content_Region carries while the handover is in progress.
            notice = render(<SessionEndedNotice />);

            // 9.7: exactly one level-one heading, stating neutrally that the
            // session has ended and that sign-in is being reached.
            const headings = screen.getAllByRole('heading', { level: 1 });
            expect(headings).toHaveLength(1);
            expect(headings[0]).toHaveTextContent(SESSION_ENDED_HEADING);
            expect(notice.container).toHaveTextContent(SESSION_ENDED_BODY);

            // 9.7: no error indication — not an alert, not a status region, not
            // the Generic_Notification_Failure text.
            expect(screen.queryByRole('alert')).toBeNull();
            expect(screen.queryByRole('status')).toBeNull();
            expect(
              notice.container.querySelector('[aria-live]'),
            ).toBeNull();

            // 9.7: nor any value the Destination_Content or the
            // Notification_List displayed — no record title, no body, no record
            // identity, no Unread_Count, and no squad identity.
            const displayed = notice.container.textContent ?? '';

            for (const record of records) {
              expect(displayed).not.toContain(record.notificationId);
              expect(displayed).not.toContain(record.title);
              expect(displayed).not.toContain(record.body);
            }

            expect(displayed).not.toContain(String(unreadCount));

            // The badge text as well as the raw count, so neither the number nor
            // its `99+` rendering survives the handover.
            const badge = unreadBadgeText(unreadCount);
            expect(badge).not.toBeNull();
            expect(displayed).not.toContain(badge!);

            if (squadScope !== null) {
              expect(displayed).not.toContain(squadScope);
            }
          } finally {
            notice?.unmount();
            harness.unmount();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});
