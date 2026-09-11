/**
 * The Sign_Out_Control's waiting logic — and nothing else.
 *
 * Requirement 8.9 is emphatic about what the shell must *not* do: activating the
 * Sign_Out_Control invokes the Auth_Feature's sign-out navigation and performs no
 * session clearing, no token handling, and no post-sign-out navigation of its own.
 * The Auth_Feature already owns all of that (`AuthNavigation.signOut` ends the
 * Session through the `SessionManager` and navigates to the
 * Public_Post_Sign_Out_Route), so this hook receives that function as a value and
 * never reaches for a token, a storage key, or a router (Requirements 15.1, 15.2).
 *
 * What is genuinely the shell's is the **window** around that call:
 *
 * - **Progress and a single flight** (Requirement 8.10). A sign-out is in
 *   progress from the activation until the earlier of the invoked navigation
 *   settling and 10 seconds elapsing. A second activation inside that window is
 *   rejected, so one activation is one sign-out.
 * - **The watchdog** (Requirement 8.11). A sign-out navigation that neither
 *   completes nor fails within {@link SIGN_OUT_WATCHDOG_MS} stops indicating
 *   progress, becomes available for a further activation, and surfaces
 *   {@link SIGN_OUT_FAILED} — while *still* clearing no session and navigating
 *   nowhere. A stuck sign-out is a recoverable state, not a dead control.
 * - **The resting state** (Requirement 8.12). While nothing is in progress the
 *   control is available and carries no progress indication, which here is simply
 *   `pending === false`.
 * - **Cancelling the poll loop on completion** (Requirement 8.13). A completed
 *   sign-out must leave no scheduled unread-count call behind.
 *
 * ### Why the poll loop is cancelled through an injected callback
 *
 * The notification centre's public surface ({@link
 * import('./useNotificationCentre').NotificationCentre}) exposes
 * `notifyPanelOpened`, `retryList`, `markRead`, and `markAllRead` — it has no
 * "stop polling" seam, and its cancellation lives in private refs driven by the
 * Auth_State it reads every render (Requirement 4.9). Rather than reach into
 * those internals or widen the state machine from here, this hook takes an
 * optional `onSignOutComplete` callback and the account menu's wiring passes the
 * cancellation in. That keeps Requirement 8.13 satisfiable without a second
 * component owning the machine's private state, and keeps this hook testable with
 * nothing but two functions.
 *
 * ### A rejected sign-out
 *
 * Requirement 8.11 names only the 10-second case, and the Auth_Feature's sign-out
 * is written to end unauthenticated whatever the backend says, so a rejection is
 * not expected. Should one happen, it is treated the same way as the lapsed
 * watchdog — progress stops, the control returns, {@link SIGN_OUT_FAILED} is
 * surfaced — because the sign-out demonstrably did not complete, and because
 * Requirement 8.12 would otherwise leave the control indicating progress forever.
 * The poll loop is *not* cancelled in that case: the session may well still be
 * live.
 *
 * ### Timers
 *
 * `setTimeout`/`clearTimeout`, deliberately — not `AbortSignal.timeout` — so the
 * watchdog is drivable with `vi.useFakeTimers()`.
 *
 * Requirements: 8.9, 8.10, 8.11, 8.12, 8.13, 15.1, 15.2
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SIGN_OUT_FAILED } from '../lib/messages';

/**
 * How long a sign-out may remain unsettled before the control is handed back
 * (Requirements 8.10, 8.11).
 */
export const SIGN_OUT_WATCHDOG_MS = 10_000;

/** The Sign_Out_Control's state and its one operation. */
export interface SignOutSurface {
  /**
   * Whether a sign-out is in progress: `true` from the activation until the
   * earlier of the invoked navigation settling and {@link SIGN_OUT_WATCHDOG_MS}
   * elapsing (Requirement 8.10). The control indicates progress and refuses
   * activation exactly while this is `true`, and is available without an
   * indication exactly while it is `false` (Requirement 8.12).
   */
  readonly pending: boolean;
  /** Whether the last activation ended without the sign-out completing (Req 8.11). */
  readonly failed: boolean;
  /**
   * {@link SIGN_OUT_FAILED} while {@link failed}, and `null` otherwise — so the
   * Account_Menu renders the message without holding a string of its own.
   */
  readonly failureMessage: string | null;
  /**
   * Activate the Sign_Out_Control. A no-op while {@link pending}
   * (Requirement 8.10). Stable across renders.
   */
  readonly activate: () => void;
}

