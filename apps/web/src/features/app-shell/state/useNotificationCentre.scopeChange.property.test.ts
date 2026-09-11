/**
 * **Property 25: A scope change discards the old scope's data and its late
 * responses**
 *
 * *For any* change of the supplied squad scope, including between two identities
 * and to or from no scope, the displayed notification list and unread count are
 * discarded, every notification call already awaiting a response for the previous
 * scope is cancelled, and the list and unread-count calls are issued for the new
 * scope carrying its identity or no identity as applicable; and *for any* response
 * to a call issued for a previous scope that arrives after the change, that
 * response is discarded, the current scope's displayed list and count are
 * unchanged, and no failure message is displayed. Irrespective of the active
 * scope, a mark-read call carries only the notification identity.
 *
 * Three separable claims, taken one at a time.
 *
 * 1. **The change itself.** The first test builds a populated Squad_Scope — a
 *    displayed Notification_List, an accepted Unread_Count, and one call of each
 *    of the four kinds awaiting a response — then changes the scope and holds
 *    three things at once: nothing of the old scope is still displayed, every
 *    abandoned call's signal is aborted, and exactly two calls went out, one list
 *    and one unread-count, each carrying the new scope's identity or none. The
 *    generated chain runs the change two to four times over, so the machine is
 *    shown to survive repeated changes rather than only the first.
 * 2. **The late response.** The second test lets the *new* scope populate itself
 *    with deliberately different records and a deliberately different count, then
 *    settles the old scope's abandoned calls — including a list call answered with
 *    the previous scope's records and an unread-count call answered with a stale
 *    number. Everything displayed is compared against a snapshot taken before
 *    those settlements: identical, with no failure message and no further call.
 * 3. **Mark-read is never scoped.** The third test marks every unread record read
 *    under an active scope, under no scope, and after a change between the two,
 *    and asserts each mark-read call carried the record identity and no squad
 *    identity — while the list, unread-count, and mark-all-read calls of the same
 *    run carried the active scope. Requirement 7.5 is a claim about *contrast*, so
 *    checking the unscoped call alone would leave it half-tested.
 *
 * ### Why calls are left awaiting a response
 *
 * "Cancel every notification call already awaiting a response" and "discard a
 * response that arrives after the change" are both unobservable against a
 * transport that answers at once: there would be no call in flight at the moment
 * of the change and no response left to arrive late. The harness's hand-settled
 * Notifications_Api is what makes the window real, and `advanceClock` is the only
 * thing that moves time, so the window lasts exactly as long as each test says.
 *
 * Cancellation is observed as the signal the machine bounded each call with
 * reporting `aborted`. That is the whole of what the state machine can do about a
 * call in flight; whether the transport then drops the request is the
 * Notifications_Api's own business (Requirement 11.5).
 *
 * ### The one arm this suite leaves alone
 *
 * A late response is settled here as success, transport failure, or not-found —
 * never as `unauthenticated`. That outcome begins the session-expiry handover,
 * whose one-cleanup-one-sign-out discipline is Property 28's subject, and pinning
 * it from two suites at once would leave neither owning it. Every late arm below
 * is one that must change nothing at all.
 *
 * The mount call's timing is unchanged by any of this: a configured Poll_Interval
 * of 600 seconds keeps the poll loop out of the way, so an unread-count call goes
 * out only where a test advances a whole interval to ask for one.
 *
 * **Validates: Requirements 7.3, 7.4, 7.5**
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

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
 * interval, which makes "exactly two calls went out in consequence of the change"
 * a statement about the change rather than about the clock.
 */
const POLL_INTERVAL_SECONDS = 600;
const POLL_INTERVAL_MS = POLL_INTERVAL_SECONDS * 1000;

/** The four calls a Squad_Scope change may find awaiting a response. */
const ALL_CALL_KINDS: readonly NotificationCallKind[] = [
  'unreadCount',
  'list',
  'markRead',
  'markAllRead',
];

/**
 * A squad identity used only to guarantee that a generated "next scope" differs
 * from the current one; see {@link distinctFrom}.
 */
const FALLBACK_SCOPE = '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4abc';

// --- Arbitraries ------------------------------------------------------------

