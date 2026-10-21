/**
 * The body of the squad screen's "Stats and leaderboards" section: the squad's
 * leaderboards, one statistic at a time, each entry linking to that player's
 * stats.
 *
 * The squads feature renders the section and its heading; the application
 * wiring injects this as the section's content, and it reads the squad from the
 * route, as the matches section does.
 *
 * - **One board at a time.** A radio group picks the statistic, Display_Rating
 *   first. Each pick issues one `GetSquadLeaderboard` call; an answer for a
 *   board already switched away from is never shown (`useSquadLeaderboard`).
 * - **The backend's order, the client's positions.** Entries keep the order they
 *   arrived in. Level values share a position ("1, 2, 2, 4"), computed by
 *   `competitionPositions` without re-sorting.
 * - **No rating arithmetic.** A Display_Rating arrives as a finished figure, and
 *   provisional players are absent from that board, which one statement says.
 * - **A hidden squad is the squad screen's to state.** On `not-found` this
 *   renders nothing, because the screen around it already shows its own
 *   not-found treatment.
 */

import { useId, useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';

import { SQUAD_SCOPE_ROUTE_PARAMETER } from '../../app-shell';
import { useAuth } from '../../auth';
import { playerStatsPath } from '../../squads';
import type { PlayerStatsApi } from '../api/playerStatsApi';
import { FailureNotice } from '../components/FailureNotice';
import { LoadingIndication } from '../components/LoadingIndication';
import { isAnonymisedPlaceholder } from '../lib/anonymisedName';
import { isPlayerStatsIdentifier } from '../lib/identifiers';
import {
  LEADERBOARD_STATISTIC_LABELS,
  LEADERBOARD_STATISTIC_ORDER,
  competitionPositions,
  formatLeaderboardValue,
} from '../lib/leaderboardFormat';
import {
  FORMER_PLAYER_LABEL,
  LEADERBOARD_EMPTY_STATEMENT,
  LEADERBOARD_LOADING_LABEL,
  LEADERBOARD_PROVISIONAL_STATEMENT,
  LEADERBOARD_RANK_BY_LABEL,
} from '../lib/messages';
import type { Leaderboard } from '../lib/parse/leaderboard';
import type { LeaderboardStatistic } from '../lib/wireEnums';
import { useSquadLeaderboard } from '../state/useSquadLeaderboard';

import '../styles/playerStatsTokens.css';
import '../components/surfaces.css';
import './SquadLeaderboards.css';

export interface SquadLeaderboardsProps {
  readonly api: PlayerStatsApi;
}

/** The statistic every board opens on. */
const DEFAULT_STATISTIC: LeaderboardStatistic = 'DisplayRating';

/** The ranked list of one loaded board. */
function BoardList({
  squadId,
  board,
}: {
  readonly squadId: string;
  readonly board: Leaderboard;
}): ReactElement {
  if (board.entries.length === 0) {
    return <p className="player-stats-leaderboard__statement">{LEADERBOARD_EMPTY_STATEMENT}</p>;
  }

  const positions = competitionPositions(board.entries.map((entry) => entry.value));

  return (
    <ol
      className="player-stats-leaderboard__list"
      aria-label={LEADERBOARD_STATISTIC_LABELS[board.statistic]}
      data-player-stats-leaderboard-list="true"
    >
      {board.entries.map((entry, index) => (
        <li key={entry.membershipId} className="player-stats-leaderboard__entry">
          <span className="player-stats-leaderboard__position">{positions[index]}</span>
          <span className="player-stats-leaderboard__name">
            <Link
              className="player-stats-leaderboard__link"
              to={playerStatsPath(squadId, entry.membershipId)}
            >
              {entry.displayName}
            </Link>
            {isAnonymisedPlaceholder(entry.displayName) ? (
              <span className="player-stats-leaderboard__former-player">
                {FORMER_PLAYER_LABEL}
              </span>
            ) : null}
          </span>
          <span className="player-stats-leaderboard__value">
            {formatLeaderboardValue(board.statistic, entry.value)}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The switcher and the current board, for a squad already read off the route. */
function SquadLeaderboardsBody({
  api,
  squadId,
}: {
  readonly api: PlayerStatsApi;
  readonly squadId: string;
}): ReactElement | null {
  const { state: authState } = useAuth();
  const [statistic, setStatistic] = useState<LeaderboardStatistic>(DEFAULT_STATISTIC);
  const groupName = useId();
  const machine = useSquadLeaderboard({ api, squadId, statistic, authState });

  if (machine.phase === 'not-found') {
    return null;
  }

  let body: ReactElement;

  if (machine.phase === 'failed') {
    body = <FailureNotice onRetry={machine.retry} />;
  } else if (machine.board === null) {
    body = <LoadingIndication label={LEADERBOARD_LOADING_LABEL} />;
  } else {
    body = (
      <>
        <BoardList squadId={squadId} board={machine.board} />
        {machine.board.statistic === 'DisplayRating' ? (
          <p className="player-stats-leaderboard__statement">
            {LEADERBOARD_PROVISIONAL_STATEMENT}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <div className="player-stats-leaderboard" data-player-stats-leaderboard="true">
      <fieldset className="player-stats-leaderboard__switcher">
        <legend className="player-stats-leaderboard__legend">{LEADERBOARD_RANK_BY_LABEL}</legend>
        <div className="player-stats-leaderboard__options">
          {LEADERBOARD_STATISTIC_ORDER.map((option) => (
            <label key={option} className="player-stats-leaderboard__option">
              <input
                type="radio"
                className="player-stats-leaderboard__radio"
                name={groupName}
                value={option}
                checked={option === statistic}
                onChange={() => setStatistic(option)}
              />
              <span>{LEADERBOARD_STATISTIC_LABELS[option]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {body}
    </div>
  );
}

export function SquadLeaderboards({ api }: SquadLeaderboardsProps): ReactElement | null {
  const squadId = useParams()[SQUAD_SCOPE_ROUTE_PARAMETER] ?? null;

  if (squadId === null || !isPlayerStatsIdentifier(squadId)) {
    // The squad screen states a missing or malformed squad itself.
    return null;
  }

  return <SquadLeaderboardsBody key={squadId} api={api} squadId={squadId} />;
}

export default SquadLeaderboards;
