/**
 * The load machine behind every Matches_Feature read.
 *
 * - One call per key: a changed key abandons the call in flight and issues a new
 *   one, and an answer for any other key is never rendered.
 * - A reload keeps the last value on screen and reports `refreshing` beside it,
 *   so re-reading after a save never blanks the screen.
 * - A `null` key issues nothing and reads as not found, which is how a route
 *   identity that is not an identity is handled without a request.
 * - No call is issued without a session, and nothing is shown without one.
 * - Unmounting abandons the call in flight.
 *
 * The phase is derived during render from the last settled answer, the key and
 * the reload generation, so state is only ever set when a call settles.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AuthState } from '../../auth';
import type { CallResult } from '../api/matchesApi';

export type RemotePhase = 'idle' | 'loading' | 'loaded' | 'not-found' | 'failed';

export interface Remote<T> {
  readonly phase: RemotePhase;
  /** The last accepted value, kept through a refresh. */
  readonly value: T | null;
  /** True while a re-read of an already loaded value is in flight. */
  readonly refreshing: boolean;
  /** Re-read, keeping the current value on screen meanwhile. */
  reload(): void;
}

interface Settled<T> {
  readonly key: string;
  readonly generation: number;
  readonly phase: 'loaded' | 'not-found' | 'failed';
  readonly value: T | null;
}

export function useRemote<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<CallResult<T>>,
  authState: AuthState = 'authenticated',
): Remote<T> {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [generation, setGeneration] = useState(0);

  // Read through a ref so a new closure each render does not re-issue the call;
  // only the key, a reload, or the session does.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    if (authState !== 'authenticated' || key === null) {
      return;
    }

    const controller = new AbortController();
    let current = true;

    const settle = (result: CallResult<T> | null): void => {
      if (!current) {
        return;
      }

      if (result !== null && result.kind === 'success') {
        setSettled({ key, generation, phase: 'loaded', value: result.value });
      } else if (result !== null && result.kind === 'not-found') {
        setSettled({ key, generation, phase: 'not-found', value: null });
      } else {
        setSettled({ key, generation, phase: 'failed', value: null });
      }
    };

    void loadRef.current(controller.signal).then(settle, () => {
      settle(null);
    });

    return () => {
      current = false;
      controller.abort();
    };
  }, [authState, generation, key]);

  const reload = useCallback((): void => {
    setGeneration((value) => value + 1);
  }, []);

  if (authState !== 'authenticated') {
    return { phase: 'idle', value: null, refreshing: false, reload };
  }

  if (key === null) {
    return { phase: 'not-found', value: null, refreshing: false, reload };
  }

  if (settled === null || settled.key !== key) {
    return { phase: 'loading', value: null, refreshing: false, reload };
  }

  if (settled.generation !== generation) {
    // A reload is in flight: keep a loaded value on screen, otherwise load anew.
    return settled.value === null
      ? { phase: 'loading', value: null, refreshing: false, reload }
      : { phase: 'loaded', value: settled.value, refreshing: true, reload };
  }

  return { phase: settled.phase, value: settled.value, refreshing: false, reload };
}