/** A Squad_Scope: a well-formed squad identity, or none (Requirements 7.1, 7.2). */
const scopeArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.uuid(),
);

/**
 * Some scope other than `scope`.
 *
 * Only reached where a generated pair collided, and only ever to or from no
 * scope, so the interesting identity-to-identity changes still come from the
 * generator rather than from here.
 */
function distinctFrom(scope: string | null): string | null {
  return scope === null ? FALLBACK_SCOPE : null;
}

/**
 * A chain of two to four scopes in which each successive scope differs from the
 * one before it.
 *
 * Distinctness is the point: supplying the same value again is not a change, so a
 * chain with a repeat would silently test nothing at that step. The chain spans
 * every kind of change the property names — identity to a different identity,
 * identity to none, and none to an identity.
 */
const scopeChainArb: fc.Arbitrary<readonly (string | null)[]> = fc
  .tuple(scopeArb, fc.array(scopeArb, { minLength: 1, maxLength: 3 }))
  .map(([first, rest]) => {
    const chain: (string | null)[] = [first];

    for (const candidate of rest) {
      const previous = chain[chain.length - 1];
      chain.push(candidate === previous ? distinctFrom(previous) : candidate);
    }

    return chain;
  });

/** An Unread_Count the backend might report. */
const countArb: fc.Arbitrary<number> = fc.oneof(
  fc.constant(0),
  fc.integer({ min: 1, max: 99 }),
  fc.integer({ min: 100, max: 2_147_483_647 }),
);

/** The generated part of a Notification_Record; the rest comes from the fixture. */
const recordSeedArb = fc.record({
  notificationId: fc.uuid(),
  readState: fc.constantFrom('read' as const, 'unread' as const),
  createdAtMs: fc.integer({
    min: Date.UTC(2025, 0, 1),
    max: Date.UTC(2025, 0, 31),
  }),
});

/** Build records from seeds, forcing the first `unread`. */
function recordsFrom(
  seeds: readonly {
    readonly notificationId: string;
    readonly readState: 'read' | 'unread';
    readonly createdAtMs: number;
  }[],
): readonly NotificationRecord[] {
  return seeds.map((seed, index) =>
    notificationRecord({
      ...seed,
      readState: index === 0 ? 'unread' : seed.readState,
    }),
  );
}

/**
 * A displayed Notification_List of 1 to 4 records with distinct identities.
 *
 * The first is forced `unread` so a mark-read activation always has something to
 * act on: a mark-read for a record that is absent or already read issues no call
 * at all (Requirement 6.3), which would leave nothing in flight for a scope change
 * to cancel.
 */
const recordsArb: fc.Arbitrary<readonly NotificationRecord[]> = fc
  .uniqueArray(recordSeedArb, {
    minLength: 1,
    maxLength: 4,
    selector: (candidate) => candidate.notificationId,
  })
  .map(recordsFrom);

/**
 * Two Notification_Lists with no identity in common.
 *
 * Disjointness is what makes "the current scope's list is unchanged" worth
 * asserting: were the old scope's late records already displayed, a list that
 * wrongly accepted them would look identical to one that correctly ignored them.
 */
const disjointRecordsArb: fc.Arbitrary<{
  readonly previous: readonly NotificationRecord[];
  readonly current: readonly NotificationRecord[];
}> = fc
  .uniqueArray(recordSeedArb, {
    minLength: 2,
    maxLength: 6,
    selector: (candidate) => candidate.notificationId,
  })
  .map((seeds) => {
    const split = Math.ceil(seeds.length / 2);
    return {
      previous: recordsFrom(seeds.slice(0, split)),
      current: recordsFrom(seeds.slice(split)),
    };
  });

/**
 * A current count and a stale one that differs from it, for the same reason the
 * record sets are disjoint.
 */
const countPairArb: fc.Arbitrary<{
  readonly current: number;
  readonly stale: number;
}> = fc
  .tuple(fc.integer({ min: 0, max: 500 }), fc.integer({ min: 1, max: 500 }))
  .map(([current, offset]) => ({ current, stale: current + offset }));

