/**
 * **Property 21: Every failing notification call retains state and says the same
 * thing**
 *
 * *For any* notification call and any failing outcome of it — transport failure,
 * 10-second timeout, not-found, any other failing status, or an uninterpretable
 * response body — and for any squad scope active or absent, the displayed
 * notification list and unread count held immediately before that call are
 * retained (with no badge rendered while no unread count has yet been accepted
 * since the frame mounted), the user-facing message is one fixed text that
 * contains no value taken from the response body, no response header value, no
 * response status code, and no response status text, and that message is
 * identical across every such outcome, disclosing neither whether a record or
 * squad exists nor whether the account holds a membership.
 *
 * The sentence carries three separable claims, and this suite takes them one at
 * a time.
 *
 * 1. **Retention.** A failing call never clears what is already on screen. The
 *    first test seeds a displayed Notification_List and an accepted Unread_Count,
 *    then fails one call of each of the four kinds under each failing arm and
 *    holds the displayed pair against the pair captured immediately beforehand.
 * 2. **No badge before the first accepted count.** The second test never lets a
 *    count succeed at all, so `acceptedCountSinceMount` stays false through any
 *    number of failing poll cycles and a failing list call — and the
 *    Notification_Indicator renders without the Unread_Badge throughout
 *    (Requirements 4.8, 4.12).
 * 3. **One fixed, non-disclosing text.** The third test runs two independently
 *    generated failures — different call kinds, different failing arms, one
 *    squad-scoped and one account-wide, different displayed states — and asserts
 *    the two messages are the *same string*. That pairwise form is the exact
 *    sense of "presented identically": a person cannot tell from the message
 *    which call failed, how it failed, or whether a squad or record exists
 *    (Requirements 7.7, 11.10).
 *
 * ### How each failing arm is reached
 *
 * The Notification_Call_Timeout, the response-status mapping, and the response
 * parsers all live *inside* the Notifications_Api facade (Requirements 11.4,
 * 11.6, 11.9, 10.10), so by the time an outcome reaches the state machine the
 * five failing arms the property names have already been folded onto two outcome
 * kinds: `not-found`, and `failure` for everything else. This suite therefore
 * drives each arm as the facade would report it —
 *
 * | Failing arm                    | Reaches the machine as              |
 * | ------------------------------ | ----------------------------------- |
 * | transport failure              | `failure`                           |
 * | 10-second timeout              | `failure`, ten seconds later        |
 * | not-found                      | `not-found`                         |
 * | any other failing status       | `failure`                           |
 * | uninterpretable response body  | `failure`                           |
 *
 * — and keeps the arms distinct in the generator rather than in the settlement,
 * because the claim under test is precisely that arms which differ upstream are
 * indistinguishable downstream. The facade's own mapping and timeout behaviour
 * are pinned beside the facade by Properties 22 and 23.
 *
 * ### What "immediately before that call" means for a mark-read
 *
 * Marking one record read is optimistic: the Read_State flips and the count
 * decrements *inside the activation handler*, before the request is issued
 * (Requirement 6.1). So for a mark-read call the pair displayed the instant
 * before the request went out is the already-optimistic pair, and the pair
 * Requirement 6.6 asks a failure to restore is the pre-activation one. This suite
 * captures the pre-activation pair for every kind — for the other three nothing
 * happens between the activation and the request, so the two readings coincide.
 *
 * ### Leak candidates
 *
 * "Contains no value taken from the response body, no response header value, no
 * response status code, and no response status text" is checked against a
 * generated value of exactly those kinds: a failing status code, a status text, a
 * header value, a body fragment that would reveal existence, and a squad identity.
 * The message is asserted to contain none of them, and to contain no digit at all
 * — which forecloses a status code arriving in any formatting.
 *
 * The clock is faked, so no run waits out a poll interval or a timeout, and time
 * moves only where this suite moves it. The hanging transport, the mounting, and
 * the `act`-wrapped advances all come from `notificationCentreTestHarness`.
 *
 * **Validates: Requirements 4.8, 5.9, 7.7, 11.10**
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import { GENERIC_NOTIFICATION_FAILURE } from '../lib/messages';
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
 * The maximum, so the poll loop stays out of the way: advancing the clock ten
 * seconds for the timeout arm can never also fire the poll timer, and a count
 * call is issued only where this suite advances a whole interval to ask for one.
 */
