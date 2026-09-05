/**
 * The App_Shell's notification state machine — one reducer-backed hook holding
 * every displayed notification value and issuing every notification call.
 *
 * The Notification_Indicator, the Notification_Panel, and the
 * Notifications_Destination all read **one** instance of this machine through
 * `NotificationCentreContext`, which is what makes "one mount, one poll loop"
 * true rather than aspirational (Requirement 4.1). Nothing else in the shell
 * calls the Notifications_Api.
 *
 * ### Ten behaviours worth stating
 *
 * These are the places the requirements bite, and each one is implemented in
 * exactly one place below.
 *
 * 1. **Settle-to-settle scheduling** (Requirement 4.6). The next unread-count
 *    call is scheduled from the instant the previous one *settled* — a returned
 *    response, a transport failure, or the 10-second Notification_Call_Timeout —
 *    never from the instant it was issued. A slow backend therefore cannot cause
 *    calls to pile up on top of each other.
 * 2. **Single-flight with coalescing** (Requirement 4.11). While a count call
 *    awaits a response, every further trigger — a Poll_Interval elapse, a
 *    Notification_Panel opening — sets one `countRefreshQueued` flag rather than
 *    issuing a call. Exactly **one** follow-up call is issued once the awaiting
 *    call settles, however many triggers were suppressed.
 * 3. **Count suppression while marking** (Requirements 6.7, 6.8). A count
 *    returned while a mark-read or mark-all-read call is in flight is discarded,
 *    so a stale server count cannot overwrite an optimistic one. The call is
 *    still treated as settled, so the loop keeps its rhythm.
 * 4. **The server count prevails otherwise** (Requirement 6.13). With no marking
 *    in flight, an accepted count replaces the displayed count outright — it does
 *    not touch any displayed Read_State and raises no failure message.
 * 5. **Optimistic mark-read** (Requirements 6.1, 6.2, 6.6). The Read_State flips
 *    and the count decrements *synchronously in the activation handler*, before
 *    the request is issued, and a snapshot of `(records, unreadCount)` is kept so
 *    a failure restores exactly what was displayed beforehand.
 * 6. **Pessimistic mark-all-read** (Requirements 6.4, 6.5). Nothing changes until
 *    the call succeeds; on success every displayed record becomes `read` and the
 *    count becomes 0, whatever number the endpoint returned.
 * 7. **Failure retains, never clears** (Requirements 4.8, 5.9, 7.7, 11.10). A
 *    failed list call keeps the records already displayed; a failed count call
 *    keeps the last accepted count. The only user-facing text is the fixed
 *    `GENERIC_NOTIFICATION_FAILURE`, which carries no status, header, or body
 *    value, so a squad-scoped failure and an account-wide one are indistinguishable.
 * 8. **Scope generation guard** (Requirements 7.3, 7.4). Every call remembers the
 *    generation number of the Squad_Scope it was issued for. A response whose
 *    generation is not the current one is dropped in silence — no records, no
 *    count, no message — so a late response cannot repopulate the list with the
 *    previous scope's records.
 * 9. **One-shot handover latch** (Requirements 9.3–9.6). The *first*
 *    `unauthenticated` outcome cancels the timer, aborts every in-flight call,
 *    discards the displayed list and count, and invokes the Auth_Feature's
 *    sign-out **once**. Every later `unauthenticated` outcome is dropped. No
 *    failure message is shown and no optimistic marking is rolled back: an ended
 *    session is a handover, not a failed attempt.
 * 10. **No implicit marking** (Requirement 6.12). Rendering, hovering, focusing,
 *     and scrolling issue nothing. The only two issuers of a Read_State change
 *     are {@link NotificationCentre.markRead} and
 *     {@link NotificationCentre.markAllRead}, both of which require an explicit
 *     activation.
 *
 * ### Why refs as well as a reducer
 *
 * The displayed values live in a reducer, because they are what React renders.
 * The *control-flow* decisions — is a count already in flight, has the scope
 * changed since this call was issued, has the handover already happened — must be
 * answered synchronously, at the instant a response settles, and React state is
 * not available synchronously after a dispatch.
 *
 * Rather than duplicating those flags into refs (two sources of truth, one of
 * them always a render behind), {@link useNotificationCentre} wraps `dispatch` so
 * that every action is *also* folded into `stateRef` immediately. The reducer is
 * pure, so folding it twice is free of consequence, and `stateRef.current` is
 * always the state as of the last dispatch rather than as of the last render.
 * Every decision below reads `stateRef.current`; nothing reads the rendered
 * `state`.
 *
 * ### Injected seams
 *
 * The hook touches no module-level singleton. The Notifications_Api, the
 * Auth_Feature's sign-out, the configured Poll_Interval, the Squad_Scope, and the
 * Auth_State all arrive as options, and the only ambient dependencies are
 * `setTimeout`/`clearTimeout` and `AbortController` — both of which
 * `vi.useFakeTimers()` and jsdom already control. That is what lets the poll
 * loop, the timeout, and the handover be driven in a test rather than waited out.
 *
 * Requirements: 4.1, 4.6, 4.7, 4.8, 4.9, 4.11, 4.12, 5.7, 5.8, 5.9, 6.1, 6.2,
 * 6.4, 6.5, 6.6, 6.7, 6.8, 6.12, 6.13, 7.3, 7.4, 7.7, 9.3, 9.4, 9.5, 9.6, 11.10
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import type { AuthState } from '../../auth';
import type {
  NotificationsApi,
  ScopedRequest,
} from '../api/notificationsApi';
import { GENERIC_NOTIFICATION_FAILURE } from '../lib/messages';
import type { NotificationRecord } from '../lib/notificationParsing';
import {
  orderNotifications,
  panelPreviewNotifications,
} from '../lib/notificationOrdering';
import { effectivePollIntervalSeconds } from '../lib/pollInterval';
import {
  applyMarkAllRead,
  applyMarkRead,
  type ReadStateView,
} from '../lib/readStateTransitions';

// --- State ------------------------------------------------------------------

/** How far the Notification_List has got for the current Squad_Scope. */
export type NotificationListPhase = 'idle' | 'loading' | 'loaded';

