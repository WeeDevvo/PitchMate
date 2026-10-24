/**
 * The export machine: one `ExportSquad` call per activation, handing the parsed
 * document to `onReady` (which saves it as a file), with the same discipline as
 * the membership actions: single-flight, abandoned on unmount or sign-out, and a
 * response for an abandoned call applies nothing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { AuthState } from '../../auth';
import type { SquadsApi } from '../api/squadsApi';
import type { SquadExportFile } from '../lib/parse/squadExport';

/** Where the export stands. */
export type SquadExportPhase = 'idle' | 'pending' | 'saved' | 'failed';

export interface SquadExportOptions {
  readonly api: SquadsApi;
  readonly squadId: string;
  /** Saves the document. Called once per successful activation. */
  readonly onReady: (exported: SquadExportFile) => void;
  readonly authState?: AuthState;
}

export interface SquadExportMachine {
  readonly phase: SquadExportPhase;
  /** Issue one export call, unless one is already in flight or the session ended. */
  readonly run: () => void;
}

export function useSquadExport({
  api,
  squadId,
  onReady,
  authState = 'authenticated',
}: SquadExportOptions): SquadExportMachine {
  const [phase, setPhase] = useState<SquadExportPhase>('idle');
  const controllerRef = useRef<AbortController | null>(null);
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  const abandon = useCallback((): void => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  // Sign-out abandons a call in flight; so does leaving the screen.
  useEffect(() => {
    if (authState !== 'authenticated') {
      abandon();
    }
  }, [abandon, authState]);

  useEffect(() => abandon, [abandon]);

  const run = useCallback((): void => {
    if (controllerRef.current !== null || authState !== 'authenticated') {
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setPhase('pending');

    void api.exportSquad(squadId, controller.signal).then(
      (result) => {
        if (controllerRef.current !== controller) {
          return;
        }
        controllerRef.current = null;

        if (result.kind === 'success') {
          onReadyRef.current(result.value);
          setPhase('saved');
        } else {
          setPhase('failed');
        }
      },
      () => {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          setPhase('failed');
        }
      },
    );
  }, [api, authState, squadId]);

  return { phase, run };
}
