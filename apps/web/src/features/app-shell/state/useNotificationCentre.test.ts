/**
 * Mount and marking discipline for the App_Shell's notification state machine.
 *
 * The four property suites beside this one each take one *universal* claim —
 * scheduling, optimistic marking, failure handling, scope changes — and generate
 * their way across it. What is left over is a handful of claims that are about
 * **exact counts of calls at named moments**, and those read better as worked
 * examples than as generated programmes:
 *
 * - one unread-count call on mount, and none in consequence of a re-render
 *   (Requirement 4.1);
 * - one unread-count call and one list call when the Notification_Panel opens,
 *   and none in consequence of a re-render while it stays open (Requirement 4.7);
 * - an Unread_Count returned *while marking* is discarded, and a second
 *   concurrent mark call for the same target is prevented (Requirements 6.7, 6.8);
 * - an Unread_Count returned with nothing marking prevails over the locally
 *   derived one (Requirement 6.13);
 * - nothing but an explicit activation ever issues a mark call (Requirement 6.12).
 *
 * ### The one part of Requirement 6.12 this suite cannot reach
 *
 * Requirement 6.12 names five things that must issue no mark-read call: a record
 * being *displayed*, *rendered*, *hovered*, *scrolled into view*, or *focused*.
 * Three of those are DOM events on a component that does not exist yet — the
 * Notification_Row of task 11.2 — and asserting them needs a rendered row, a
 * pointer, and a focus ring, none of which a state machine has. **Those three
 * assertions belong with the Notification_Row's own suite**, where hovering,
 * focusing, and scrolling a row can be performed for real and the mark-read call
 * count held at zero.
 *
 * What *is* reachable here is the other half of the same requirement, and the half
 * the row's suite cannot cover: that the machine issues a mark call from exactly
 * two places — {@link NotificationCentre.markRead} and
 * {@link NotificationCentre.markAllRead}, both requiring an explicit activation —
 * and from nowhere else, across every other thing that happens to it. So the last
 * group below drives mounting, re-rendering, panel openings, list loads, poll
 * cycles, and a Squad_Scope change, and holds the mark-read and mark-all-read call
 * counts at zero throughout. A row that never gets its own call and a machine that
 * never issues one uninvited are jointly the requirement.
 *
 * ### Why the transport answers nothing on its own
 *
 * Every claim here is about a *window*: what the machine does while a call awaits
 * a response, and what it does with a response that arrives during another call's
 * window. A transport that resolved immediately would collapse each window to zero
 * duration and make all of it unobservable. So the harness's hand-settled
 * Notifications_Api is used throughout, the clock is faked, and time moves only
 * where a test moves it.
 *
 * A configured Poll_Interval of 600 seconds keeps the poll loop out of the way:
 * nothing fires unless a test advances the clock by a whole interval on purpose,
 * which is how "a count returned during a mark call" is arranged deliberately
 * rather than stumbled into.
 *
 * Feature: app-shell
 * Requirements: 4.1, 4.7, 6.7, 6.8, 6.12, 6.13
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationRecord } from '../lib/notificationParsing';
import {
  advanceClock,
  notificationRecord,
  renderNotificationCentre,
  type NotificationCentreHarness,
} from './notificationCentreTestHarness';

// --- Constants and fixtures -------------------------------------------------

/** The configured Poll_Interval every harness here mounts with, in seconds. */
const POLL_INTERVAL_SECONDS = 600;

/** The same interval in milliseconds — one whole poll cycle. */
const POLL_INTERVAL_MS = POLL_INTERVAL_SECONDS * 1000;

const FIRST_ID = '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f0001';
const SECOND_ID = '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f0002';
const READ_ID = '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f0003';
const ABSENT_ID = '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f9999';

/**
 * A displayed Notification_List: two unread records and one already read.
 *
 * The creation instants descend in array order, so the machine's newest-first
 * ordering leaves this array *as* the display order — which keeps every assertion
 * below about read states rather than about positions.
 *
 * The already-read record earns its place twice: it is the target of "activating a
 * record that is already read issues nothing" (Requirement 6.3, which is how
 * Requirement 6.12's "only in consequence of an activation" stays honest), and it
 * is the neighbour that must be left alone when another record is marked.
 */