/**
 * The pre-activation values a failed mark-read call restores (Requirement 6.6).
 */
type MarkReadSnapshot = ReadStateView;

/**
 * Every displayed notification value, plus the flags the surfaces need to render
 * progress and availability.
 *
 * `unreadCount` starts at 0 with `acceptedCountSinceMount` false, which is how
 * the Notification_Indicator renders without an Unread_Badge yet stays operable
 * before the first accepted count arrives (Requirement 4.12).
 */
export interface NotificationCentreState {
  /** The displayed Notification_List: ordered newest-first and capped at 200. */
  readonly records: readonly NotificationRecord[];
  /** The displayed Unread_Count (Requirements 4.2–4.5, 4.12). */
  readonly unreadCount: number;
  /** Whether any unread-count call has been accepted since mount (Req 4.8, 4.12). */
  readonly acceptedCountSinceMount: boolean;
  /** How far the list has got, which drives the loading and empty states (Req 5.7, 5.8). */
  readonly listPhase: NotificationListPhase;
  /** The Generic_Notification_Failure message, or `null` (Requirements 7.7, 11.10). */
  readonly failureMessage: string | null;
  /** Whether a mark-all-read call awaits a response (Requirement 6.8). */
  readonly markAllPending: boolean;
  /** The identities whose mark-read call awaits a response (Requirement 6.7). */
  readonly markReadPending: readonly string[];
  /** Whether an unread-count call awaits a response (Requirement 4.11). */
  readonly countInFlight: boolean;
  /** Whether a suppressed trigger owes exactly one follow-up count call (Req 4.11). */
  readonly countRefreshQueued: boolean;
  /** The generation of the active Squad_Scope (Requirements 7.3, 7.4). */
  readonly scopeGeneration: number;
  /** Whether the session-expiry handover has begun (Requirements 9.3–9.6). */
  readonly handoverInProgress: boolean;
  /** Rollback values per in-flight mark-read call (Requirement 6.6). */
  readonly markReadSnapshots: Readonly<Record<string, MarkReadSnapshot>>;
}

/** The initial state: nothing displayed, nothing in flight (Requirement 4.12). */
export function initialNotificationCentreState(): NotificationCentreState {
  return {
    records: [],
    unreadCount: 0,
    acceptedCountSinceMount: false,
    listPhase: 'idle',
    failureMessage: null,
    markAllPending: false,
    markReadPending: [],
    countInFlight: false,
    countRefreshQueued: false,
    scopeGeneration: 0,
    handoverInProgress: false,
    markReadSnapshots: {},
  };
}

// --- Actions ----------------------------------------------------------------