/**
 * Hold the Sign_Out_Control's pending and failed states around the
 * Auth_Feature's sign-out navigation.
 *
 * @param signOut the Auth_Feature's sign-out navigation, taken from its public
 *   entry point (Requirement 15.1). This hook only calls it.
 * @param onSignOutComplete invoked once when that navigation resolves, for the
 *   caller to cancel the scheduled unread-count calls (Requirement 8.13). It runs
 *   on a completion the watchdog has already abandoned too: the session ended, so
 *   no notification call should follow it.
 *
 * Requirements: 8.9, 8.10, 8.11, 8.12, 8.13, 15.1, 15.2
 */
export function useSignOut(
  signOut: () => Promise<void>,
  onSignOutComplete?: () => void,
): SignOutSurface {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  // Held by reference so a caller re-creating either function on a render neither
  // changes `activate`'s identity nor strands an activation already in flight on a
  // stale closure.
  const signOutRef = useRef(signOut);
  const completeRef = useRef(onSignOutComplete);
  useEffect(() => {
    signOutRef.current = signOut;
    completeRef.current = onSignOutComplete;
  }, [onSignOutComplete, signOut]);

  /**
   * The pending flag as of the last *activation* rather than the last render, so
   * two activations in one tick cannot both get through (Requirement 8.10).
   */
  const pendingRef = useRef(false);
  /**
   * Which activation the state belongs to. A settlement or a watchdog belonging to
   * an abandoned activation may not write `pending` or `failed`, or a late
   * settlement of the first activation would re-enable a control that a second
   * activation is currently using.
   */
  const activationRef = useRef(0);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Guards against a state update after the Account_Menu has unmounted. */
  const mountedRef = useRef(true);

  const clearWatchdog = useCallback((): void => {
    if (watchdogRef.current !== null) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearWatchdog();
    };
  }, [clearWatchdog]);

  const activate = useCallback((): void => {
    // 8.10: a second concurrent activation is rejected outright.
    if (pendingRef.current) {
      return;
    }

    const activation = activationRef.current + 1;
    activationRef.current = activation;
    pendingRef.current = true;
    setPending(true);
    // A further activation starts clean: the previous attempt's message goes.
    setFailed(false);

    /** Settle this activation, if it is still the current one. */
    const settle = (completed: boolean): void => {
      // 8.13: a completed sign-out cancels the scheduled unread-count calls
      // whether or not the watchdog has already handed the control back.
      if (completed) {
        completeRef.current?.();
      }
      if (activationRef.current !== activation) {
        return;
      }
      clearWatchdog();
      pendingRef.current = false;
      if (!mountedRef.current) {
        return;
      }
      setPending(false);
      setFailed(!completed);
    };

    clearWatchdog();
    // 8.11: nothing settled in 10 seconds — stop the indication, hand the control
    // back, say so. No session clearing and no navigation, here or anywhere.
    watchdogRef.current = setTimeout(() => {
      watchdogRef.current = null;
      if (activationRef.current !== activation) {
        return;
      }
      pendingRef.current = false;
      if (!mountedRef.current) {
        return;
      }
      setPending(false);
      setFailed(true);
    }, SIGN_OUT_WATCHDOG_MS);

    // 8.9: the whole of sign-out is the Auth_Feature's. This is the only call.
    let navigation: Promise<void>;
    try {
      navigation = signOutRef.current();
    } catch {
      settle(false);
      return;
    }
    void Promise.resolve(navigation).then(
      () => {
        settle(true);
      },
      () => {
        settle(false);
      },
    );
  }, [clearWatchdog]);

  return useMemo(
    () => ({
      pending,
      failed,
      failureMessage: failed ? SIGN_OUT_FAILED : null,
      activate,
    }),
    [activate, failed, pending],
  );
}

export default useSignOut;
