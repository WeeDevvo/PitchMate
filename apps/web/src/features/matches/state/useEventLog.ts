/**
 * The live tracker's session log, and its trip to the server.
 *
 * `record` adds an event as pending and sends every pending event as one batch.
 * One batch is in flight at a time; events recorded meanwhile go in the next.
 * When a batch lands, the running score is read again and the log and score
 * change together, so the score shown never counts a goal twice or drops one.
 *
 * A batch that does not get through (no signal, a timeout) leaves its events
 * pending and the log `unsynced`; `retry`, or the next `record`, resends them
 * with the same identities, which the server dedupes. A batch the server turns
 * away whole, because the match is no longer in play or the caller may no
 * longer track it, halts the log and reports it, so the screen can re-read the
 * match.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { CallResult, MatchesApi } from '../api/matchesApi';
import { appendEvent, pendingEvents, settleEvents, type LoggedEvent, type TrackedEvent } from '../lib/liveTracking';
import type { TeamScore } from '../lib/parse/matchDetail';

export type SyncState = 'synced' | 'syncing' | 'unsynced';

export interface EventLog {
  readonly log: readonly LoggedEvent[];
  /** The server's running score, or `null` until it is first read. */
  readonly serverScores: readonly TeamScore[] | null;
  readonly sync: SyncState;
  /** True once the server turned a batch away whole; nothing more is sent. */
  readonly halted: boolean;
  record(event: TrackedEvent): void;
  retry(): void;
}

export interface EventLogOptions {
  readonly matchId: string;
  readonly api: Pick<MatchesApi, 'recordEvents' | 'getRunningScore'>;
  /** Called once when a batch is turned away whole. */
  readonly onHalted: () => void;
}

function isUndelivered(result: CallResult<unknown>): boolean {
  return result.kind === 'timeout' || result.kind === 'transport-failure';
}

export function useEventLog({ matchId, api, onHalted }: EventLogOptions): EventLog {
  const [log, setLog] = useState<readonly LoggedEvent[]>([]);
  const [serverScores, setServerScores] = useState<readonly TeamScore[] | null>(null);
  const [sync, setSync] = useState<SyncState>('synced');
  const [halted, setHalted] = useState(false);

  // The sender's copy of the log: every change is written here first, then rendered.
  const logRef = useRef<readonly LoggedEvent[]>([]);
  const sendingRef = useRef(false);
  const haltedRef = useRef(false);
  const mountedRef = useRef(true);
  const onHaltedRef = useRef(onHalted);

  useEffect(() => {
    onHaltedRef.current = onHalted;
  }, [onHalted]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    void api.getRunningScore(matchId).then((read) => {
      if (current && read.kind === 'success') setServerScores(read.value);
    });
    return () => {
      current = false;
    };
  }, [api, matchId]);

  const commit = useCallback((next: readonly LoggedEvent[]): void => {
    logRef.current = next;
    setLog(next);
  }, []);

  const send = useCallback(async (): Promise<void> => {
    if (sendingRef.current || haltedRef.current) return;
    sendingRef.current = true;

    try {
      for (;;) {
        const batch = pendingEvents(logRef.current);
        if (batch.length === 0) {
          setSync('synced');
          return;
        }

        setSync('syncing');
        const result = await api.recordEvents(matchId, batch);
        if (!mountedRef.current) return;

        if (result.kind !== 'success') {
          setSync('unsynced');
          if (!isUndelivered(result)) {
            haltedRef.current = true;
            setHalted(true);
            onHaltedRef.current();
          }
          return;
        }

        const score = await api.getRunningScore(matchId);
        if (!mountedRef.current) return;

        const settled = settleEvents(logRef.current, result.value);
        commit(settled);
        if (score.kind === 'success') setServerScores(score.value);

        // A batch the server answered without settling any of its events would
        // only be sent again unchanged, so it waits for a retry instead.
        const stillPending = new Set(pendingEvents(settled).map(({ eventId }) => eventId));
        if (batch.every(({ eventId }) => stillPending.has(eventId))) {
          setSync('unsynced');
          return;
        }
      }
    } finally {
      sendingRef.current = false;
    }
  }, [api, matchId, commit]);

  const record = useCallback(
    (event: TrackedEvent): void => {
      if (haltedRef.current) return;
      commit(appendEvent(logRef.current, event));
      void send();
    },
    [commit, send],
  );

  const retry = useCallback((): void => {
    void send();
  }, [send]);

  return { log, serverScores, sync, halted, record, retry };
}