/**
 * Everything that can move the machine. Each action is dispatched from exactly
 * one place, and no action carries a status code, a header, or a response body
 * value — the failing arms carry nothing at all, so there is nothing to leak
 * (Requirement 11.10).
 */
export type NotificationCentreAction =
  | { readonly type: 'count-requested' }
  | { readonly type: 'count-queued' }
  | { readonly type: 'count-succeeded'; readonly value: number }
  | { readonly type: 'count-failed' }
  | { readonly type: 'list-requested' }
  | { readonly type: 'list-succeeded'; readonly records: readonly NotificationRecord[] }
  | { readonly type: 'list-failed' }
  | { readonly type: 'mark-read-started'; readonly notificationId: string }
  | { readonly type: 'mark-read-succeeded'; readonly notificationId: string }
  | { readonly type: 'mark-read-failed'; readonly notificationId: string }
  | { readonly type: 'mark-all-started' }
  | { readonly type: 'mark-all-succeeded' }
  | { readonly type: 'mark-all-failed' }
  | { readonly type: 'scope-changed' }
  | { readonly type: 'handover-started' }
  | { readonly type: 'stopped' };

/**
 * The one reducer. Pure, total, and free of timers, transport, and DOM — so the
 * whole state machine can be exercised by folding actions over it.
 */
export function reduceNotificationCentre(
  state: NotificationCentreState,
  action: NotificationCentreAction,
): NotificationCentreState {
  switch (action.type) {
    // 4.11: issuing a call clears the queue flag, because this call *is* the
    // follow-up the suppressed triggers were owed.
    case 'count-requested':
      return { ...state, countInFlight: true, countRefreshQueued: false };

    // 4.11: a trigger arriving while a call is in flight buys one follow-up, not
    // one per trigger — the flag is idempotent by construction.
    case 'count-queued':
      return state.countInFlight ? { ...state, countRefreshQueued: true } : state;

    case 'count-succeeded': {
      // 6.7, 6.8: a count returned while marking is in flight is discarded. The
      // call has still settled, so the loop is rescheduled by the caller.
      if (isMarking(state)) {
        return { ...state, countInFlight: false };
      }
      // 6.13: otherwise the backend's count prevails, Read_States are untouched,
      // and no failure message is raised.
      return {
        ...state,
        countInFlight: false,
        unreadCount: action.value,
        acceptedCountSinceMount: true,
      };
    }

    // 4.8: the last accepted count is retained; only the fixed message appears.
    case 'count-failed':
      return {
        ...state,
        countInFlight: false,
        failureMessage: GENERIC_NOTIFICATION_FAILURE,
      };

    // 5.8: the records already displayed stay, and a retained failure message
    // stays alongside the loading indication until this call resolves.
    case 'list-requested':
      return { ...state, listPhase: 'loading' };

    // 5.4, 5.12: ordered newest-first and capped on the way in, so every surface
    // reads one already-ordered list.
    case 'list-succeeded':
      return {
        ...state,
        listPhase: 'loaded',
        records: orderNotifications(action.records),
        failureMessage: null,
      };

    // 5.9: the previously displayed records are retained. The phase falls back to
    // `idle` when nothing has ever loaded, so the "no notifications" message of
    // Requirement 5.7 is not shown for a call that failed.
    case 'list-failed':
      return {
        ...state,
        listPhase: state.listPhase === 'loaded' ? 'loaded' : 'idle',
        failureMessage: GENERIC_NOTIFICATION_FAILURE,
      };

    // 6.1: applied here, synchronously in the activation handler, before the
    // request is issued. The pre-activation pair is kept for rollback (6.6).
    case 'mark-read-started': {
      const snapshot: MarkReadSnapshot = {
        records: state.records,
        unreadCount: state.unreadCount,
      };
      const next = applyMarkRead(snapshot, action.notificationId);

      return {
        ...state,
        records: next.records,
        unreadCount: next.unreadCount,
        markReadPending: [...state.markReadPending, action.notificationId],
        markReadSnapshots: {
          ...state.markReadSnapshots,
          [action.notificationId]: snapshot,
        },
      };
    }

    // 6.2: the optimistic values stand, the snapshot is released, and no failure
    // message is shown for this call.
    case 'mark-read-succeeded':
      return {
        ...releaseMarkRead(state, action.notificationId),
        failureMessage: clearedFailureMessage(state),
      };

    // 6.6: restore exactly what was displayed immediately before the activation.
    case 'mark-read-failed': {
      const released = releaseMarkRead(state, action.notificationId);
      const snapshot = state.markReadSnapshots[action.notificationId];
      const restored = restoreView(
        snapshot ?? { records: state.records, unreadCount: state.unreadCount },
        released.markReadPending,
      );

      return {
        ...released,
        records: restored.records,
        unreadCount: restored.unreadCount,
        failureMessage: GENERIC_NOTIFICATION_FAILURE,
      };
    }

    // 6.4: pessimistic — nothing displayed changes, only the progress flag.
    case 'mark-all-started':
      return { ...state, markAllPending: true };

    // 6.5: every displayed record becomes read and the count becomes 0,
    // irrespective of the number the endpoint returned.
    case 'mark-all-succeeded': {
      const next = applyMarkAllRead({
        records: state.records,
        unreadCount: state.unreadCount,
      });

      return {
        ...state,
        markAllPending: false,
        records: next.records,
        unreadCount: next.unreadCount,
        failureMessage: clearedFailureMessage(state),
      };
    }

    // 6.6: nothing was changed optimistically, so "restore the values held before
    // the activation" is satisfied by leaving them alone — restoring a snapshot
    // here would undo any mark-read a person made while this call was in flight.
    case 'mark-all-failed':
      return {
        ...state,
        markAllPending: false,
        failureMessage: GENERIC_NOTIFICATION_FAILURE,
      };

    // 7.3: a new scope displays nothing of the old one, and the bumped generation
    // makes every outstanding response of the old scope unacceptable (7.4).
    case 'scope-changed':
      return {
        ...initialNotificationCentreState(),
        scopeGeneration: state.scopeGeneration + 1,
      };

    // 9.3: the displayed list and count go, no message is shown, and the latch
    // closes so no second cleanup or sign-out can happen (9.5).
    case 'handover-started':
      return {
        ...initialNotificationCentreState(),
        scopeGeneration: state.scopeGeneration,
        handoverInProgress: true,
      };

    // 4.9: nothing further is owed once the loop is cancelled.
    case 'stopped':
      return { ...state, countInFlight: false, countRefreshQueued: false };

    default:
      return state;
  }
}

