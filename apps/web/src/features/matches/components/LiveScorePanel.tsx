/**
 * The score of a tracked match while it is in play, on the match page. Every
 * member sees it, re-read every {@link LIVE_SCORE_REFRESH_MS} and marked as not
 * yet final; an organiser also gets the way into the live tracker.
 *
 * The board itself is decorative, so the score is also stated in words, in a
 * polite live region that announces each change.
 */
import { useCallback, useEffect, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { Badge, Scoreboard, buttonClasses } from '../../../ui';

import type { AuthState } from '../../auth';
import type { MatchesApi } from '../api/matchesApi';
import {
  LIVE_LABEL,
  LIVE_SCORE_HEADING,
  LIVE_SCORE_HINT,
  LIVE_SCORE_LOADING_LABEL,
  OPEN_TRACKER_LABEL,
  PROVISIONAL_RESULT_LABEL,
  liveScoreStatement,
} from '../lib/messages';
import type { TeamSheet } from '../lib/parse/teamSheet';
import { useRemote } from '../state/useRemote';
import { FailureNotice, LoadingNotice } from './StatusNotices';

/** How often the panel re-reads the running score. */
export const LIVE_SCORE_REFRESH_MS = 20_000;

export interface LiveScorePanelProps {
  readonly matchId: string;
  readonly sheet: TeamSheet;
  readonly api: Pick<MatchesApi, 'getRunningScore'>;
  readonly authState: AuthState;
  /** The tracker's path, for an organiser; omitted for everyone else. */
  readonly trackerPath?: string;
}

export function LiveScorePanel({ matchId, sheet, api, authState, trackerPath }: LiveScorePanelProps): ReactElement {
  const score = useRemote(
    matchId,
    useCallback((signal: AbortSignal) => api.getRunningScore(matchId, signal), [api, matchId]),
    authState,
  );

  const reload = score.reload;
  useEffect(() => {
    const timer = setInterval(reload, LIVE_SCORE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  const scores = new Map(score.value?.map(({ teamId, score: goals }) => [teamId, goals]));
  const teams = sheet.teams.map(({ teamId, teamName, bibFlag }) => ({
    name: teamName,
    bibFlag,
    score: scores.get(teamId) ?? 0,
  }));
  const [teamA, teamB] = teams;

  return (
    <section className="matches-panel" aria-labelledby="matches-live-score-heading">
      <div className="matches-panel__head">
        <h2 id="matches-live-score-heading" className="matches-subheading">
          {LIVE_SCORE_HEADING}
        </h2>
        <Badge tone="live">{LIVE_LABEL}</Badge>
      </div>
      {(score.phase === 'failed' || score.phase === 'not-found') && score.value === null ? (
        <FailureNotice onRetry={score.reload} />
      ) : score.value === null ? (
        <LoadingNotice label={LIVE_SCORE_LOADING_LABEL} />
      ) : (
        <>
          {teamA !== undefined && teamB !== undefined ? (
            <Scoreboard
              teamA={teamA.name}
              teamB={teamB.name}
              scoreA={teamA.score}
              scoreB={teamB.score}
              bibs={teamA.bibFlag ? 'a' : teamB.bibFlag ? 'b' : null}
              status="provisional"
              showStatus={false}
            />
          ) : null}
          <p className="matches-live-statement" role="status" aria-live="polite">
            <span className="pm-sr">{PROVISIONAL_RESULT_LABEL}: </span>
            {liveScoreStatement(teams)}
          </p>
        </>
      )}
      <p className="matches-hint">{LIVE_SCORE_HINT}</p>
      {trackerPath === undefined ? null : (
        <div className="matches-actions">
          <Link className={buttonClasses({ variant: 'primary' })} to={trackerPath}>
            {OPEN_TRACKER_LABEL}
          </Link>
        </div>
      )}
    </section>
  );
}

export default LiveScorePanel;
