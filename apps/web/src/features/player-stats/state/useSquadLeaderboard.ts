/**
 * The load machine of one squad leaderboard: one `GetSquadLeaderboard` call per
 * (squad, statistic, attempt), abandoned when any of the three changes, the
 * component unmounts, or the session ends.
 *
 * Each settled call is stored with the key of the request that made it, and the
 * phase is derived by comparing that key with the current one. An answer to a
 * superseded request (a board the person has already switched away from) is
 * therefore never shown, and switching statistic shows the busy state at once
 * rather than the previous board under the new heading. Nothing is set during
 * the effect itself, only when a call settles.
 *
 * No retry is issued on its own accord: a further call needs a person to
 * activate the retry control (Requirement 2.6).
 */

import { useCallback, useEffect, useState } from 'react';

import type { AuthState } from '../../auth';
import type { CallResult, PlayerStatsApi } from '../api/playerStatsApi';
import type { Leaderboard } from '../lib/parse/leaderboard';
import type { LeaderboardStatistic } from '../lib/wireEnums';

/** Where one leaderboard read stands. */
export type LeaderboardPhase = 'loading' | 'loaded' | 'failed' | 'not-found';

export interface SquadLeaderboardOptions {
  readonly api: PlayerStatsApi;
  readonly squadId: string;
  readonly statistic: LeaderboardStatistic;
  readonly authState: AuthState;
}

export interface SquadLeaderboardMachine {
  readonly phase: LeaderboardPhase;
  /** The board, held only in the `loaded` phase. */
  readonly board: Leaderboard | null;
  /** Issue one further call for the current statistic. */
  readonly retry: () => void;
}

/** One settled call, and the request it answered. */
interface Settled {
  readonly key: string;
  readonly result: CallResult<Leaderboard>;
}

/** The phase a settled result puts the board in. */
export function phaseOf(result: CallResult<Leaderboard>): LeaderboardPhase {
  switch (result.kind) {
    case 'success':
      return 'loaded';
    case 'not-found':
      return 'not-found';
    case 'timeout':
    case 'transport-failure':
    case 'parse-failure':
      return 'failed';
  }
}

export function useSquadLeaderboard({
  api,
  squadId,
  statistic,
  authState,
}: SquadLeaderboardOptions): SquadLeaderboardMachine {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);

  const key = `${squadId}\u0000${statistic}\u0000${String(attempt)}`;

  useEffect(() => {
    // Signed out: issue nothing. The cleanup of the previous run has already
    // abandoned whatever was in flight.
    if (authState !== 'authenticated') {
      return undefined;
    }

    const controller = new AbortController();

    void api.getLeaderboard(squadId, statistic, controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setSettled({ key, result });
      }
    });

    return () => controller.abort();
  }, [api, authState, key, squadId, statistic]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  if (settled === null || settled.key !== key) {
    return { phase: 'loading', board: null, retry };
  }

  const { result } = settled;

  return {
    phase: phaseOf(result),
    board: result.kind === 'success' ? result.value : null,
    retry,
  };
}