const POLL_INTERVAL_SECONDS = 600;
const POLL_INTERVAL_MS = POLL_INTERVAL_SECONDS * 1000;

/** The Notification_Call_Timeout (Requirement 11.4). */
const NOTIFICATION_CALL_TIMEOUT_MS = 10_000;

// --- Arbitraries ------------------------------------------------------------

/**
 * The five ways the property says a notification call can fail.
 *
 * Named separately even where two reach the machine identically, because the
 * property's claim is about arms that differ upstream being indistinguishable
 * downstream — collapsing them in the generator would assume what is under test.
 */
type FailingArm =
  | 'transport-failure'
  | 'timeout'
  | 'not-found'
  | 'other-failing-status'
  | 'uninterpretable-body';

const failingArmArb: fc.Arbitrary<FailingArm> = fc.constantFrom(
  'transport-failure',
  'timeout',
  'not-found',
  'other-failing-status',
  'uninterpretable-body',
);

/** Settle one call the way a {@link FailingArm} describes. */
async function settleFailing(call: RecordedCall, arm: FailingArm): Promise<void> {
  switch (arm) {
    case 'not-found':
      await call.notFound();
      return;

    case 'timeout':
      // 11.4: the facade aborts the request once it has been unsettled for the
      // Notification_Call_Timeout and settles the call as a failed call, so from
      // the machine's side a lapsed timeout *is* a failure, ten seconds in.
      await advanceClock(NOTIFICATION_CALL_TIMEOUT_MS);
      await call.fail();
      return;

    // 11.8 (transport), 11.6/11.9 (any other failing status), 10.10/11.9 (a body
    // the parser could not interpret) all arrive as the failure outcome.
    case 'transport-failure':
    case 'other-failing-status':
    case 'uninterpretable-body':
      await call.fail();
      return;
  }
}

/** Which of the four notification calls fails. */
const callKindArb: fc.Arbitrary<NotificationCallKind> = fc.constantFrom(
  'unreadCount',
  'list',
  'markRead',
  'markAllRead',
);

/** A Squad_Scope, active or absent (Requirement 7.7). */
const scopeArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.uuid(),
);

/**
 * An Unread_Count the backend accepted earlier, spanning all three badge bands so
 * "the count is retained" is checked where retaining it matters visibly.
 */
const countArb: fc.Arbitrary<number> = fc.oneof(
  fc.constant(0),
  fc.integer({ min: 1, max: 99 }),
  fc.integer({ min: 100, max: 2_147_483_647 }),
);

/**
 * A displayed Notification_List of 1 to 4 records with distinct identities.
 *
 * The first is forced `unread` so a mark-read activation always has something to
 * act on — a mark-read for a record that is absent or already read issues no call
 * at all (Requirement 6.3), which would leave nothing to fail.
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
      maxLength: 4,
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
 * A value that would only appear in the message if the shell had taken it from
 * the response — a failing status code, a status text, a header value, a body
 * fragment disclosing existence, or a squad identity.
 */
const leakCandidateArb: fc.Arbitrary<string> = fc.oneof(
  fc
    .constantFrom(400, 403, 404, 409, 418, 422, 429, 500, 502, 503, 504)
    .map(String),
  fc.constantFrom(
    'Not Found',
    'Forbidden',
    'Conflict',
    'Too Many Requests',
    'Internal Server Error',
    'Bad Gateway',
    'Service Unavailable',
  ),
  fc.constantFrom(
    'application/problem+json',
    'x-request-id: 7f3c19a4',
    'Retry-After: 30',
    'x-squad-membership: absent',
  ),
  fc.constantFrom(
    'squad not found',
    'no membership in that squad',
    'notification does not exist',
    'that record belongs to another account',
  ),
  fc.uuid(),
);

// --- Displayed state --------------------------------------------------------

/** The displayed pair a failing call must retain, plus what the badge shows. */
interface DisplayedState {
  readonly records: readonly NotificationRecord[];
  readonly panelRecords: readonly NotificationRecord[];
  readonly unreadCount: number;
  readonly acceptedCountSinceMount: boolean;
  readonly badgeText: string | null;
}

/** Read everything this property cares about off the machine's surface. */
function displayedState(harness: NotificationCentreHarness): DisplayedState {
  const centre = harness.centre;

  return {
    records: centre.records,
    panelRecords: centre.panelRecords,
    unreadCount: centre.unreadCount,
    acceptedCountSinceMount: centre.acceptedCountSinceMount,
    badgeText: unreadBadgeText(centre.unreadCount),
  };
}