const RECORDS: readonly NotificationRecord[] = [
  notificationRecord({
    notificationId: FIRST_ID,
    title: 'Match drafted',
    createdAtMs: Date.UTC(2025, 0, 3, 12, 0, 0),
    readState: 'unread',
  }),
  notificationRecord({
    notificationId: SECOND_ID,
    title: 'Teams rolled',
    createdAtMs: Date.UTC(2025, 0, 2, 12, 0, 0),
    readState: 'unread',
  }),
  notificationRecord({
    notificationId: READ_ID,
    title: 'Result posted',
    createdAtMs: Date.UTC(2025, 0, 1, 12, 0, 0),
    readState: 'read',
  }),
];

/** The Unread_Count the backend reports before anything is marked. */
const SEEDED_COUNT = 5;

// --- Helpers ----------------------------------------------------------------

/**
 * Put a Notification_List and an accepted Unread_Count on screen, leaving nothing
 * awaiting a response.
 *
 * Three settlements, in an order that keeps them independent: the mount's
 * unread-count call, then a panel opening's list call carrying the records, then
 * that opening's unread-count call. Nothing is marking while either count settles,
 * so both are accepted rather than discarded, and the poll timer is left armed for
 * a whole 600-second interval — so no unread-count call arrives until a test asks
 * for one.
 */
async function seedDisplayedList(
  harness: NotificationCentreHarness,
  unreadCount = SEEDED_COUNT,
): Promise<void> {
  await harness.countCalls()[0].succeed(unreadCount);

  await harness.openPanel();
  await harness.listCalls()[0].succeed([...RECORDS]);
  await harness.countCalls()[1].succeed(unreadCount);

  expect(harness.centre.records).toHaveLength(RECORDS.length);
  expect(harness.centre.unreadCount).toBe(unreadCount);
  expect(harness.centre.failureMessage).toBeNull();
  expect(markCalls(harness)).toBe(0);
}

/** Mount a machine that already displays {@link RECORDS} and a count. */
async function mountSeeded(
  unreadCount = SEEDED_COUNT,
): Promise<NotificationCentreHarness> {
  const harness = await renderNotificationCentre({
    pollIntervalSeconds: POLL_INTERVAL_SECONDS,
  });

  await seedDisplayedList(harness, unreadCount);

  return harness;
}

/** How many Read_State-changing calls the machine has issued, of either kind. */
function markCalls(harness: NotificationCentreHarness): number {
  return (
    harness.transport.callsOf('markRead').length +
    harness.transport.callsOf('markAllRead').length
  );
}

/** The displayed Read_State of one record, or `undefined` if it is not displayed. */
function readStateOf(
  harness: NotificationCentreHarness,
  notificationId: string,
): NotificationRecord['readState'] | undefined {
  return harness.centre.records.find(
    (record) => record.notificationId === notificationId,
  )?.readState;
}

/** The displayed Read_States, in display order. */
function readStates(
  harness: NotificationCentreHarness,
): readonly NotificationRecord['readState'][] {
  return harness.centre.records.map((record) => record.readState);
}

/**
 * Re-render the machine without changing anything it was given.
 *
 * A re-render of the Shell_Frame or the Notification_Panel supplies the same
 * Squad_Scope, the same Auth_State, and the same configured Poll_Interval; passing
 * those values again is exactly what Requirements 4.1 and 4.7 say must issue no
 * call. Several rounds, because a machine that issued one call per re-render and a
 * machine that issued one on the *first* re-render only would both pass a single
 * round.
 */
async function rerenderUnchanged(
  harness: NotificationCentreHarness,
  rounds = 3,
): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await harness.setProps({});
    await harness.setProps({ squadScope: null });
    await harness.setProps({ pollIntervalSeconds: POLL_INTERVAL_SECONDS });
  }
}

// --- Mount discipline -------------------------------------------------------

