/**
 * Unit tests for the Sign_Out_Control's waiting logic.
 *
 * The hook's whole job is a window, so the injected sign-out is **hand-settled**
 * here: a deferred promise the test resolves or rejects when it chooses. A
 * transport that settled immediately would collapse the pending window to zero
 * duration and make Requirements 8.10 and 8.11 unobservable.
 *
 * Time moves only where a test moves it (`vi.useFakeTimers()`), following the
 * convention the notification centre and Notifications_Api suites already use, so
 * the 10-second watchdog is asserted without a run waiting out ten real seconds.
 *
 * The menu shape and the DOM-level lifecycle assertions belong to task 12.4 with
 * the Account_Menu; what is pinned here is the state machine underneath it:
 * delegation (8.9), pending and single-flight (8.10), the watchdog (8.11), the
 * resting state (8.12), and poll cancellation on completion (8.13) — plus the
 * standing negative that no navigation is performed by the shell (15.2).
 *
 * Feature: app-shell
 * Requirements: 8.9, 8.10, 8.11, 8.12, 8.13, 15.1, 15.2
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { SIGN_OUT_FAILED } from '../lib/messages';
import { SIGN_OUT_WATCHDOG_MS, useSignOut } from './useSignOut';

// --- Helpers ----------------------------------------------------------------

interface Deferred {
  /** The sign-out navigation handed to the hook. */
  readonly signOut: () => Promise<void>;
  /** How many times the hook invoked it. */
  readonly calls: () => number;
  /** Settle the pending navigation as completed. */
  readonly complete: () => Promise<void>;
  /** Settle the pending navigation as failed. */
  readonly reject: () => Promise<void>;
}

/**
 * A sign-out navigation that never settles on its own.
 *
 * Each invocation is recorded and its resolvers kept, so a test settles exactly
 * when it wants to and can leave one unsettled to reach the watchdog.
 */
function deferredSignOut(): Deferred {
  let callCount = 0;
  let resolveLast: (() => void) | null = null;
  let rejectLast: ((reason: Error) => void) | null = null;

  const signOut = (): Promise<void> => {
    callCount += 1;
    return new Promise<void>((resolve, reject) => {
      resolveLast = resolve;
      rejectLast = reject;
    });
  };

  /** Settle, then let the hook's `.then` handlers and their state updates run. */
  const flush = async (settleIt: () => void): Promise<void> => {
    await act(async () => {
      settleIt();
      await Promise.resolve();
    });
  };

  return {
    signOut,
    calls: () => callCount,
    complete: () =>
      flush(() => {
        resolveLast?.();
      }),
    reject: () =>
      flush(() => {
        rejectLast?.(new Error('sign-out failed'));
      }),
  };
}

