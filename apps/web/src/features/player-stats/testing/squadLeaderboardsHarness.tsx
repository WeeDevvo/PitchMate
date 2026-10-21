/**
 * Test harness for the squad leaderboards section: a stub facade answering per
 * statistic, sample boards, and a mount at the real squad route inside a real
 * router and AuthProvider. Imported only by tests.
 */

import { act, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AuthProvider, type AuthState } from '../../auth';
import { SQUAD_ROUTE, squadPath } from '../../squads';
import type { CallResult, PlayerStatsApi } from '../api/playerStatsApi';
import type { Leaderboard } from '../lib/parse/leaderboard';
import type { LeaderboardStatistic } from '../lib/wireEnums';
import { SquadLeaderboards } from '../screens/SquadLeaderboards';
import { SQUAD_ID, sessionManagerReporting } from './playerStatsScreenStates';
import { wireIdentityForIndex } from './playerProfileFixtures';

/** One answer of the stub: settled, or a promise the test settles itself. */
export type LeaderboardOutcome =
  | CallResult<Leaderboard>
  | Promise<CallResult<Leaderboard>>;

/** Every `getLeaderboard` call the stub received. */
export interface LeaderboardCall {
  readonly squadId: string;
  readonly statistic: LeaderboardStatistic;
  readonly signal: AbortSignal | undefined;
}

/**
 * A facade whose `getLeaderboard` answers from `answer` and records each call.
 * The profile method is never reached by the section.
 */
export function stubLeaderboardApi(
  answer: (statistic: LeaderboardStatistic, callIndex: number) => LeaderboardOutcome,
): { readonly api: PlayerStatsApi; readonly calls: LeaderboardCall[] } {
  const calls: LeaderboardCall[] = [];

  const api: PlayerStatsApi = {
    getPlayerProfile() {
      return new Promise(() => undefined);
    },
    getLeaderboard(squadId, statistic, signal) {
      const index = calls.length;
      calls.push({ squadId, statistic, signal });
      return Promise.resolve(answer(statistic, index));
    },
  };

  return { api, calls };
}

/** A board with one entry per value, in the order given, named Player 1, 2… */
export function boardOf(
  statistic: LeaderboardStatistic,
  values: readonly number[],
): Leaderboard {
  return {
    statistic,
    entries: values.map((value, index) => ({
      membershipId: wireIdentityForIndex(index + 1),
      displayName: `Player ${String(index + 1)}`,
      value,
    })),
  };
}

/** A successful answer carrying `board`. */
export function success(board: Leaderboard): CallResult<Leaderboard> {
  return { kind: 'success', value: board };
}

/** The section at the real squad route, as the squad screen hosts it. */
function tree(api: PlayerStatsApi, authState: AuthState, squadId: string): ReactElement {
  return (
    <AuthProvider manager={sessionManagerReporting(authState)}>
      <MemoryRouter initialEntries={[squadPath(squadId)]}>
        <Routes>
          <Route path={SQUAD_ROUTE} element={<SquadLeaderboards api={api} />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

/** Let effects issue their calls and settled answers commit. */
export async function settle(): Promise<void> {
  for (let round = 0; round < 2; round += 1) {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }
}

/** Mount the section for `squadId` and let it settle. */
export async function renderLeaderboards(
  api: PlayerStatsApi,
  { authState = 'authenticated', squadId = SQUAD_ID }: {
    readonly authState?: AuthState;
    readonly squadId?: string;
  } = {},
): Promise<ReturnType<typeof render>> {
  const rendered = render(tree(api, authState, squadId));
  await settle();
  return rendered;
}
