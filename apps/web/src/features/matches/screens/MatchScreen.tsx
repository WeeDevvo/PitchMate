/**
 * One match's screen, rendered by state.
 *
 * - **Gathering availability:** the caller's own availability form and the
 *   per-day tally against the confirmation threshold; an organiser can confirm
 *   the match on a day that has reached it.
 * - **Confirmed:** the players. An organiser can add guests, remove players, and
 *   roll, adjust and lock the teams.
 * - **Teams locked:** an organiser can still adjust and re-lock the teams.
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
import { ConfirmPanel } from '../components/ConfirmPanel';
import { ParticipantsPanel } from '../components/ParticipantsPanel';
import {
  BackToSquadLink,
  FailureNotice,
  LoadingNotice,
  MatchNotFound,
} from '../components/StatusNotices';
import { TeamsEditor } from '../components/TeamsEditor';
import { countsByDay } from '../lib/availability';
import { formatDay } from '../lib/matchDays';
import { MATCH_STATE_LABELS, isGatheringAvailability, isOrganiser } from '../lib/matchState';
import {
  AVAILABILITY_CLOSED_STATEMENT,
  CONFIRMED_DAY_LABEL,
  MATCH_LOADING_LABEL,
  MATCH_SCREEN_FALLBACK_HEADING,
  STATE_LABEL,
  TALLY_LOADING_LABEL,
} from '../lib/messages';
import { MATCH_ROUTE_PARAMETER } from '../lib/routePaths';
import { participantsEditable, teamsEditable } from '../lib/teams';
import { useRemote } from '../state/useRemote';

import '../styles/matches.css';

export interface MatchScreenProps {
  readonly api: MatchesApi;
}

function asIdentity(value: string | undefined): string | null {
  const read = readUuid(value, 'route identity');
  return read.ok ? read.value : null;
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
  const organiser = isOrganiser(standing.value);

  const editingParticipants = belongs && organiser && participantsEditable(match.state);

  const guests = useRemote(
    editingParticipants ? squadId : null,
    useCallback(
      (signal: AbortSignal) => api.getSquadGuests(squadId ?? '', signal),
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

  const dayCounts = tally.value === null ? [] : countsByDay(match.candidateDaysMs, tally.value);

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
            <>
              <AvailabilityTally
                candidateDaysMs={match.candidateDaysMs}
                tally={tally.value}
                threshold={match.minimumPlayerThreshold}
              />
              {organiser ? (
                <ConfirmPanel
                  dayCounts={dayCounts}
                  threshold={match.minimumPlayerThreshold}
                  confirm={(day, signal) => api.confirmMatch(squadId, matchId, day, signal)}
                  onSettled={reloadAfterWrite}
                />
              ) : null}
            </>
          )}
        </>
      ) : (
        <>
          <p className="matches-hint">{AVAILABILITY_CLOSED_STATEMENT}</p>
          {match.participants.length > 0 || editingParticipants ? (
            <ParticipantsPanel
              participants={match.participants}
              editing={
                editingParticipants
                  ? {
                      guests: guests.phase === 'failed' ? 'failed' : guests.value,
                      addGuest: (membershipId, signal) =>
                        api.addGuest(squadId, matchId, membershipId, signal),
                      remove: (membershipId, signal) =>
                        api.removeParticipant(squadId, matchId, membershipId, signal),
                      onSettled: reloadDetail,
                    }
                  : undefined
              }
            />
          ) : null}
          {organiser && teamsEditable(match.state) ? (
            <TeamsEditor
              // A changed player list re-reads the teams, so a new guest shows
              // up as unassigned straight away.
              key={match.participants.map((p) => p.membershipId).join()}
              api={api}
              matchId={matchId}
              participants={match.participants}
              locked={match.state === 'TeamsRolled'}
              authState={authState}
              onLocked={reloadDetail}
            />
          ) : null}
        </>
      )}

      <BackToSquadLink squadId={squadId} />
    </div>
  );
}

export default MatchScreen;