/** Whether a mark-read or mark-all-read call awaits a response (Req 6.7, 6.8). */
function isMarking(state: NotificationCentreState): boolean {
  return state.markAllPending || state.markReadPending.length > 0;
}

/** Drop one identity from the pending list and release its snapshot. */
function releaseMarkRead(
  state: NotificationCentreState,
  notificationId: string,
): NotificationCentreState {
  const markReadPending = state.markReadPending.filter(
    (pending) => pending !== notificationId,
  );
  const markReadSnapshots = { ...state.markReadSnapshots };
  delete markReadSnapshots[notificationId];

  return { ...state, markReadPending, markReadSnapshots };
}

/**
 * Restore a rollback snapshot, then re-apply the optimistic marks that are still
 * in flight.
 *
 * With a single mark-read in flight this is exactly the snapshot, which is what
 * Requirement 6.6 asks for. With several in flight it is still right, because
 * `applyMarkRead` is idempotent (Requirement 14.5): a mark that began *before*
 * the failing one is already reflected in the snapshot and re-applying it is a
 * no-op, while a mark that began *after* it is restored. So one call's rollback
 * never silently undoes another's optimistic update.
 */
function restoreView(
  snapshot: ReadStateView,
  stillPending: readonly string[],
): ReadStateView {
  return stillPending.reduce<ReadStateView>(
    (view, notificationId) => applyMarkRead(view, notificationId),
    snapshot,
  );
}

/**
 * What a successful mark call leaves in `failureMessage`.
 *
 * It clears the message, except while a list call awaits a response: Requirement
 * 5.8 requires a retained failure message to stay alongside the loading
 * indication until *that* call resolves, so an unrelated success in the meantime
 * must not erase it.
 */
function clearedFailureMessage(state: NotificationCentreState): string | null {
  return state.listPhase === 'loading' ? state.failureMessage : null;
}

// --- Hook surface -----------------------------------------------------------