describe('notification centre mount discipline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Validates: Requirement 4.1 (exactly one count call on mount)
  it('issues exactly one unread-count call on mount, at the mount instant, and no list call', async () => {
    const mountInstant = Date.now();
    const harness = await renderNotificationCentre({
      pollIntervalSeconds: POLL_INTERVAL_SECONDS,
    });

    const counts = harness.countCalls();
    expect(counts).toHaveLength(1);
    // "Within 500 milliseconds of that mount" is met with room to spare: the
    // clock has not moved at all, because the call is issued from the mount
    // effect rather than from a timer.
    expect(counts[0].issuedAtMs).toBe(mountInstant);

    // 4.7: the Notification_List is not fetched until the panel opens, so a
    // mount that also listed would be one call too many.
    expect(harness.listCalls()).toHaveLength(0);
    expect(harness.calls).toHaveLength(1);

    // 4.12: operable before the first accepted count, with nothing displayed.
    expect(harness.centre.unreadCount).toBe(0);
    expect(harness.centre.acceptedCountSinceMount).toBe(false);
  });

  // Validates: Requirement 4.1 (no further call in consequence of a re-render)
  it('issues no further unread-count call in consequence of a re-render, whether or not a call is in flight', async () => {
    const harness = await renderNotificationCentre({
      pollIntervalSeconds: POLL_INTERVAL_SECONDS,
    });

    // Re-rendered while the mount call is still unanswered: a machine that
    // re-issued per render would pile calls onto the one in flight.
    await rerenderUnchanged(harness);
    expect(harness.countCalls()).toHaveLength(1);
    expect(harness.pendingCountCalls()).toHaveLength(1);

    // And re-rendered again once it has settled, where the guard against a
    // second concurrent call could no longer be doing the work for it.
    await harness.countCalls()[0].succeed(7);
    await rerenderUnchanged(harness);

    expect(harness.countCalls()).toHaveLength(1);
    expect(harness.listCalls()).toHaveLength(0);
    expect(harness.centre.unreadCount).toBe(7);

    // The poll loop is unaffected: one interval after the settle, exactly one
    // further call — not one per re-render that happened meanwhile.
    await advanceClock(POLL_INTERVAL_MS);
    expect(harness.countCalls()).toHaveLength(2);
  });

  // Validates: Requirement 4.1 (mounts *while authenticated*), 4.9
  it('issues no notification call while the Auth_State is not authenticated, and exactly one once it is', async () => {
    const harness = await renderNotificationCentre({
      pollIntervalSeconds: POLL_INTERVAL_SECONDS,
      authState: 'unauthenticated',
    });

    expect(harness.calls).toHaveLength(0);

    await rerenderUnchanged(harness);
    expect(harness.calls).toHaveLength(0);

    // The count call belongs to the mount-while-authenticated condition, not to
    // the render, so it goes out once the condition holds — and only once.
    await harness.setProps({ authState: 'authenticated' });
    expect(harness.countCalls()).toHaveLength(1);

    await rerenderUnchanged(harness);
    expect(harness.countCalls()).toHaveLength(1);
  });

  // Validates: Requirement 4.1 (a new mount, and only a new mount, calls again)
  it('treats a mount after an unmount as a fresh single unread-count call', async () => {
    const first = await renderNotificationCentre({
      pollIntervalSeconds: POLL_INTERVAL_SECONDS,
    });
    expect(first.countCalls()).toHaveLength(1);
    first.unmount();

    const second = await renderNotificationCentre({
      pollIntervalSeconds: POLL_INTERVAL_SECONDS,
    });

    expect(second.countCalls()).toHaveLength(1);
    // The abandoned machine issues nothing further after it is left (4.9).
    expect(first.countCalls()).toHaveLength(1);
  });
});

// --- Panel opening ----------------------------------------------------------