/**
 * How a late response — one to a call issued for a previous Squad_Scope — went.
 *
 * `unauthenticated` is deliberately absent: it begins the session-expiry handover,
 * which is Property 28's subject. Every arm here is one that must leave the
 * current scope's displayed values exactly as they were.
 */
type LateOutcome = 'success' | 'failure' | 'not-found';

const lateOutcomeArb: fc.Arbitrary<LateOutcome> = fc.constantFrom(
  'success',
  'failure',
  'not-found',
);

/** Which of the abandoned calls answer late, and how. */
const lateOutcomesArb: fc.Arbitrary<
  Readonly<Partial<Record<NotificationCallKind, LateOutcome>>>
> = fc
  .tuple(
    fc.uniqueArray(fc.constantFrom(...ALL_CALL_KINDS), {
      minLength: 1,
      maxLength: ALL_CALL_KINDS.length,
    }),
    fc.array(lateOutcomeArb, { minLength: 4, maxLength: 4 }),
  )
  .map(([kinds, outcomes]) => {
    const late: Partial<Record<NotificationCallKind, LateOutcome>> = {};

    kinds.forEach((kind, index) => {
      late[kind] = outcomes[index];
    });

    return late;
  });

// --- Reading the machine ----------------------------------------------------

/** Everything the current Squad_Scope displays, as the shell's surfaces read it. */
interface DisplayedState {
  readonly squadScope: string | null;
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
}

function displayedState(harness: NotificationCentreHarness): DisplayedState {
  const centre = harness.centre;

  return {
    squadScope: centre.squadScope,
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
  };
}

// --- Driving the machine ----------------------------------------------------

/**
 * The one call of `kind` among `calls`.
 *
 * Calls are identified by *when they were issued* rather than by whether they are
 * still awaiting a response, because a call cancelled by a scope change is exactly
 * a call that will never be answered: it stays outstanding for the rest of the run
 * by design, and asking the transport for "the pending list call" would return it
 * alongside the new scope's. Every helper here therefore works from the slice of
 * calls issued during one step.
 */
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
 * Put a Notification_List and an accepted Unread_Count on screen for the scope the
 * harness has just mounted with.
 *
 * The mount issues one unread-count call and no list call — the list waits for the
 * Notification_Panel to open (Requirements 4.1, 4.7) — so the panel is opened here
 * to obtain one. Nothing is left awaiting a response afterwards, and the poll timer
 * is armed for a whole interval.
 */
async function seedMountedScope(
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

  expectPopulated(harness, records, unreadCount);
}

/** What one Squad_Scope change issued, and when. */
interface ScopeChange {
  /** The fake clock's reading at the instant the change was supplied. */
  readonly changeInstant: number;
  /** Every call issued in consequence of the change. */
  readonly issued: readonly RecordedCall[];
  /** The unread-count call issued for the new scope (Requirement 7.3). */
  readonly refetchedCount: RecordedCall;
  /** The list call issued for the new scope (Requirement 7.3). */
  readonly refetchedList: RecordedCall;
}

/** Supply a new Squad_Scope and collect what the machine did about it. */
async function changeScope(
  harness: NotificationCentreHarness,
  next: string | null,
): Promise<ScopeChange> {
  const floor = harness.calls.length;
  const changeInstant = Date.now();

  await harness.setProps({ squadScope: next });

  const issued = callsSince(harness, floor);

  return {
    changeInstant,
    issued,
    refetchedCount: onlyOfKind(issued, 'unreadCount'),
    refetchedList: onlyOfKind(issued, 'list'),
  };
}

/**
 * Populate the scope the machine has just changed to, by answering the list and
 * unread-count calls the change itself issued (Requirement 7.3).
 */
async function seedChangedScope(
  harness: NotificationCentreHarness,
  change: ScopeChange,
  records: readonly NotificationRecord[],
  unreadCount: number,
): Promise<void> {
  await change.refetchedList.succeed([...records]);
  await change.refetchedCount.succeed(unreadCount);

  expectPopulated(harness, records, unreadCount);
}

