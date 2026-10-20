/**
 * The body of the squad screen's matches section: the squad's matches, each
 * linking to its own screen, and a "Create a match" link for organisers.
 *
 * The squads feature renders the section and its heading; this is injected as
 * its content by the application wiring, and reads the squad from the route.
 */
import { useCallback, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';

import { SQUAD_SCOPE_ROUTE_PARAMETER } from '../../app-shell';
import { useAuth } from '../../auth';
import type { MatchesApi } from '../api/matchesApi';
import { formatDay, headlineDayMs } from '../lib/matchDays';
import { MATCH_STATE_LABELS, isOrganiser } from '../lib/matchState';
import {
  CREATE_MATCH_LABEL,
  MATCHES_LOADING_LABEL,
  MATCHES_TRUNCATED_STATEMENT,
  NO_MATCHES_STATEMENT,
  participantCountLabel,
} from '../lib/messages';
import type { MatchSummary } from '../lib/parse/matchList';
import { matchPath, newMatchPath } from '../lib/routePaths';
import { useRemote } from '../state/useRemote';
import { FailureNotice, LoadingNotice } from './StatusNotices';

import '../styles/matches.css';

export interface MatchesSectionProps {
  readonly api: MatchesApi;
}

function MatchEntry({
  squadId,
  match,
}: {
  readonly squadId: string;
  readonly match: MatchSummary;
}): ReactElement {
  const dayMs = headlineDayMs(match.confirmedDayMs, match.candidateDaysMs);

  return (
    <li className="matches-entry">
      <Link className="matches-entry__link" to={matchPath(squadId, match.matchId)}>
        <span className="matches-entry__location">{match.location}</span>
      </Link>
      <span className="matches-entry__meta">
        <span className="matches-chip">{MATCH_STATE_LABELS[match.state]}</span>
        {dayMs === null ? null : (
          <span>
            <time dateTime={new Date(dayMs).toISOString()}>{formatDay(dayMs)}</time>
          </span>
        )}
        <span>{participantCountLabel(match.participantCount)}</span>
      </span>
    </li>
  );
}

export function MatchesSection({ api }: MatchesSectionProps): ReactElement | null {
  const { state: authState } = useAuth();
  const squadId = useParams()[SQUAD_SCOPE_ROUTE_PARAMETER] ?? null;

  const matches = useRemote(
    squadId,
    useCallback((signal: AbortSignal) => api.listMatches(squadId ?? '', signal), [api, squadId]),
    authState,
  );

  const standing = useRemote(
    squadId,
    useCallback(
      (signal: AbortSignal) => api.getSquadStanding(squadId ?? '', signal),
      [api, squadId],
    ),
    authState,
  );

  if (squadId === null || matches.phase === 'not-found') {
    // The squad screen states a missing squad itself; nothing to add here.
    return null;
  }

  const organiser = isOrganiser(standing.value);
  const createLink = organiser ? (
    <Link className="matches-button matches-button--primary" to={newMatchPath(squadId)}>
      {CREATE_MATCH_LABEL}
    </Link>
  ) : null;

  if (matches.phase === 'failed') {
    return <FailureNotice onRetry={matches.reload}>{createLink}</FailureNotice>;
  }

  if (matches.value === null) {
    return <LoadingNotice label={MATCHES_LOADING_LABEL} />;
  }

  const { matches: entries, truncated } = matches.value;

  return (
    <div className="matches-section">
      {createLink === null ? null : <div className="matches-actions">{createLink}</div>}
      {entries.length === 0 ? (
        <p className="matches-notice">{NO_MATCHES_STATEMENT}</p>
      ) : (
        <ul className="matches-list">
          {entries.map((match) => (
            <MatchEntry key={match.matchId} squadId={squadId} match={match} />
          ))}
        </ul>
      )}
      {truncated ? <p className="matches-notice">{MATCHES_TRUNCATED_STATEMENT}</p> : null}
    </div>
  );
}

export default MatchesSection;