describe('notification centre panel opening', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Validates: Requirement 4.7 (one count call and one list call per opening)
  it('issues exactly one unread-count call and exactly one list call when the panel opens', async () => {
    const harness = await renderNotificationCentre({
      pollIntervalSeconds: POLL_INTERVAL_SECONDS,
    });
    await harness.countCalls()[0].succeed(4);

    const openInstant = Date.now();
    await harness.openPanel();

    // One of each, and nothing else: two calls in total beyond the mount call.
    expect(harness.countCalls()).toHaveLength(2);
    expect(harness.listCalls()).toHaveLength(1);
    expect(harness.calls).toHaveLength(3);

    // Both issued at the opening rather than a poll interval later, so the
    // displayed count and list reflect the moment of opening.
    expect(harness.countCalls()[1].issuedAtMs).toBe(openInstant);
    expect(harness.listCalls()[0].issuedAtMs).toBe(openInstant);

    // 5.8: the panel indicates loading while its list call is awaited.
    expect(harness.centre.listPhase).toBe('loading');
  });

  // Validates: Requirement 4.7 (no further call from a re-render while open)
  it('issues no further call of either kind in consequence of a re-render while the panel remains open', async () => {
    const harness = await renderNotificationCentre({
      pollIntervalSeconds: POLL_INTERVAL_SECONDS,
    });
    await harness.countCalls()[0].succeed(4);
    await harness.openPanel();

    // Re-rendered with both of the opening's calls still unanswered...
    await rerenderUnchanged(harness);
    expect(harness.countCalls()).toHaveLength(2);
    expect(harness.listCalls()).toHaveLength(1);

    // ...and again with both settled and the panel still open.
    await harness.listCalls()[0].succeed([...RECORDS]);
    await harness.countCalls()[1].succeed(4);
    await rerenderUnchanged(harness);

    expect(harness.countCalls()).toHaveLength(2);
    expect(harness.listCalls()).toHaveLength(1);
    expect(harness.centre.records).toHaveLength(RECORDS.length);
  });

  // Validates: Requirements 4.7, 4.11 (the opening's count call coalesces)
  it('issues its list call and no second concurrent count call when the panel opens during a count call', async () => {
    const harness = await renderNotificationCentre({
      pollIntervalSeconds: POLL_INTERVAL_SECONDS,
    });

    // The mount call is still unanswered, so the opening's count call has an
    // in-flight call to coalesce into. Its list call has no such constraint.
    await harness.openPanel();

    expect(harness.countCalls()).toHaveLength(1);
    expect(harness.pendingCountCalls()).toHaveLength(1);
    expect(harness.listCalls()).toHaveLength(1);

    // The opening is still owed a count, and gets exactly one — at the settle.
    const settleInstant = Date.now();
    await harness.countCalls()[0].succeed(4);

    const counts = harness.countCalls();
    expect(counts).toHaveLength(2);
    expect(counts[1].issuedAtMs).toBe(settleInstant);
    expect(harness.listCalls()).toHaveLength(1);
  });
});

// --- Counts returned while marking ------------------------------------------