/**
 * Put a Notification_List and an accepted Unread_Count on screen, so a failing
 * call afterwards has something it could wrongly clear.
 *
 * Three settlements, in an order that leaves nothing in flight: the mount's count
 * call succeeds, then a panel opening's list call supplies the records, then that
 * opening's count call succeeds. The poll timer is left armed for a whole
 * interval, which is how the `unreadCount` arm below asks for a fresh count call.
 */
async function seedDisplayedState(
  harness: NotificationCentreHarness,
  records: readonly NotificationRecord[],
  unreadCount: number,
): Promise<void> {
  // 4.1: mounting issued exactly one unread-count call.
  await harness.countCalls()[0].succeed(unreadCount);

  // 4.7: a panel opening issues exactly one count call and exactly one list call.
  await harness.openPanel();
  await harness.listCalls()[0].succeed([...records]);
  await harness.countCalls()[1].succeed(unreadCount);

  expect(harness.centre.records).toHaveLength(records.length);
  expect(harness.centre.unreadCount).toBe(unreadCount);
  expect(harness.centre.acceptedCountSinceMount).toBe(true);
  expect(harness.centre.failureMessage).toBeNull();
}

/**
 * Issue one call of the given kind and return it, unsettled.
 *
 * The count call comes from a Poll_Interval elapse rather than a second panel
 * opening, because an opening issues a list call too and this suite fails exactly
 * one call per run.
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
      // 5.9: the retry control's one behaviour — exactly one further list call.
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
 * Mount, seed, fail one call, and hand back what was displayed before and after.
 *
 * `before` is read *before the activation*, which for the optimistic mark-read is
 * the pair Requirement 6.6 asks a failure to restore, and for every other call is
 * also the pair displayed the instant before the request went out.
 */
async function runFailingCall(options: {
  readonly kind: NotificationCallKind;
  readonly arm: FailingArm;
  readonly squadScope: string | null;
  readonly records: readonly NotificationRecord[];
  readonly unreadCount: number;
}): Promise<{
  readonly before: DisplayedState;
  readonly after: DisplayedState;
  readonly failureMessage: string | null;
  readonly signOutCalls: number;
}> {
  const harness = await renderNotificationCentre({
    squadScope: options.squadScope,
    pollIntervalSeconds: POLL_INTERVAL_SECONDS,
  });

  try {
    await seedDisplayedState(harness, options.records, options.unreadCount);

    const before = displayedState(harness);
    const call = await issueCall(harness, options.kind);

    expect(call.squadId).toBe(
      // 7.5: a mark-read call carries the record identity and no squad identity,
      // whether or not a Squad_Scope is active.
      options.kind === 'markRead' ? undefined : (options.squadScope ?? undefined),
    );

    if (options.kind === 'markRead') {
      // Guard against a vacuous pass. A mark-read for a record that is absent or
      // already read issues no call and changes nothing (Requirement 6.3), and a
      // retention check over an unchanged pair would prove nothing — so assert
      // the optimistic update of Requirement 6.1 really did happen and there is
      // something for the failure to roll back.
      expect(displayedState(harness).records).not.toEqual(before.records);
    }

    await settleFailing(call, options.arm);

    return {
      before,
      after: displayedState(harness),
      failureMessage: harness.centre.failureMessage,
      signOutCalls: harness.signOut.mock.calls.length,
    };
  } finally {
    harness.unmount();
  }
}

// --- The property -----------------------------------------------------------

