/**
 * One match's screen, rendered by state.
 *
 * - **Gathering availability:** the caller's own availability form and the
 *   per-day tally against the confirmation threshold.
 * - **Confirmed and later:** the confirmed day and the participants.
 *
 * A route identity that is not an identity issues no request and reads as not
 * found, as does a match whose squad is not the one the route names, so the
 * screen never shows a match under the wrong squad.
 */
import { useCallback, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';

import { SQUAD_SCOPE_ROUTE_PARAMETER, usePublishSquadScopeFromRoute } from '../../app-shell';
import { useAuth } from '../../auth';
import { readUuid } from '../../../wire';
import type { MatchesApi } from '../api/matchesApi';
import { AvailabilityForm } from '../components/AvailabilityForm';
import { AvailabilityTally } from '../components/AvailabilityTally';
import {
  BackToSquadLink,
  FailureNotice,
  LoadingNotice,
  MatchNotFound,
} from '../components/StatusNotices';
import { anyDayAtThreshold, countsByDay } from '../lib/availability';
import { formatDay } from '../lib/matchDays';
import { MATCH_STATE_LABELS, isGatheringAvailability, isOrganiser } from '../lib/matchState';
import {
  AVAILABILITY_CLOSED_STATEMENT,
  CONFIRMED_DAY_LABEL,
  GUEST_LABEL,
  MATCH_LOADING_LABEL,
  MATCH_SCREEN_FALLBACK_HEADING,
  ORGANISER_READY_STATEMENT,
  PARTICIPANTS_HEADING,
  STATE_LABEL,
  TALLY_LOADING_LABEL,
} from '../lib/messages';
import type { MatchDetail } from '../lib/parse/matchDetail';
import { MATCH_ROUTE_PARAMETER } from '../lib/routePaths';
import { useRemote } from '../state/useRemote';

import '../styles/matches.css';

export interface MatchScreenProps {
  readonly api: MatchesApi;
}

function asIdentity(value: string | undefined): string | null {
  const read = readUuid(value, 'route identity');
  return read.ok ? read.value : null;
}

function ParticipantList({ match }: { readonly match: MatchDetail }): ReactElement {
  const participants = [...match.participants].sort(
    (a, b) => a.rosterPosition - b.rosterPosition,
  );

  return (
    <section className="matches-panel" aria-labelledby="matches-participants-heading">
      <h2 id="matches-participants-heading" className="matches-subheading">
        {PARTICIPANTS_HEADING}
      </h2>
      <ul className="matches-people">
        {participants.map((participant) => (
          <li key={participant.membershipId}>
            {participant.displayName}
            {participant.isGuest ? <span className="matches-chip">{GUEST_LABEL}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MatchScreen({ api }: MatchScreenProps): ReactElement {
  const { state: authState } = useAuth();
  usePublishSquadScopeFromRoute();

  const parameters = useParams();
  const squadId = asIdentity(parameters[SQUAD_SCOPE_ROUTE_PARAMETER]);
  const matchId = asIdentity(parameters[MATCH_ROUTE_PARAMETER]);
  const routeSquadId = parameters[SQUAD_SCOPE_ROUTE_PARAMETER] ?? '';

  const detail = useRemote(
    squadId === null ? null : matchId,
    useCallback((signal: AbortSignal) => api.getMatch(matchId ?? '', signal), [api, matchId]),
    authState,
  );

  const match = detail.value;
  const belongs =
    match !== null && squadId !== null && match.squadId.toLowerCase() === squadId.toLowerCase();
  const gathering = belongs && isGatheringAvailability(match.state);

  const tally = useRemote(
    gathering && squadId !== null && matchId !== null ? matchId : null,
    useCallback(
      (signal: AbortSignal) => api.getAvailabilityTally(squadId ?? '', matchId ?? '', signal),
      [api, matchId, squadId],
    ),
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

  const reloadDetail = detail.reload;
  const reloadTally = tally.reload;
  const reloadAfterWrite = useCallback((): void => {
    reloadDetail();
    reloadTally();
  }, [reloadDetail, reloadTally]);

  if (detail.phase === 'not-found' || (match !== null && !belongs)) {
    return (
      <div className="matches-screen">
        <MatchNotFound squadId={routeSquadId} />
      </div>
    );
  }

  if (detail.phase === 'failed') {
    return (
      <div className="matches-screen">
        <h1 className="matches-heading">{MATCH_SCREEN_FALLBACK_HEADING}</h1>
        <FailureNotice onRetry={detail.reload}>
          <BackToSquadLink squadId={routeSquadId} />
        </FailureNotice>
      </div>
    );
  }

  if (match === null || squadId === null || matchId === null) {
    return (
      <div className="matches-screen">
        <h1 className="matches-heading">{MATCH_SCREEN_FALLBACK_HEADING}</h1>
        <LoadingNotice label={MATCH_LOADING_LABEL} />
      </div>
    );
  }

  const organiser = isOrganiser(standing.value);
  const dayCounts = tally.value === null ? [] : countsByDay(match.candidateDaysMs, tally.value);
  const anyDayReady = anyDayAtThreshold(dayCounts, match.minimumPlayerThreshold);

  return (
    <div className="matches-screen">
      <h1 className="matches-heading">{match.location}</h1>

      <dl className="matches-facts">
        <div>
          <dt>{STATE_LABEL}</dt>
          <dd>
            <span className="matches-chip">{MATCH_STATE_LABELS[match.state]}</span>
          </dd>
        </div>
        {match.confirmedDayMs === null ? null : (
          <div>
            <dt>{CONFIRMED_DAY_LABEL}</dt>
            <dd>
              <time dateTime={new Date(match.confirmedDayMs).toISOString()}>
                {formatDay(match.confirmedDayMs)}
              </time>
            </dd>
          </div>
        )}
      </dl>

      {detail.refreshing ? <LoadingNotice label={MATCH_LOADING_LABEL} /> : null}

      {gathering ? (
        <>
          <AvailabilityForm
            key={match.matchId}
            candidateDaysMs={match.candidateDaysMs}
            availability={match.callerAvailability}
            submit={(days, signal) => api.submitAvailability(squadId, matchId, days, signal)}
            clear={(signal) => api.clearAvailability(squadId, matchId, signal)}
            onSettled={reloadAfterWrite}
          />

          {tally.phase === 'failed' ? (
            <FailureNotice onRetry={tally.reload} />
          ) : tally.value === null ? (
            <LoadingNotice label={TALLY_LOADING_LABEL} />
          ) : (
            <AvailabilityTally
              candidateDaysMs={match.candidateDaysMs}
              tally={tally.value}
              threshold={match.minimumPlayerThreshold}
            />
          )}

          {organiser && anyDayReady ? (
            <p className="matches-notice">{ORGANISER_READY_STATEMENT}</p>
          ) : null}
        </>
      ) : (
        <>
          <p className="matches-hint">{AVAILABILITY_CLOSED_STATEMENT}</p>
          {match.participants.length > 0 ? <ParticipantList match={match} /> : null}
        </>
      )}

      <BackToSquadLink squadId={squadId} />
    </div>
  );
}

export default MatchScreen;