describe('notification centre unread counts returned while marking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Validates: Requirement 6.7 (a count during a mark-read wait is discarded)
  it('discards an unread count returned while a mark-read call awaits a response, keeps the loop running, and accepts the next one after it settles', async () => {
    const harness = await mountSeeded();

    // 6.1: the optimistic pair — this record read, the count one lower.
    await harness.markRead(FIRST_ID);
    expect(harness.centre.unreadCount).toBe(SEEDED_COUNT - 1);
    expect(harness.centre.markReadPending).toEqual([FIRST_ID]);

    // A poll cycle lands squarely inside the mark-read wait.
    await advanceClock(POLL_INTERVAL_MS);
    expect(harness.countCalls()).toHaveLength(3);

    await harness.countCalls()[2].succeed(99);

    // 6.7: discarded — the optimistic count stands rather than being overwritten
    // by a server count taken before the marking reached the backend.
    expect(harness.centre.unreadCount).toBe(SEEDED_COUNT - 1);
    expect(harness.centre.failureMessage).toBeNull();
    expect(readStateOf(harness, FIRST_ID)).toBe('read');

    // The discarded call still *settled*, so the loop keeps its rhythm: one
    // interval later the next count call goes out.
    await advanceClock(POLL_INTERVAL_MS);
    expect(harness.countCalls()).toHaveLength(4);

    // 6.2, 6.13: once the mark-read has resolved there is nothing to protect, so
    // the very next returned count prevails — the discard is a property of the
    // wait, not a latch.
    await harness.transport.callsOf('markRead')[0].succeed();
    expect(harness.centre.unreadCount).toBe(SEEDED_COUNT - 1);

    await harness.countCalls()[3].succeed(99);
    expect(harness.centre.unreadCount).toBe(99);
  });

  // Validates: Requirement 6.8 (a count during a mark-all-read wait is discarded)
  it('discards an unread count returned while a mark-all-read call awaits a response', async () => {
    const harness = await mountSeeded();

    // 6.4: pessimistic — nothing displayed changes yet, only the progress flag.
    await harness.markAllRead();
    expect(harness.centre.markAllPending).toBe(true);
    expect(harness.centre.unreadCount).toBe(SEEDED_COUNT);
    expect(readStates(harness)).toEqual(['unread', 'unread', 'read']);

    await advanceClock(POLL_INTERVAL_MS);
    expect(harness.countCalls()).toHaveLength(3);
    await harness.countCalls()[2].succeed(42);

    // 6.8: discarded; the count displayed before the activation is retained.
    expect(harness.centre.unreadCount).toBe(SEEDED_COUNT);
    expect(harness.centre.failureMessage).toBeNull();
    expect(readStates(harness)).toEqual(['unread', 'unread', 'read']);

    // 6.5: and the success sets 0, irrespective of the 42 the backend reported.
    await harness.transport.callsOf('markAllRead')[0].succeed(42);
    expect(harness.centre.markAllPending).toBe(false);
    expect(harness.centre.unreadCount).toBe(0);
    expect(readStates(harness)).toEqual(['read', 'read', 'read']);
  });

  // Validates: Requirement 6.7 (no second concurrent call for the same record)
  it('prevents a second concurrent mark-read call for the same record while allowing one for another record', async () => {
    const harness = await mountSeeded();

    await harness.markRead(FIRST_ID);
    expect(harness.transport.callsOf('markRead')).toHaveLength(1);

    // The same record again, twice over, while its call is still unanswered.
    await harness.markRead(FIRST_ID);
    await harness.markRead(FIRST_ID);
    expect(harness.transport.callsOf('markRead')).toHaveLength(1);
    expect(harness.centre.markReadPending).toEqual([FIRST_ID]);
    expect(harness.centre.unreadCount).toBe(SEEDED_COUNT - 1);

    // A *different* record is a different call, and is not held up by the first.
    await harness.markRead(SECOND_ID);
    const markReads = harness.transport.callsOf('markRead');
    expect(markReads).toHaveLength(2);
    expect(markReads.map((call) => call.notificationId)).toEqual([
      FIRST_ID,
      SECOND_ID,
    ]);
    expect(harness.centre.markReadPending).toEqual([FIRST_ID, SECOND_ID]);
    expect(harness.centre.unreadCount).toBe(SEEDED_COUNT - 2);

    // 6.7: a count is discarded while *either* mark-read call is outstanding.
    await advanceClock(POLL_INTERVAL_MS);
    await harness.countCalls()[2].succeed(77);
    expect(harness.centre.unreadCount).toBe(SEEDED_COUNT - 2);

    await markReads[0].succeed();
    await advanceClock(POLL_INTERVAL_MS);
    await harness.countCalls()[3].succeed(77);
    expect(harness.centre.unreadCount).toBe(SEEDED_COUNT - 2);

    // With the last one resolved, the server count prevails again.
    await markReads[1].succeed();
    await advanceClock(POLL_INTERVAL_MS);
    await harness.countCalls()[4].succeed(77);
    expect(harness.centre.unreadCount).toBe(77);
  });

  // Validates: Requirement 6.8 (progress indication, one activation at a time)
  it('reports mark-all-read progress and prevents a second concurrent activation', async () => {
    const harness = await mountSeeded();

    await harness.markAllRead();
    expect(harness.centre.markAllPending).toBe(true);
    expect(harness.transport.callsOf('markAllRead')).toHaveLength(1);

    await harness.markAllRead();
    await harness.markAllRead();
    expect(harness.transport.callsOf('markAllRead')).toHaveLength(1);

    // Available again for a further attempt once the first call resolves.
    await harness.transport.callsOf('markAllRead')[0].fail();
    expect(harness.centre.markAllPending).toBe(false);

    await harness.markAllRead();
    expect(harness.transport.callsOf('markAllRead')).toHaveLength(2);
    expect(harness.centre.markAllPending).toBe(true);
  });
});