/** Advance the faked clock, applying any state update an elapsed timer causes. */
async function advanceClock(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// --- Tests ------------------------------------------------------------------

describe('useSignOut', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Requirement 8.12 — available, no progress indication, nothing said.
  it('rests with no sign-out in progress and no failure', () => {
    const navigation = deferredSignOut();
    const { result } = renderHook(() => useSignOut(navigation.signOut));

    expect(result.current.pending).toBe(false);
    expect(result.current.failed).toBe(false);
    expect(result.current.failureMessage).toBeNull();
    expect(navigation.calls()).toBe(0);
  });

  // Requirement 8.9 — the Auth_Feature's sign-out is invoked, and that is all.
  it('delegates the activation to the injected sign-out navigation', () => {
    const navigation = deferredSignOut();
    const { result } = renderHook(() => useSignOut(navigation.signOut));

    act(() => {
      result.current.activate();
    });

    expect(navigation.calls()).toBe(1);
  });

  // Requirement 8.10 — in progress from the activation.
  it('reports a sign-out in progress while the navigation is unsettled', () => {
    const navigation = deferredSignOut();
    const { result } = renderHook(() => useSignOut(navigation.signOut));

    act(() => {
      result.current.activate();
    });

    expect(result.current.pending).toBe(true);
    expect(result.current.failed).toBe(false);
  });

  // Requirement 8.10 — a second concurrent activation is prevented.
  it('rejects a second activation while a sign-out is in progress', () => {
    const navigation = deferredSignOut();
    const { result } = renderHook(() => useSignOut(navigation.signOut));

    act(() => {
      result.current.activate();
      result.current.activate();
    });
    act(() => {
      result.current.activate();
    });

    expect(navigation.calls()).toBe(1);
    expect(result.current.pending).toBe(true);
  });

  // Requirement 8.10 — pending ends when the navigation settles.
  it('stops indicating progress when the sign-out completes', async () => {
    const navigation = deferredSignOut();
    const { result } = renderHook(() => useSignOut(navigation.signOut));

    act(() => {
      result.current.activate();
    });
    await navigation.complete();

    expect(result.current.pending).toBe(false);
    expect(result.current.failed).toBe(false);
    expect(result.current.failureMessage).toBeNull();
  });

  // Requirement 8.13 — a completed sign-out cancels the scheduled count calls.
  it('cancels the poll loop exactly once when the sign-out completes', async () => {
    const navigation = deferredSignOut();
    const cancelPolling = vi.fn();
    const { result } = renderHook(() =>
      useSignOut(navigation.signOut, cancelPolling),
    );

    act(() => {
      result.current.activate();
    });
    expect(cancelPolling).not.toHaveBeenCalled();

    await navigation.complete();

    expect(cancelPolling).toHaveBeenCalledTimes(1);
  });

  // Requirements 8.11, 15.2 — the watchdog hands the control back and says so.
  it('re-enables the control and surfaces the failure after 10 seconds', async () => {
    const navigation = deferredSignOut();
    const cancelPolling = vi.fn();
    const { result } = renderHook(() =>
      useSignOut(navigation.signOut, cancelPolling),
    );

    act(() => {
      result.current.activate();
    });
    // A moment before the watchdog: still in progress, nothing said.
    await advanceClock(SIGN_OUT_WATCHDOG_MS - 1);
    expect(result.current.pending).toBe(true);
    expect(result.current.failed).toBe(false);

    await advanceClock(1);

    expect(result.current.pending).toBe(false);
    expect(result.current.failed).toBe(true);
    expect(result.current.failureMessage).toBe(SIGN_OUT_FAILED);
    // 8.11: no session clearing and no navigation of the shell's own — the only
    // function the hook may call is the injected sign-out, invoked once, and the
    // poll loop is untouched because the sign-out never completed.
    expect(navigation.calls()).toBe(1);
    expect(cancelPolling).not.toHaveBeenCalled();
  });

  // Requirement 8.11 — available for a further activation after the watchdog.
  it('accepts a further activation after the watchdog has lapsed', async () => {
    const navigation = deferredSignOut();
    const { result } = renderHook(() => useSignOut(navigation.signOut));

    act(() => {
      result.current.activate();
    });
    await advanceClock(SIGN_OUT_WATCHDOG_MS);

    act(() => {
      result.current.activate();
    });

    expect(navigation.calls()).toBe(2);
    expect(result.current.pending).toBe(true);
    // The previous attempt's message goes when a new one starts.
    expect(result.current.failed).toBe(false);
  });

  it('does not report a failure for a sign-out that settles before the watchdog', async () => {
    const navigation = deferredSignOut();
    const { result } = renderHook(() => useSignOut(navigation.signOut));

    act(() => {
      result.current.activate();
    });
    await navigation.complete();
    await advanceClock(SIGN_OUT_WATCHDOG_MS * 2);

    expect(result.current.pending).toBe(false);
    expect(result.current.failed).toBe(false);
  });

  // A rejected navigation is treated as the watchdog case, minus the wait: the
  // sign-out demonstrably did not complete, so the poll loop stands.
  it('hands the control back with the failure message when the navigation rejects', async () => {
    const navigation = deferredSignOut();
    const cancelPolling = vi.fn();
    const { result } = renderHook(() =>
      useSignOut(navigation.signOut, cancelPolling),
    );

    act(() => {
      result.current.activate();
    });
    await navigation.reject();

    expect(result.current.pending).toBe(false);
    expect(result.current.failed).toBe(true);
    expect(result.current.failureMessage).toBe(SIGN_OUT_FAILED);
    expect(cancelPolling).not.toHaveBeenCalled();
  });

  it('keeps a stable activation identity across re-renders', () => {
    const navigation = deferredSignOut();
    const { result, rerender } = renderHook(() =>
      useSignOut(navigation.signOut),
    );
    const first = result.current.activate;

    rerender();

    expect(result.current.activate).toBe(first);
  });

  it('leaves no watchdog behind when the menu unmounts mid-sign-out', async () => {
    const navigation = deferredSignOut();
    const { result, unmount } = renderHook(() => useSignOut(navigation.signOut));

    act(() => {
      result.current.activate();
    });
    unmount();
    await advanceClock(SIGN_OUT_WATCHDOG_MS * 2);

    expect(vi.getTimerCount()).toBe(0);
  });
});