describe('Property 21: every failing notification call retains state and says the same thing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Validates: Requirements 4.8 (the last accepted count is retained), 5.9 (the
  // records displayed before the call are retained), 7.7, 11.10
  it('retains the displayed list and count for any failing outcome of any call, scoped or not', async () => {
    await fc.assert(
      fc.asyncProperty(
        callKindArb,
        failingArmArb,
        scopeArb,
        recordsArb,
        countArb,
        async (kind, arm, squadScope, records, unreadCount) => {
          const outcome = await runFailingCall({
            kind,
            arm,
            squadScope,
            records,
            unreadCount,
          });

          // 4.8, 5.9: nothing displayed is cleared, reordered, or renumbered —
          // including the optimistic mark-read, whose pre-activation pair is
          // restored exactly (Requirement 6.6).
          expect(outcome.after.records).toEqual(outcome.before.records);
          expect(outcome.after.panelRecords).toEqual(outcome.before.panelRecords);
          expect(outcome.after.unreadCount).toBe(outcome.before.unreadCount);
          expect(outcome.after.acceptedCountSinceMount).toBe(
            outcome.before.acceptedCountSinceMount,
          );
          expect(outcome.after.badgeText).toBe(outcome.before.badgeText);

          // 7.7, 11.10: the one fixed text, and nothing else.
          expect(outcome.failureMessage).toBe(GENERIC_NOTIFICATION_FAILURE);

          // A failing call is not an ended session: the handover belongs to the
          // `unauthenticated` outcome alone (Requirement 9.3).
          expect(outcome.signOutCalls).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Validates: Requirements 4.8 (no Unread_Badge while no count has been
  // accepted since the mount), 4.12, 5.9
  it('renders no badge and displays nothing while every call fails from the mount onward', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(failingArmArb, { minLength: 1, maxLength: 4 }),
        failingArmArb,
        scopeArb,
        async (countArms, listArm, squadScope) => {
          const harness = await renderNotificationCentre({
            squadScope,
            pollIntervalSeconds: POLL_INTERVAL_SECONDS,
          });

          try {
            /**
             * Nothing has ever been accepted, so the displayed count is 0, the
             * Notification_Indicator carries no Unread_Badge, and no record is
             * displayed.
             */
            const holdUnreported = () => {
              const state = displayedState(harness);
              expect(state.acceptedCountSinceMount).toBe(false);
              expect(state.unreadCount).toBe(0);
              expect(state.badgeText).toBeNull();
              expect(state.records).toEqual([]);
            };

            holdUnreported();

            // The mount call fails, then a further poll cycle fails per arm — the
            // count is never accepted, however many outcomes arrive.
            for (const [index, arm] of countArms.entries()) {
              if (index > 0) {
                // 4.8: the next call was scheduled one interval after the
                // previous failing outcome, so the loop is still alive.
                await advanceClock(POLL_INTERVAL_MS);
              }

              const counts = harness.countCalls();
              expect(counts).toHaveLength(index + 1);

              await settleFailing(counts[index], arm);

              holdUnreported();
              expect(harness.centre.failureMessage).toBe(GENERIC_NOTIFICATION_FAILURE);
            }

            // 5.9: a failing list call retains the (empty) list and shows the same
            // message; the listing is not reported as "no notifications", because
            // the phase never reached loaded.
            await harness.retryList();
            const list = harness.transport.latestCallOf('list');
            expect(list).toBeDefined();
            await settleFailing(list!, listArm);

            holdUnreported();
            expect(harness.centre.listPhase).toBe('idle');
            expect(harness.centre.failureMessage).toBe(GENERIC_NOTIFICATION_FAILURE);
            expect(harness.signOut).not.toHaveBeenCalled();
          } finally {
            harness.unmount();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Validates: Requirements 7.7 (every squad-scoped failure presented
  // identically), 11.10 (one fixed text, carrying nothing from the response)
  it('shows one identical fixed text for any two failing outcomes, disclosing nothing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          kind: callKindArb,
          arm: failingArmArb,
          records: recordsArb,
          unreadCount: countArb,
        }),
        fc.record({
          kind: callKindArb,
          arm: failingArmArb,
          records: recordsArb,
          unreadCount: countArb,
        }),
        fc.uuid(),
        leakCandidateArb,
        async (first, second, squadId, leakCandidate) => {
          // One squad-scoped and one account-wide, so the pair spans the
          // disclosure the property forbids: a person seeing either message
          // cannot tell whether a squad was involved, let alone whether it
          // exists or whether the account holds a membership in it.
          const scoped = await runFailingCall({ ...first, squadScope: squadId });
          const accountWide = await runFailingCall({
            ...second,
            squadScope: null,
          });

          const messages = [scoped.failureMessage, accountWide.failureMessage];

          for (const message of messages) {
            expect(message).toBe(GENERIC_NOTIFICATION_FAILURE);

            // 11.10: no response body value, header value, status code, or
            // status text — and no digit at all, so no status code can have
            // arrived in any formatting.
            expect(message).not.toContain(leakCandidate);
            expect(message).not.toContain(squadId);
            expect(message).not.toMatch(/\d/);
          }

          // The same string, not merely two strings that happen to match a
          // constant: differing call kinds, differing failing arms, and
          // differing scopes are indistinguishable to the person reading it.
          expect(messages[0]).toBe(messages[1]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