// --- The server count prevailing otherwise ----------------------------------

describe('notification centre server count precedence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Validates: Requirement 6.13 (the returned count replaces the displayed one)
  it('replaces the displayed count with a differing returned count, leaving read states and messages alone', async () => {
    const harness = await mountSeeded();

    const before = readStates(harness);
    expect(harness.centre.unreadCount).toBe(SEEDED_COUNT);

    // Higher than the displayed count — something arrived that the shell has not
    // listed yet, so the locally derived number cannot be the authority.
    await advanceClock(POLL_INTERVAL_MS);
    await harness.countCalls()[2].succeed(SEEDED_COUNT + 3);

    expect(harness.centre.unreadCount).toBe(SEEDED_COUNT + 3);
    expect(readStates(harness)).toEqual(before);
    expect(harness.centre.failureMessage).toBeNull();
    expect(harness.centre.acceptedCountSinceMount).toBe(true);

    // And lower, including 0 while unread records are still displayed: another
    // client marked them read, and the backend's number still prevails.
    await advanceClock(POLL_INTERVAL_MS);
    await harness.countCalls()[3].succeed(0);

    expect(harness.centre.unreadCount).toBe(0);
    expect(readStates(harness)).toEqual(before);
    expect(harness.centre.failureMessage).toBeNull();
  });

  // Validates: Requirement 6.13 (a count settling after a mark call is accepted)
  it('accepts a count returned after an optimistic mark-read has already resolved', async () => {
    const harness = await mountSeeded();

    await harness.markRead(FIRST_ID);
    await harness.transport.callsOf('markRead')[0].succeed();

    // 6.2: the optimistic pair is retained by the success itself.
    expect(harness.centre.unreadCount).toBe(SEEDED_COUNT - 1);
    expect(readStateOf(harness, FIRST_ID)).toBe('read');
    expect(harness.centre.markReadPending).toEqual([]);

    await advanceClock(POLL_INTERVAL_MS);
    await harness.countCalls()[2].succeed(SEEDED_COUNT - 1);

    // The backend's own count, now agreeing with the local one — and the record
    // the person marked stays read either way.
    expect(harness.centre.unreadCount).toBe(SEEDED_COUNT - 1);
    expect(readStateOf(harness, FIRST_ID)).toBe('read');
    expect(harness.centre.failureMessage).toBeNull();
  });
});

// --- No implicit marking ----------------------------------------------------

