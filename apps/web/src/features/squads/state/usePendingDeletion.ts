/**
 * The Squads_Home's read of the squads the caller owns that are pending
 * deletion: one `ListMyPendingDeletionSquads` call per mount and per reload,
 * abandoned when superseded, on unmount and on sign-out.
 *
 * Each settled call is stored with the attempt it answered and the phase is
 * derived from that, so a reload shows the list it already holds until the new
 * answer arrives, and an answer to a superseded attempt is never shown.
 */

import { useCallback, useEffect, useState } from 'react';

import type { AuthState } from '../../auth';
import type { CallResult, SquadsApi } from '../api/squadsApi';
import type { PendingDeletionSquad } from '../lib/parse/squadDeletion';

export interface PendingDeletionMachine {
  /** The list, or `null` while none has been read. */
  readonly squads: readonly PendingDeletionSquad[] | null;
  /** Whether the latest read failed. */
  readonly failed: boolean;
  /** Read the list again. */
  readonly reload: () => void;
}

interface Settled {
  readonly attempt: number;
  readonly result: CallResult<readonly PendingDeletionSquad[]>;
}

export function usePendingDeletion(
  api: SquadsApi,
  authState: AuthState,
): PendingDeletionMachine {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [held, setHeld] = useState<readonly PendingDeletionSquad[] | null>(null);

  useEffect(() => {
    if (authState !== 'authenticated') {
      return undefined;
    }

    const controller = new AbortController();

    void api.listPendingDeletion(controller.signal).then((result) => {
      if (controller.signal.aborted) {
        return;
      }
      setSettled({ attempt, result });
      if (result.kind === 'success') {
        setHeld(result.value);
      }
    });

    return () => controller.abort();
  }, [api, attempt, authState]);

  const reload = useCallback(() => setAttempt((current) => current + 1), []);

  const current = settled !== null && settled.attempt === attempt ? settled.result : null;

  return {
    squads: authState === 'authenticated' ? held : null,
    failed: current !== null && current.kind !== 'success',
    reload,
  };
}