/** Options for {@link useNotificationCentre}. Every seam is injected. */
export interface NotificationCentreOptions {
  /**
   * The Notifications_Api facade — the shell's only transport seam
   * (Requirement 11.3). Its identity is read through a ref, so re-creating it on
   * a render cannot restart the poll loop.
   */
  readonly api: NotificationsApi;
  /**
   * The Auth_Feature's sign-out navigation, invoked once by the session-expiry
   * handover (Requirements 9.4, 9.5). The shell performs no session clearing,
   * token handling, or navigation of its own (Requirement 9.2).
   */
  readonly signOut: () => void | Promise<void>;
  /** The active Squad_Scope, or `null` for the account-wide view (Req 7.1–7.3). */
  readonly squadScope?: string | null;
  /** The Auth_State; the loop runs only while `authenticated` (Requirement 4.9). */
  readonly authState?: AuthState;
  /** The configured Poll_Interval in seconds, clamped to 15..600 (Req 4.6). */
  readonly pollIntervalSeconds?: unknown;
}

/** The notification surface every shell component reads (Requirement 4.1). */
export interface NotificationCentre extends NotificationCentreState {
  /** The active Squad_Scope, echoed so the indicator can name its coverage (Req 7.6). */
  readonly squadScope: string | null;
  /** The leading 10 records the Notification_Panel previews (Requirement 5.12). */
  readonly panelRecords: readonly NotificationRecord[];
  /**
   * Whether the Mark_All_Read_Control is disabled: exactly when the count is 0
   * and every displayed record is read (Requirements 6.9, 14.6). A caller also
   * prevents activation while {@link NotificationCentreState.markAllPending}
   * (Requirement 6.8).
   */
  readonly markAllReadDisabled: boolean;
  /**
   * Tell the machine the Notification_Panel has opened: exactly one unread-count
   * call and exactly one list call (Requirement 4.7), the count call coalescing
   * into the in-flight one where there is one (Requirement 4.11).
   */
  notifyPanelOpened(): void;
  /**
   * Issue exactly one further list call. This is the retry control's only
   * behaviour, and it is the *only* retry in the shell — nothing retries itself
   * (Requirements 5.9, 11.11). A further activation is ignored while a list call
   * awaits a response.
   */
  retryList(): void;
  /**
   * Mark one displayed Notification_Record read, optimistically
   * (Requirements 6.1, 6.2, 6.6). A no-op for an identity that is not displayed,
   * is already read (Requirement 6.3), or already has a call in flight
   * (Requirement 6.7).
   */
  markRead(notificationId: string): void;
  /**
   * Mark every unread Notification_Record of the active Squad_Scope read,
   * pessimistically (Requirements 6.4, 6.5). A no-op while a mark-all-read call
   * awaits a response (Requirement 6.8).
   */
  markAllRead(): void;
}

/**
 * Run the notification state machine.
 *
 * Mounting issues exactly one unread-count call and starts the settle-to-settle
 * poll loop (Requirements 4.1, 4.6). A Squad_Scope change discards the displayed
 * values, abandons the previous scope's calls, and refetches (Requirement 7.3).
 * Unmounting, or the Auth_State becoming `unauthenticated`, cancels the loop and
 * makes every outstanding response unacceptable (Requirement 4.9).
 *
 * Requirements: 4.1, 4.6, 4.7, 4.8, 4.9, 4.11, 4.12, 5.7, 5.8, 5.9, 6.1, 6.2,
 * 6.4, 6.5, 6.6, 6.7, 6.8, 6.12, 6.13, 7.3, 7.4, 7.7, 9.3, 9.4, 9.5, 9.6, 11.10
 */
