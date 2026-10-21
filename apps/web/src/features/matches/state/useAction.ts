/**
 * One write at a time, with its outcome kept for the screen to state.
 *
 * `run` ignores a second call while one is in flight, which is what stops a
 * double click from submitting twice. The call is abandoned on unmount, and an
 * answer that arrives afterwards is dropped.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { CallResult } from '../api/matchesApi';

export type ActionOutcome<T> = CallResult<T> | { readonly kind: 'unexpected' };

export interface Action<T> {
  readonly busy: boolean;
  /** The last settled outcome, or `null` before the first and after `reset`. */
  readonly outcome: ActionOutcome<T> | null;
  /**
   * Issue the write. Resolves to the outcome, or to `null` when the call was
   * ignored (another in flight) or abandoned (unmounted).
   */
  run(invoke: (signal: AbortSignal) => Promise<CallResult<T>>): Promise<ActionOutcome<T> | null>;
  /** Forget the last outcome. */
  reset(): void;
}

export function useAction<T>(): Action<T> {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionOutcome<T> | null>(null);

  const busyRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const run = useCallback(
    async (
      invoke: (signal: AbortSignal) => Promise<CallResult<T>>,
    ): Promise<ActionOutcome<T> | null> => {
      if (busyRef.current) {
        return null;
      }

      busyRef.current = true;
      setBusy(true);
      setOutcome(null);

      const controller = new AbortController();
      controllerRef.current = controller;

      let settled: ActionOutcome<T>;
      try {
        settled = await invoke(controller.signal);
      } catch {
        settled = { kind: 'unexpected' };
      }

      busyRef.current = false;
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }

      if (!mountedRef.current) {
        return null;
      }

      setBusy(false);
      setOutcome(settled);
      return settled;
    },
    [],
  );

  const reset = useCallback((): void => {
    setOutcome(null);
  }, []);

  return { busy, outcome, run, reset };
}
