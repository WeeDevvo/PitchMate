/**
 * The shared test harness for the App_Shell's notification state machine.
 *
 * Five suites exercise {@link useNotificationCentre} — count scheduling
 * (Property 17), optimistic marking (Property 18), failure handling
 * (Property 21), scope changes (Property 25), and the mount/marking discipline
 * unit tests — and every one of them needs the same three things: a
 * Notifications_Api whose four calls hang until the test settles them by hand, a
 * way to mount the hook and drive its public actions, and a way to move the fake
 * clock while letting React apply the state updates that fall out.
 *
 * Those three things live here, once. Nothing in this module asserts anything:
 * it observes and it controls, and every judgement about what it observed
 * belongs to the suite that called it.
 *
 * ### Why the transport is a hand-settled fake rather than a stub
 *
 * The machine's whole subject matter is *when* calls are issued relative to when
 * previous calls settled — settle-to-settle scheduling (Requirement 4.6) and
 * single-flight coalescing (Requirement 4.11). A stub that resolves immediately
 * collapses "in flight" to zero duration and makes both unobservable. So
 * {@link createControllableNotificationsApi} records each call and returns a
 * promise the test resolves at an instant of its choosing. An unanswering
 * transport is not a stand-in for the real one here; it is the condition the
 * requirements are about.
 *
 * The Notification_Call_Timeout is *inside* the Notifications_Api facade, not the
 * machine, so from the machine's side a lapsed timeout is indistinguishable from
 * any other failed call. A suite models it by advancing the clock 10 seconds and
 * then settling the call as {@link RecordedCall.fail}. The facade's own timeout
 * behaviour is pinned separately by Property 23.
 *
 * ### Fake timers
 *
 * The suite installs `vi.useFakeTimers()` itself, following the convention the
 * landing and Notifications_Api suites already use. The machine's only ambient
 * timing dependencies are `setTimeout`/`clearTimeout`, so a faked clock puts the
 * whole poll loop under the test's control and no run waits out a real interval.
 *
 * {@link advanceClock} and {@link flush} are the two ways time and promises are
 * allowed to move: both wrap the work in `act`, so a state update triggered by an
 * elapsed timer or a settled call is applied before the caller looks at anything.
 * Time never moves except through {@link advanceClock}, which is what makes each
 * run deterministic rather than dependent on how long the surrounding work took.
 *
 * Feature: app-shell
 * Requirements: 4.1, 4.6, 4.7, 4.11, 6.1, 6.4, 7.3, 9.4
 */

import { act, renderHook } from '@testing-library/react';
import { vi, type Mock } from 'vitest';

import type { AuthState } from '../../auth';
import type {
  AcknowledgementOutcome,
  CountCallOutcome,
  MarkReadRequest,
  NotificationCallOutcome,
  NotificationsApi,
  Outcome,
  ScopedRequest,
} from '../api/notificationsApi';
import type { NotificationRecord } from '../lib/notificationParsing';
import {
  useNotificationCentre,
  type NotificationCentre,
  type NotificationCentreOptions,
} from './useNotificationCentre';

// --- Promise and clock plumbing ---------------------------------------------

/** A promise whose settlement the test performs. */
export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

/** Create a {@link Deferred}. */
export function deferred<T>(): Deferred<T> {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      settle(value);
    },
  };
}

/**
 * How many microtask turns {@link flush} drains.
 *
 * A settled call runs through several chained `then`s — the facade's promise, the
 * machine's settle path, React's update — so one turn is not enough. Sixteen is
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
 * run depends on a real delay, and an assertion made after `flush` is made
 * against settled state.
 */
export async function flush(): Promise<void> {
  await act(async () => {
    await drainMicrotasks();
  });
}

/**
 * Move the fake clock forward by `ms`, applying whatever the elapsed timers set
 * in motion.
 *
 * `advanceTimersByTimeAsync` awaits between timer callbacks, so a timer whose
 * callback issues a call has that call recorded before this resolves.
 */