describe('notification centre implicit marking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Validates: Requirement 6.12 (no mark call without an activation)
   *
   * The DOM half of Requirement 6.12 — hovering, focusing, and scrolling a
   * rendered Notification_Row — belongs with the Notification_Row's own suite.
   * What is held here is the machine's half: displaying records, re-rendering,
   * opening the panel, polling, and changing scope issue no mark call at all.
   */
  it('issues no mark call across mounting, re-rendering, panel openings, list loads, poll cycles, and a scope change', async () => {
    const harness = await renderNotificationCentre({
      pollIntervalSeconds: POLL_INTERVAL_SECONDS,
      squadScope: null,
    });

    expect(markCalls(harness)).toBe(0);

    await harness.countCalls()[0].succeed(SEEDED_COUNT);
    expect(markCalls(harness)).toBe(0);

    // Opening the panel and *displaying* unread records — the case Requirement
    // 6.12 is chiefly about — marks nothing.
    await harness.openPanel();
    await harness.listCalls()[0].succeed([...RECORDS]);
    await harness.countCalls()[1].succeed(SEEDED_COUNT);
    expect(harness.centre.records).toHaveLength(RECORDS.length);
    expect(readStates(harness)).toEqual(['unread', 'unread', 'read']);
    expect(markCalls(harness)).toBe(0);

    // Re-renders while those unread records are displayed.
    await rerenderUnchanged(harness);
    expect(markCalls(harness)).toBe(0);

    // A second opening, and its calls settling.
    await harness.openPanel();
    await harness.listCalls()[1].succeed([...RECORDS]);
    await harness.countCalls()[2].succeed(SEEDED_COUNT);
    expect(markCalls(harness)).toBe(0);

    // Several poll cycles, each answering with a count.
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await advanceClock(POLL_INTERVAL_MS);
      const latest = harness.pendingCountCalls()[0];
      expect(latest).toBeDefined();
      await latest.succeed(SEEDED_COUNT);
      expect(markCalls(harness)).toBe(0);
    }

    // A Squad_Scope change, which refetches both endpoints for the new scope.
    await harness.setProps({ squadScope: '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3fabcd' });
    expect(harness.centre.records).toHaveLength(0);
    expect(markCalls(harness)).toBe(0);

    await harness.transport.pendingCallsOf('list')[0].succeed([...RECORDS]);
    await harness.pendingCountCalls()[0].succeed(SEEDED_COUNT);
    expect(readStates(harness)).toEqual(['unread', 'unread', 'read']);

    // Nothing in that whole sequence asked for a Read_State change, so nothing
    // was asked of the backend.
    expect(markCalls(harness)).toBe(0);
    expect(harness.centre.markReadPending).toEqual([]);
    expect(harness.centre.markAllPending).toBe(false);
  });

  // Validates: Requirements 6.3, 6.12 (an activation with nothing to change)
  it('issues no mark-read call for a record that is already read or is not displayed', async () => {
    const harness = await mountSeeded();

    const before = readStates(harness);

    // 6.3: already read — the displayed pair is unchanged and no call goes out.
    await harness.markRead(READ_ID);
    expect(harness.transport.callsOf('markRead')).toHaveLength(0);

    // Not displayed at all: nothing to change, so nothing is asked.
    await harness.markRead(ABSENT_ID);
    expect(harness.transport.callsOf('markRead')).toHaveLength(0);

    expect(readStates(harness)).toEqual(before);
    expect(harness.centre.unreadCount).toBe(SEEDED_COUNT);
    expect(harness.centre.failureMessage).toBeNull();
  });

  // Validates: Requirement 6.12 (the two issuers, one call per activation)
  it('issues exactly one call per explicit activation, from the two activations that may issue one', async () => {
    const harness = await mountSeeded();

    await harness.markRead(FIRST_ID);
    expect(harness.transport.callsOf('markRead')).toHaveLength(1);
    expect(harness.transport.callsOf('markAllRead')).toHaveLength(0);

    await harness.transport.callsOf('markRead')[0].succeed();
    expect(harness.transport.callsOf('markRead')).toHaveLength(1);

    await harness.markAllRead();
    expect(harness.transport.callsOf('markRead')).toHaveLength(1);
    expect(harness.transport.callsOf('markAllRead')).toHaveLength(1);

    await harness.transport.callsOf('markAllRead')[0].succeed(0);

    // 6.5, 6.9: everything read and the count 0, so the Mark_All_Read_Control is
    // disabled and there is nothing left for an activation to ask for.
    expect(readStates(harness)).toEqual(['read', 'read', 'read']);
    expect(harness.centre.markAllReadDisabled).toBe(true);

    await harness.markRead(FIRST_ID);
    await harness.markRead(SECOND_ID);
    expect(harness.transport.callsOf('markRead')).toHaveLength(1);
    expect(harness.transport.callsOf('markAllRead')).toHaveLength(1);
  });
});