/** Guard against a vacuous run: the scope really does display something. */
function expectPopulated(
  harness: NotificationCentreHarness,
  records: readonly NotificationRecord[],
  unreadCount: number,
): void {
  const centre = harness.centre;

  expect(centre.records).toHaveLength(records.length);
  expect(centre.unreadCount).toBe(unreadCount);
  expect(centre.acceptedCountSinceMount).toBe(true);
  expect(centre.listPhase).toBe('loaded');
  expect(centre.failureMessage).toBeNull();
}

/**
 * Leave exactly one call of each of the four kinds awaiting a response, so a scope
 * change has something of every kind to cancel.
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

/** Settle one late response the way a {@link LateOutcome} describes. */
async function settleLate(
  call: RecordedCall,
  outcome: LateOutcome,
  staleValue: unknown,
): Promise<void> {
  switch (outcome) {
    case 'success':
      await call.succeed(staleValue);
      return;
    case 'failure':
      await call.fail();
      return;
    case 'not-found':
      await call.notFound();
      return;
  }
}

// --- The property -----------------------------------------------------------

describe("Property 25: a scope change discards the old scope's data and its late responses", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Validates: Requirements 7.3 (discard, cancel, refetch for the new scope)
  it('discards the displayed list and count, cancels the previous calls, and refetches for the new scope', async () => {
    await fc.assert(
      fc.asyncProperty(
        scopeChainArb,
        fc.array(recordsArb, { minLength: 4, maxLength: 4 }),
        fc.array(countArb, { minLength: 4, maxLength: 4 }),
        async (scopes, recordSets, counts) => {
          const harness = await renderNotificationCentre({
            squadScope: scopes[0],
            pollIntervalSeconds: POLL_INTERVAL_SECONDS,
          });

          try {
            // 7.2: the mount call carries the active identity, or none.
            expect(harness.countCalls()[0].squadId).toBe(scopes[0] ?? undefined);

            await seedMountedScope(harness, recordSets[0], counts[0]);

            for (const [index, next] of scopes.slice(1).entries()) {
              const abandoned = await leaveEveryCallKindInFlight(harness);

              const change = await changeScope(harness, next);

              // 7.3: nothing of the previous scope is still displayed. The count
              // reverts to unreported, so the Notification_Indicator renders
              // without an Unread_Badge until the new scope's count arrives.
              const after = displayedState(harness);
              expect(after.squadScope).toBe(next);
              expect(after.records).toEqual([]);
              expect(after.panelRecords).toEqual([]);
              expect(after.unreadCount).toBe(0);
              expect(after.acceptedCountSinceMount).toBe(false);
              expect(after.badgeText).toBeNull();
              expect(after.failureMessage).toBeNull();
              expect(after.markAllPending).toBe(false);
              expect(after.markReadPending).toEqual([]);
              expect(after.markAllReadDisabled).toBe(true);

              // 7.3: every call already awaiting a response is cancelled —
              // including the optimistic mark-read and the mark-all-read, not
              // only the two the change reissues.
              for (const kind of ALL_CALL_KINDS) {
                const call = abandoned[kind];
                expect(call.signal).toBeDefined();
                expect(call.signal!.aborted).toBe(true);
              }

              // 7.3: exactly two calls in consequence of the change — one list
              // and one unread-count — and no mark-read or mark-all-read reissued
              // on the new scope's behalf.
              expect(change.issued).toHaveLength(2);

              for (const call of [change.refetchedCount, change.refetchedList]) {
                // 7.3: the new scope's identity, or none where the change left no
                // scope active — which is what restores the account-wide values.
                expect(call.squadId).toBe(next ?? undefined);
                // 7.3: within 500 milliseconds of the change; both went out at
                // the instant of it, with no interval waited out.
                expect(call.issuedAtMs).toBe(change.changeInstant);
              }

              // The new scope populates itself, so the next change in the chain
              // has a displayed list and an accepted count to discard in turn.
              await seedChangedScope(
                harness,
                change,
                recordSets[index + 1],
                counts[index + 1],
              );
            }
          } finally {
            harness.unmount();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Validates: Requirements 7.4 (a late response changes nothing and says nothing)
  it('discards a response to a previous scope, leaving the current list and count untouched', async () => {
    await fc.assert(
      fc.asyncProperty(
        scopeArb,
        scopeArb,
        disjointRecordsArb,
        countPairArb,
        lateOutcomesArb,
        async (fromScope, toScope, records, countPair, lateOutcomes) => {
          const target =
            toScope === fromScope ? distinctFrom(fromScope) : toScope;

          const harness = await renderNotificationCentre({
            squadScope: fromScope,
            pollIntervalSeconds: POLL_INTERVAL_SECONDS,
          });

          try {
            await seedMountedScope(harness, records.previous, countPair.stale);

            const abandoned = await leaveEveryCallKindInFlight(harness);

            const change = await changeScope(harness, target);
            await seedChangedScope(
              harness,
              change,
              records.current,
              countPair.current,
            );

            const before = displayedState(harness);
            const issuedBeforeLateResponses = harness.calls.length;

            // The old scope's calls answer at last — the list with the previous
            // scope's records, the count with a stale number, each either
            // successfully, as a failure, or as not-found.
            for (const kind of ALL_CALL_KINDS) {
              const outcome = lateOutcomes[kind];
              if (outcome === undefined) {
                continue;
              }

              const staleValue =
                kind === 'list'
                  ? [...records.previous]
                  : kind === 'unreadCount'
                    ? countPair.stale
                    : undefined;

              await settleLate(abandoned[kind], outcome, staleValue);
            }

            // 7.4: discarded outright. Not one displayed value moved — the list
            // was not repopulated with the previous scope's records, the count was
            // not overwritten by the stale one, and no optimistic marking was
            // rolled back.
            expect(displayedState(harness)).toEqual(before);

            // 7.4: and no Generic_Notification_Failure message, because a call
            // cancelled by a scope change is not a failure a person should see
            // (Requirement 7.7).
            expect(harness.centre.failureMessage).toBeNull();

            // A discarded response owes nothing: it neither reschedules the poll
            // loop nor issues a retry, and it is not an ended session.
            expect(harness.calls.length).toBe(issuedBeforeLateResponses);
            expect(harness.signOut).not.toHaveBeenCalled();
          } finally {
            harness.unmount();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Validates: Requirements 7.5 (mark-read carries the identity and nothing else)
  it('carries only the notification identity on a mark-read call, whatever scope is active', async () => {
    await fc.assert(
      fc.asyncProperty(
        scopeArb,
        fc.option(scopeArb, { nil: undefined }),
        recordsArb,
        countArb,
        async (initialScope, requestedChange, records, count) => {
          const harness = await renderNotificationCentre({
            squadScope: initialScope,
            pollIntervalSeconds: POLL_INTERVAL_SECONDS,
          });

          try {
            await seedMountedScope(harness, records, count);

            let activeScope = initialScope;

            if (requestedChange !== undefined) {
              activeScope =
                requestedChange === initialScope
                  ? distinctFrom(initialScope)
                  : requestedChange;

              const change = await changeScope(harness, activeScope);
              await seedChangedScope(harness, change, records, count);
            }

            const markedIds = harness.centre.records
              .filter((record) => record.readState === 'unread')
              .map((record) => record.notificationId);
            expect(markedIds.length).toBeGreaterThan(0);

            for (const notificationId of markedIds) {
              await harness.markRead(notificationId);
            }

            const markReadCalls = harness.transport.callsOf('markRead');
            expect(markReadCalls).toHaveLength(markedIds.length);

            for (const [index, call] of markReadCalls.entries()) {
              // 7.5: the record identity is the only value supplied — never a
              // squad identity, whether or not a Squad_Scope is active and
              // whether or not the scope has just changed.
              expect(call.notificationId).toBe(markedIds[index]);
              expect(call.squadId).toBeUndefined();
            }

            // The contrast that gives 7.5 its content: the scoped calls of the
            // same run did carry the active identity, or none where none is
            // active (Requirements 7.1, 7.2, 7.3).
            await harness.markAllRead();

            const scoped = [
              harness.transport.latestCallOf('unreadCount'),
              harness.transport.latestCallOf('list'),
              harness.transport.latestCallOf('markAllRead'),
            ];

            for (const call of scoped) {
              expect(call).toBeDefined();
              expect(call!.squadId).toBe(activeScope ?? undefined);
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