export async function advanceClock(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// --- The controllable Notifications_Api -------------------------------------

/** The four calls the Notifications_Api exposes. */
export type NotificationCallKind =
  | 'list'
  | 'unreadCount'
  | 'markRead'
  | 'markAllRead';

/**
 * One call the machine issued, with the values it carried and the means to
 * settle it.
 *
 * `issuedAtMs` is the fake clock's reading at the instant the call was issued,
 * which is what lets a suite check *when* a call went out rather than only that
 * it did — the difference between settle-to-settle scheduling and scheduling
 * from the issue instant (Requirement 4.6).
 */
export interface RecordedCall {
  readonly kind: NotificationCallKind;
  /** The call's position in the order every call was issued, across all kinds. */
  readonly sequence: number;
  /** The fake clock's reading when the call was issued. */
  readonly issuedAtMs: number;
  /** The Squad_Scope the call carried, or `undefined` for an account-wide call. */
  readonly squadId: string | undefined;
  /** The notification identity a mark-read call carried. */
  readonly notificationId: string | undefined;
  /** The signal the machine bounded the call with. */
  readonly signal: AbortSignal | undefined;
  /** Whether this call has been settled by the test. */
  isSettled(): boolean;
  /** Settle the call with any outcome, then let the machine react. */
  settle(outcome: Outcome<unknown>): Promise<void>;
  /** Settle as `success`; the value is the count, the records, or nothing. */
  succeed(value?: unknown): Promise<void>;
  /** Settle as `failure` — a transport failure, a parse failure, or a lapsed timeout. */
  fail(): Promise<void>;
  /** Settle as `not-found`. */
  notFound(): Promise<void>;
  /** Settle as `unauthenticated`, which begins the session-expiry handover. */
  unauthenticated(): Promise<void>;
}

/** A Notifications_Api whose calls the test answers by hand. */
export interface ControllableNotificationsApi {
  /** The facade to hand to the machine. */
  readonly api: NotificationsApi;
  /** Every call issued, in the order issued. */
  readonly calls: readonly RecordedCall[];
  /** Every call of one kind, in the order issued. */
  callsOf(kind: NotificationCallKind): readonly RecordedCall[];
  /** The calls of one kind still awaiting a settlement. */
  pendingCallsOf(kind: NotificationCallKind): readonly RecordedCall[];
  /** The most recently issued call of one kind, if any. */
  latestCallOf(kind: NotificationCallKind): RecordedCall | undefined;
}

/**
 * Create a Notifications_Api that records every call and answers none of them
 * until the test says so.
 *
 * The four methods share one recorder, so `calls` gives the true issue order
 * across kinds — which is what shows, for instance, that opening the panel issues
 * one count call and one list call rather than two of either (Requirement 4.7).
 */
export function createControllableNotificationsApi(): ControllableNotificationsApi {
  const calls: RecordedCall[] = [];

  const record = <T,>(
    kind: NotificationCallKind,
    squadId: string | undefined,
    notificationId: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<T> => {
    const answer = deferred<Outcome<unknown>>();
    let settled = false;

    const settle = async (outcome: Outcome<unknown>): Promise<void> => {
      // Settling twice is a no-op rather than an error, so a suite can settle
      // "every pending call" without first working out which are already done.
      if (settled) {
        return;
      }
      settled = true;
      answer.resolve(outcome);
      await flush();
    };

    calls.push({
      kind,
      sequence: calls.length,
      issuedAtMs: Date.now(),
      squadId,
      notificationId,
      signal,
      isSettled: () => settled,
      settle,
      succeed: (value) => settle({ kind: 'success', value }),
      fail: () => settle({ kind: 'failure' }),
      notFound: () => settle({ kind: 'not-found' }),
      unauthenticated: () => settle({ kind: 'unauthenticated' }),
    });

    // The recorder is one function for four differently-valued outcomes, so the
    // per-call value type is asserted at this single boundary rather than
    // duplicating the recorder four times.
    return answer.promise as unknown as Promise<T>;
  };

  const api: NotificationsApi = {
    list: (request: ScopedRequest = {}) =>
      record<NotificationCallOutcome>(
        'list',
        request.squadId,
        undefined,
        request.signal,
      ),
    unreadCount: (request: ScopedRequest = {}) =>
      record<CountCallOutcome>(
        'unreadCount',
        request.squadId,
        undefined,
        request.signal,
      ),
    markRead: (request: MarkReadRequest) =>
      record<AcknowledgementOutcome>(
        'markRead',
        undefined,
        request.notificationId,
        request.signal,
      ),
    markAllRead: (request: ScopedRequest = {}) =>
      record<CountCallOutcome>(
        'markAllRead',
        request.squadId,
        undefined,
        request.signal,
      ),
  };

  return {
    api,
    calls,
    callsOf: (kind) => calls.filter((call) => call.kind === kind),
    pendingCallsOf: (kind) =>
      calls.filter((call) => call.kind === kind && !call.isSettled()),
    latestCallOf: (kind) => {
      const ofKind = calls.filter((call) => call.kind === kind);
      return ofKind[ofKind.length - 1];
    },
  };
}

// --- Rendering the machine --------------------------------------------------

/** The machine inputs a suite may set on mount and change afterwards. */
export interface NotificationCentreProps {
  /** The active Squad_Scope, or `null` for the account-wide view. */
  readonly squadScope?: string | null;
  /** The Auth_State; the poll loop runs only while `authenticated`. */
  readonly authState?: AuthState;
  /** The configured Poll_Interval in seconds, before folding and clamping. */
  readonly pollIntervalSeconds?: unknown;
}

/** Options for {@link renderNotificationCentre}. */
export interface RenderNotificationCentreOptions extends NotificationCentreProps {
  /**
   * What the injected sign-out does. Defaults to returning nothing; the harness
   * always wraps it in a spy so a suite can count invocations.
   */
  readonly signOut?: () => void | Promise<void>;
}

/** A mounted notification state machine, with its transport under control. */
export interface NotificationCentreHarness {
  /** The controllable transport behind the machine. */
  readonly transport: ControllableNotificationsApi;
  /** Every call the machine has issued, in the order issued. */
  readonly calls: readonly RecordedCall[];
  /** The unread-count calls, in the order issued. */
  countCalls(): readonly RecordedCall[];
  /** The list calls, in the order issued. */
  listCalls(): readonly RecordedCall[];
  /** The unread-count calls still awaiting a settlement. */
  pendingCountCalls(): readonly RecordedCall[];
  /** The current machine surface, as the shell's components would read it. */
  readonly centre: NotificationCentre;
  /** The injected sign-out, spied so the handover's one invocation is countable. */
  readonly signOut: Mock<() => void | Promise<void>>;
  /** Tell the machine the Notification_Panel has opened (Requirement 4.7). */
  openPanel(): Promise<void>;
  /** Activate the retry control (Requirement 5.9). */
  retryList(): Promise<void>;
  /** Activate one record's mark-read (Requirements 6.1, 6.2). */
  markRead(notificationId: string): Promise<void>;
  /** Activate mark-all-read (Requirements 6.4, 6.5). */
  markAllRead(): Promise<void>;
  /** Change the Squad_Scope, the Auth_State, or the configured Poll_Interval. */
  setProps(next: NotificationCentreProps): Promise<void>;
  /** Leave the shell (Requirement 4.9). */
  unmount(): void;
}

/**
 * Mount {@link useNotificationCentre} with a controllable transport.
 *
 * The hook is mounted directly rather than through
 * `NotificationCentreProvider`, because every behaviour these suites cover is the
 * machine's own: the provider's job is to run exactly one machine for the whole
 * frame and to source the Squad_Scope and Auth_State from context, and that
 * wiring is covered by the provider's and the Squad_Scope's own tests. Mounting
 * the hook keeps the Squad_Scope and the Auth_State as plain inputs a suite can
 * change with {@link NotificationCentreHarness.setProps}.
 *
 * Resolves once the mount's effects have run, so the caller sees the mount call
 * (Requirement 4.1) already recorded.
 */
export async function renderNotificationCentre(
  options: RenderNotificationCentreOptions = {},
): Promise<NotificationCentreHarness> {
  const transport = createControllableNotificationsApi();
  const signOut: Mock<() => void | Promise<void>> = vi.fn(
    options.signOut ?? (() => undefined),
  );

  let props: NotificationCentreOptions = {
    api: transport.api,
    signOut,
    squadScope: options.squadScope ?? null,
    authState: options.authState ?? 'authenticated',
    pollIntervalSeconds: options.pollIntervalSeconds,
  };

  const rendered = renderHook(
    (current: NotificationCentreOptions) => useNotificationCentre(current),
    { initialProps: props },
  );

  await flush();

  /** Run one of the machine's public actions and apply what follows. */
  const perform = async (action: (centre: NotificationCentre) => void) => {
    await act(async () => {
      action(rendered.result.current);
      await drainMicrotasks();
    });
  };

  return {
    transport,
    calls: transport.calls,
    countCalls: () => transport.callsOf('unreadCount'),
    listCalls: () => transport.callsOf('list'),
    pendingCountCalls: () => transport.pendingCallsOf('unreadCount'),
    get centre() {
      return rendered.result.current;
    },
    signOut,
    openPanel: () => perform((centre) => centre.notifyPanelOpened()),
    retryList: () => perform((centre) => centre.retryList()),
    markRead: (notificationId) =>
      perform((centre) => centre.markRead(notificationId)),
    markAllRead: () => perform((centre) => centre.markAllRead()),
    setProps: async (next) => {
      props = { ...props, ...next };
      await act(async () => {
        rendered.rerender(props);
        await drainMicrotasks();
      });
    },
    unmount: () => {
      rendered.unmount();
    },
  };
}

// --- Record fixtures --------------------------------------------------------

/** The shape a {@link notificationRecord} starts from. */
const BASE_RECORD: NotificationRecord = {
  notificationId: '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b',
  type: { kind: 'catalogued', value: 'match-drafted' },
  squadId: '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5c',
  title: 'Match drafted',
  body: 'Respond with your availability.',
  createdAtMs: Date.UTC(2025, 0, 1, 12, 0, 0),
  readState: 'unread',
};

/**
 * A well-formed Notification_Record, overridable field by field.
 *
 * Suites that care about a record's content build it themselves; this is for the
 * ones that need "some record with this identity and this read state" without
 * restating six irrelevant fields.
 */
export function notificationRecord(
  overrides: Partial<NotificationRecord> = {},
): NotificationRecord {
  return { ...BASE_RECORD, ...overrides };
}