export function useNotificationCentre(
  options: NotificationCentreOptions,
): NotificationCentre {
  const {
    api,
    signOut,
    squadScope = null,
    authState = 'authenticated',
    pollIntervalSeconds,
  } = options;

  const [state, rawDispatch] = useReducer(
    reduceNotificationCentre,
    undefined,
    initialNotificationCentreState,
  );

  // The state as of the last *dispatch* rather than the last render, so every
  // control-flow decision below is made against current values. See the module
  // note on "Why refs as well as a reducer".
  const stateRef = useRef(state);
  const dispatch = useCallback((action: NotificationCentreAction): void => {
    stateRef.current = reduceNotificationCentre(stateRef.current, action);
    rawDispatch(action);
  }, []);

  // 4.6: the effective Poll_Interval, folded and clamped by the pure function.
  const pollIntervalMs = useMemo(
    () => effectivePollIntervalSeconds(pollIntervalSeconds) * 1000,
    [pollIntervalSeconds],
  );

  // The injected seams, held by reference so that a caller re-creating the facade
  // or the sign-out function on a render cannot restart the poll loop, and so
  // that a call settling later reads the *current* scope rather than the one
  // captured when its callback was created.
  //
  // They are synchronised in an effect rather than during render, because a ref
  // must not be written while rendering. Declaring this effect first means it has
  // run before the mount-and-scope effect below reads any of these values, and
  // both effects see a scope change in the same commit.
  const apiRef = useRef(api);
  const signOutRef = useRef(signOut);
  const scopeRef = useRef(squadScope);
  const pollIntervalMsRef = useRef(pollIntervalMs);

  useEffect(() => {
    apiRef.current = api;
    signOutRef.current = signOut;
    scopeRef.current = squadScope;
    pollIntervalMsRef.current = pollIntervalMs;
  }, [api, pollIntervalMs, signOut, squadScope]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllersRef = useRef(new Set<AbortController>());
  /** Set while the machine is stopped by unmount or an ended session (Req 4.9). */
  const stoppedRef = useRef(false);
  /** Whether the mount call has already been issued (Requirement 4.1). */
  const startedRef = useRef(false);

  const clearPollTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /**
   * Abort every call awaiting a response. Used by a Squad_Scope change
   * (Requirement 7.3), by the handover (Requirement 9.3), and by unmount or an
   * ended session (Requirement 4.9). The generation guard already makes their
   * responses unacceptable; aborting stops the requests as well.
   */
  const abortOutstanding = useCallback((): void => {
    for (const controller of controllersRef.current) {
      controller.abort();
    }
    controllersRef.current.clear();
  }, []);

  const stop = useCallback((): void => {
    stoppedRef.current = true;
    clearPollTimer();
    abortOutstanding();
    dispatch({ type: 'stopped' });
  }, [abortOutstanding, clearPollTimer, dispatch]);

  /**
   * Whether a settled call's outcome may still be applied.
   *
   * `false` for a call issued before a Squad_Scope change (Requirement 7.4), for
   * a call outstanding when the shell stopped (Requirement 4.9), and for a call
   * settling after the session-expiry handover began (Requirements 9.3, 9.5). In
   * every one of those cases the response is dropped silently: no records, no
   * count, no failure message, no rollback.
   */
  const acceptable = useCallback((generation: number): boolean => {
    return (
      !stoppedRef.current &&
      !stateRef.current.handoverInProgress &&
      stateRef.current.scopeGeneration === generation
    );
  }, []);

  /**
   * Begin the session-expiry handover, at most once (Requirements 9.3–9.5).
   *
   * The latch closes *before* anything else, and because `dispatch` folds into
   * `stateRef` synchronously, several calls returning `unauthenticated` in the
   * same tick still produce exactly one cleanup and exactly one sign-out
   * invocation.
   */
  const beginHandover = useCallback((): void => {
    if (stateRef.current.handoverInProgress) {
      return;
    }

    // 9.3: cancel the scheduled calls, discard the displayed values, and abandon
    // everything awaiting a response — with no error indication of any kind.
    dispatch({ type: 'handover-started' });
    clearPollTimer();
    abortOutstanding();

    // 9.4: only once that cleanup is done is the Auth_Feature asked to end the
    // session and navigate. The shell does neither itself (Requirement 9.2). A
    // rejected sign-out is the Auth_Feature's concern; swallowing it here keeps
    // the handover from surfacing as an unhandled rejection.
    void Promise.resolve()
      .then(() => signOutRef.current())
      .catch(() => undefined);
  }, [abortOutstanding, clearPollTimer, dispatch]);

  /** Register a call's controller so a scope change or unmount can abort it. */
  const beginCall = useCallback((): AbortController => {
    const controller = new AbortController();
    controllersRef.current.add(controller);
    return controller;
  }, []);

  const endCall = useCallback((controller: AbortController): void => {
    controllersRef.current.delete(controller);
  }, []);

  /** The scoped request shape: the squad identity is omitted when none is active. */
  const scopedRequest = useCallback((signal: AbortSignal): ScopedRequest => {
    const scope = scopeRef.current;
    return scope === null ? { signal } : { squadId: scope, signal };
  }, []);

  // Declared as refs so `runCountCall` and `scheduleNextCountCall` can call each
  // other without either needing the other in a dependency list.
  const runCountCallRef = useRef<() => void>(() => undefined);

  /**
   * Schedule the next unread-count call.
   *
   * Settle-to-settle: this is called from the settle path of the previous count
   * call, never from its issue path (Requirement 4.6). Where triggers were
   * suppressed while that call was in flight, the single owed follow-up is issued
   * at once rather than after another interval (Requirement 4.11).
   */
  const scheduleNextCountCall = useCallback((): void => {
    clearPollTimer();

    if (stoppedRef.current || stateRef.current.handoverInProgress) {
      return;
    }

    if (stateRef.current.countRefreshQueued) {
      runCountCallRef.current();
      return;
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      runCountCallRef.current();
    }, pollIntervalMsRef.current);
  }, [clearPollTimer]);

  /**
   * Issue one unread-count call, or queue exactly one follow-up if a call is
   * already in flight (Requirements 4.1, 4.11).
   */
  const runCountCall = useCallback((): void => {
    if (stoppedRef.current || stateRef.current.handoverInProgress) {
      return;
    }

    // 4.11: single-flight. The trigger buys one follow-up, issued once the
    // awaiting call settles — one, however many triggers were suppressed.
    if (stateRef.current.countInFlight) {
      dispatch({ type: 'count-queued' });
      return;
    }

    // The pending timer belongs to a trigger this call now satisfies.
    clearPollTimer();

    const generation = stateRef.current.scopeGeneration;
    dispatch({ type: 'count-requested' });

    const controller = beginCall();

    void apiRef.current
      .unreadCount(scopedRequest(controller.signal))
      .then((outcome) => {
        endCall(controller);

        // 7.4, 4.9, 9.5: a response for a previous scope, for a stopped shell, or
        // arriving after the handover began changes nothing at all.
        if (!acceptable(generation)) {
          return;
        }

        if (outcome.kind === 'unauthenticated') {
          beginHandover();
          return;
        }

        if (outcome.kind === 'success') {
          // 6.7, 6.13: accepted unless marking is in flight, in which case the
          // reducer discards the value and retains the displayed count.
          dispatch({ type: 'count-succeeded', value: outcome.value });
        } else {
          // 4.8: the last accepted count is retained; the loop carries on.
          dispatch({ type: 'count-failed' });
        }

        // 4.6, 4.8: timed from this settle, whichever way it went.
        scheduleNextCountCall();
      });
  }, [
    acceptable,
    beginCall,
    beginHandover,
    clearPollTimer,
    dispatch,
    endCall,
    scheduleNextCountCall,
    scopedRequest,
  ]);

  // Bound in an effect rather than during render. The ref is only ever read
  // asynchronously — from the poll timer, or from the settle path of a count call
  // — so it is always bound by the time it is used.
  useEffect(() => {
    runCountCallRef.current = runCountCall;
  }, [runCountCall]);

  /**
   * Issue one list call. Ignored while a list call awaits a response, so the
   * retry control yields exactly one call per activation (Requirements 5.9,
   * 11.11).
   */
  const runListCall = useCallback((): void => {
    if (
      stoppedRef.current ||
      stateRef.current.handoverInProgress ||
      stateRef.current.listPhase === 'loading'
    ) {
      return;
    }

    const generation = stateRef.current.scopeGeneration;
    dispatch({ type: 'list-requested' });

    const controller = beginCall();

    void apiRef.current
      .list(scopedRequest(controller.signal))
      .then((outcome) => {
        endCall(controller);

        if (!acceptable(generation)) {
          return;
        }

        if (outcome.kind === 'unauthenticated') {
          beginHandover();
          return;
        }

        if (outcome.kind === 'success') {
          dispatch({ type: 'list-succeeded', records: outcome.value });
        } else {
          // 5.9: the records already displayed are retained and the retry control
          // stays available; nothing retries itself.
          dispatch({ type: 'list-failed' });
        }
      });
  }, [acceptable, beginCall, beginHandover, dispatch, endCall, scopedRequest]);

  /**
   * The mount and Squad_Scope effect.
   *
   * On mount: exactly one unread-count call, and the poll loop from its settle
   * (Requirements 4.1, 4.6). A re-render changes none of the dependencies, so no
   * further call is issued in consequence of one.
   *
   * On a Squad_Scope change: abandon the previous scope's calls, discard the
   * displayed list and count, and call the list and unread-count endpoints for
   * the new scope (Requirement 7.3).
   */
  useEffect(() => {
    if (authState !== 'authenticated') {
      // 4.9: an ended session stops the loop and makes every outstanding response
      // unacceptable.
      stop();
      return;
    }

    stoppedRef.current = false;

    if (!startedRef.current) {
      startedRef.current = true;
      // 4.1: exactly one unread-count call on mount. The list is not fetched
      // until the panel opens (Requirement 4.7).
      runCountCall();
      return;
    }

    // 7.3: a new scope shows nothing of the old one, and its calls are abandoned.
    abortOutstanding();
    clearPollTimer();
    dispatch({ type: 'scope-changed' });
    runCountCall();
    runListCall();
  }, [
    abortOutstanding,
    authState,
    clearPollTimer,
    dispatch,
    runCountCall,
    runListCall,
    squadScope,
    stop,
  ]);

  // 4.9: leaving the shell cancels the scheduled calls and disregards every
  // response still awaited. `startedRef` is cleared so a remount is a fresh mount
  // with exactly one count call.
  useEffect(() => {
    return () => {
      stop();
      startedRef.current = false;
    };
  }, [stop]);

  /** 4.7: one count call and one list call when the panel opens. */
  const notifyPanelOpened = useCallback((): void => {
    runCountCall();
    runListCall();
  }, [runCountCall, runListCall]);

  const markRead = useCallback(
    (notificationId: string): void => {
      if (stoppedRef.current || stateRef.current.handoverInProgress) {
        return;
      }

      const current = stateRef.current;

      // 6.7: no second concurrent call for the same Notification_Record.
      if (current.markReadPending.includes(notificationId)) {
        return;
      }

      // 6.3: an identity that is not displayed, or is already read, changes
      // nothing and issues no call.
      const record = current.records.find(
        (candidate) => candidate.notificationId === notificationId,
      );
      if (record === undefined || record.readState === 'read') {
        return;
      }

      const generation = current.scopeGeneration;

      // 6.1: applied now, before the request is issued.
      dispatch({ type: 'mark-read-started', notificationId });

      const controller = beginCall();

      // 7.5: the identity is the only value sent — never a squad identity.
      void apiRef.current
        .markRead({ notificationId, signal: controller.signal })
        .then((outcome) => {
          endCall(controller);

          if (!acceptable(generation)) {
            return;
          }

          if (outcome.kind === 'unauthenticated') {
            // 9.6: no rollback — an ended session is not a failed marking.
            beginHandover();
            return;
          }

          if (outcome.kind === 'success') {
            dispatch({ type: 'mark-read-succeeded', notificationId });
          } else {
            // 6.6: restore what was displayed immediately before the activation.
            dispatch({ type: 'mark-read-failed', notificationId });
          }
        });
    },
    [acceptable, beginCall, beginHandover, dispatch, endCall],
  );

  const markAllRead = useCallback((): void => {
    if (stoppedRef.current || stateRef.current.handoverInProgress) {
      return;
    }

    // 6.8: no second concurrent activation.
    if (stateRef.current.markAllPending) {
      return;
    }

    const generation = stateRef.current.scopeGeneration;

    // 6.4: pessimistic — only the progress flag changes until the call resolves.
    dispatch({ type: 'mark-all-started' });

    const controller = beginCall();

    void apiRef.current
      .markAllRead(scopedRequest(controller.signal))
      .then((outcome) => {
        endCall(controller);

        if (!acceptable(generation)) {
          return;
        }

        if (outcome.kind === 'unauthenticated') {
          // 9.6: the progress indication stops with the handover's cleanup, and
          // nothing is rolled back.
          beginHandover();
          return;
        }

        if (outcome.kind === 'success') {
          // 6.5: every displayed record read and the count 0, whatever number the
          // endpoint returned.
          dispatch({ type: 'mark-all-succeeded' });
        } else {
          dispatch({ type: 'mark-all-failed' });
        }
      });
  }, [acceptable, beginCall, beginHandover, dispatch, endCall, scopedRequest]);

  const panelRecords = useMemo(
    () => panelPreviewNotifications(state.records),
    [state.records],
  );

  // 6.9, 14.6: disabled exactly when the count is 0 and every displayed record is
  // read, so unread records outside the capped list stay markable.
  const markAllReadDisabled = useMemo(
    () =>
      state.unreadCount === 0 &&
      state.records.every((record) => record.readState === 'read'),
    [state.records, state.unreadCount],
  );

  return useMemo(
    () => ({
      ...state,
      squadScope,
      panelRecords,
      markAllReadDisabled,
      notifyPanelOpened,
      retryList: runListCall,
      markRead,
      markAllRead,
    }),
    [
      markAllRead,
      markAllReadDisabled,
      markRead,
      notifyPanelOpened,
      panelRecords,
      runListCall,
      squadScope,
      state,
    ],
  );
}
