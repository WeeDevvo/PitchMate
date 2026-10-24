import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { playerStatsPath } from '../../squads';
import type { CallResult } from '../api/playerStatsApi';
import {
  FORMER_PLAYER_LABEL,
  GENERIC_PROFILE_FAILURE,
  LEADERBOARD_EMPTY_STATEMENT,
  LEADERBOARD_LOADING_LABEL,
  LEADERBOARD_PROVISIONAL_STATEMENT,
  LEADERBOARD_RANK_BY_LABEL,
  RETRY_LABEL,
} from '../lib/messages';
import type { Leaderboard } from '../lib/parse/leaderboard';
import { ANONYMISED_PLACEHOLDER } from '../lib/anonymisedName';
import {
  boardOf,
  renderLeaderboards,
  settle,
  stubLeaderboardApi,
  success,
} from '../testing/squadLeaderboardsHarness';
import { SQUAD_ID, resetTheme } from '../testing/playerStatsScreenStates';

/**
 * The squad leaderboards section: one board at a time, picked by a radio group
 * that opens on the rating board, each entry linking to that player's stats.
 */

afterEach(() => {
  resetTheme();
});

/** The rows of the visible board, as position, name and value text. */
function rows(): string[][] {
  const list = screen.getByRole('list');
  return within(list)
    .getAllByRole('listitem')
    .map((item) =>
      [...item.children].map((cell) => (cell.textContent ?? '').trim()),
    );
}

describe('SquadLeaderboards', () => {
  it('opens on the rating board, in the order sent, with each player linked', async () => {
    const { api, calls } = stubLeaderboardApi(() =>
      success(boardOf('DisplayRating', [1180, 1020, 960])),
    );

    await renderLeaderboards(api);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ squadId: SQUAD_ID, statistic: 'DisplayRating' });
    expect(screen.getByRole('radio', { name: 'Rating' })).toBeChecked();
    expect(screen.getByRole('group', { name: LEADERBOARD_RANK_BY_LABEL })).toBeInTheDocument();
    expect(rows()).toEqual([
      ['1', 'Player 1', '1180'],
      ['2', 'Player 2', '1020'],
      ['3', 'Player 3', '960'],
    ]);
    const board = boardOf('DisplayRating', [1180]);
    expect(screen.getByRole('link', { name: 'Player 1' })).toHaveAttribute(
      'href',
      playerStatsPath(SQUAD_ID, board.entries[0]!.membershipId),
    );
    expect(screen.getByText(LEADERBOARD_PROVISIONAL_STATEMENT)).toBeInTheDocument();
  });

  it('switches board on a pick, issuing one call for that statistic', async () => {
    const { api, calls } = stubLeaderboardApi((statistic) =>
      statistic === 'WinPercentage'
        ? success(boardOf('WinPercentage', [75, 50]))
        : success(boardOf(statistic, [3])),
    );
    const user = userEvent.setup();

    await renderLeaderboards(api);
    await user.click(screen.getByRole('radio', { name: 'Win percentage' }));
    await settle();

    expect(calls.map((call) => call.statistic)).toEqual(['DisplayRating', 'WinPercentage']);
    expect(screen.getByRole('list', { name: 'Win percentage' })).toBeInTheDocument();
    expect(rows()).toEqual([
      ['1', 'Player 1', '75.0%'],
      ['2', 'Player 2', '50.0%'],
    ]);
    expect(screen.queryByText(LEADERBOARD_PROVISIONAL_STATEMENT)).not.toBeInTheDocument();
  });

  it('shows level players at the same position', async () => {
    const { api } = stubLeaderboardApi(() => success(boardOf('DisplayRating', [9, 7, 7, 4])));

    await renderLeaderboards(api);

    expect(rows().map((row) => row[0])).toEqual(['1', '2', '2', '4']);
  });

  it('states an empty board in words', async () => {
    const { api } = stubLeaderboardApi(() => success(boardOf('DisplayRating', [])));

    await renderLeaderboards(api);

    expect(screen.getByText(LEADERBOARD_EMPTY_STATEMENT)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('marks a former player beside their name', async () => {
    const board: Leaderboard = {
      statistic: 'Appearances',
      entries: [{ ...boardOf('Appearances', [4]).entries[0]!, displayName: ANONYMISED_PLACEHOLDER }],
    };
    const { api } = stubLeaderboardApi((statistic) =>
      statistic === 'Appearances' ? success(board) : success(boardOf(statistic, [])),
    );
    const user = userEvent.setup();

    await renderLeaderboards(api);
    await user.click(screen.getByRole('radio', { name: 'Appearances' }));
    await settle();

    expect(screen.getByText(FORMER_PLAYER_LABEL)).toBeInTheDocument();
  });

  it('offers a retry after a failure, and one activation issues one call', async () => {
    const { api, calls } = stubLeaderboardApi((statistic, index) =>
      index === 0 ? { kind: 'transport-failure' } : success(boardOf(statistic, [5])),
    );
    const user = userEvent.setup();

    await renderLeaderboards(api);
    expect(screen.getByText(GENERIC_PROFILE_FAILURE)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: RETRY_LABEL }));
    await settle();

    expect(calls).toHaveLength(2);
    expect(rows()).toEqual([['1', 'Player 1', '5']]);
  });

  it('renders nothing for a squad the caller cannot see', async () => {
    const { api } = stubLeaderboardApi(() => ({ kind: 'not-found' }));

    const { container } = await renderLeaderboards(api);

    expect(container).toBeEmptyDOMElement();
  });

  it('never shows the answer for a board already switched away from', async () => {
    let settleRating: (result: CallResult<Leaderboard>) => void = () => undefined;
    const rating = new Promise<CallResult<Leaderboard>>((resolve) => {
      settleRating = resolve;
    });
    const { api, calls } = stubLeaderboardApi((statistic) =>
      statistic === 'DisplayRating' ? rating : success(boardOf('Appearances', [2])),
    );
    const user = userEvent.setup();

    await renderLeaderboards(api);
    expect(screen.getByText(LEADERBOARD_LOADING_LABEL)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Appearances' }));
    await settle();
    expect(calls[0]!.signal?.aborted).toBe(true);

    await act(async () => {
      settleRating(success(boardOf('DisplayRating', [999])));
      await rating;
    });
    await settle();

    expect(screen.getByRole('list', { name: 'Appearances' })).toBeInTheDocument();
    expect(rows()).toEqual([['1', 'Player 1', '2']]);
  });

  it('issues no call while signed out', async () => {
    const { api, calls } = stubLeaderboardApi(() => success(boardOf('DisplayRating', [1])));

    await renderLeaderboards(api, { authState: 'unauthenticated' });

    expect(calls).toHaveLength(0);
  });

  it('issues no call, and renders nothing, for a malformed squad identity', async () => {
    const { api, calls } = stubLeaderboardApi(() => success(boardOf('DisplayRating', [1])));

    const { container } = await renderLeaderboards(api, { squadId: 'not-a-squad' });

    expect(calls).toHaveLength(0);
    expect(container).toBeEmptyDOMElement();
  });
});
