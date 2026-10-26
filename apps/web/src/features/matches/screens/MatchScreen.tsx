/**
 * One match's screen, rendered by state.
 *
 * - **Gathering availability:** the caller's own availability form and how
 *   many can make each day, as a guide. An organiser also marks the days each
 *   guest can play, and can confirm the match on any day; everyone marked for
 *   it becomes a player.
 * - **Confirmed:** the players. A member can join or leave; an organiser can
 *   add any member or guest, remove players, and roll, adjust and lock the
 *   teams.
 * - **Teams locked and later:** everyone sees the team sheet; until the match
 *   starts, an organiser can still adjust and re-lock the teams, then start it.
 * - **In progress:** an organiser records the score, correcting it as needed,
 *   then completes the match, which applies the rating update. Everyone sees
 *   the score, marked as not yet final until completion.
 * - **Completed:** everyone sees the final score beside the team sheet.
 * - **Cancelled:** a statement that it was cancelled, and nothing to change.
 *
 * Until it starts, an organiser can cancel the match.
 *
 * A route identity that is not an identity issues no request and reads as not
 * found, as does a match whose squad is not the one the route names, so the
 * screen never shows a match under the wrong squad.
 */
import { useCallback, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { MatchStateChip } from '../../../ui';
import { DESIGN_STATES } from '../components/designStates';

import { SQUAD_SCOPE_ROUTE_PARAMETER, usePublishSquadScopeFromRoute } from '../../app-shell';
import { useAuth } from '../../auth';
import { readUuid } from '../../../wire';
import type { MatchesApi } from '../api/matchesApi';
import { AvailabilityForm } from '../components/AvailabilityForm';
import { AvailabilityTally } from '../components/AvailabilityTally';
import { CompletePanel } from '../components/CompletePanel';
import { ConfirmPanel } from '../components/ConfirmPanel';
import { GuestAvailabilityPanel } from '../components/GuestAvailabilityPanel';
import { MatchActionsPanel } from '../components/MatchActionsPanel';
import { ParticipantsPanel } from '../components/ParticipantsPanel';
import { ResultForm } from '../components/ResultForm';
import { ResultSummary } from '../components/ResultSummary';
import {
  BackToSquadLink,
  FailureNotice,
  LoadingNotice,
  MatchNotFound,
} from '../components/StatusNotices';
import { TeamSheetView } from '../components/TeamSheetView';
import { TeamsEditor } from '../components/TeamsEditor';
import { countsByDay } from '../lib/availability';
import { canRecordResult } from '../lib/lifecycle';
import { formatDay } from '../lib/matchDays';
import { MATCH_STATE_LABELS, isGatheringAvailability, isOrganiser } from '../lib/matchState';
import {
  AVAILABILITY_CLOSED_STATEMENT,
  CONFIRMED_DAY_LABEL,
  MATCH_CANCELLED_STATEMENT,
  MATCH_LOADING_LABEL,
  MATCH_SCREEN_FALLBACK_HEADING,
  STATE_LABEL,
  TALLY_LOADING_LABEL,
  TEAM_SHEET_LOADING_LABEL,
} from '../lib/messages';
import { MATCH_ROUTE_PARAMETER } from '../lib/routePaths';
import { guestsOf } from '../lib/parse/teams';
import { hasTeamSheet, participantsEditable, teamsEditable } from '../lib/teams';
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

  // Any active member can put themselves in or take themselves out of a confirmed match.
  const playsThemselves = belongs && participantsEditable(match.state) && standing.value?.state === 'Active';

  // An organiser needs the squad's players to mark guests' availability, and later to add anyone.
  const players = useRemote(
    editingParticipants || (gathering && organiser) ? squadId : null,
    useCallback(
      (signal: AbortSignal) => api.getSquadPlayers(squadId ?? '', signal),
      [api, squadId],
    ),
    authState,
  );

  const sheetReadable = belongs && hasTeamSheet(match.state);

  const sheet = useRemote(
    sheetReadable ? matchId : null,
    useCallback((signal: AbortSignal) => api.getTeamSheet(matchId ?? '', signal), [api, matchId]),
    authState,
  );

  const reloadDetail = detail.reload;
  const reloadTally = tally.reload;
  const reloadSheet = sheet.reload;
  const reloadAfterLock = useCallback((): void => {
    reloadDetail();
    reloadSheet();
  }, [reloadDetail, reloadSheet]);
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
            <MatchStateChip state={DESIGN_STATES[match.state]} label={MATCH_STATE_LABELS[match.state]} />
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

      {match.state === 'Cancelled' ? (
        <p className="matches-notice" role="status">
          {MATCH_CANCELLED_STATEMENT}
        </p>
      ) : null}

      {match.recordedResult !== null && sheet.value !== null ? (
        <ResultSummary
          sheet={sheet.value}
          result={match.recordedResult}
          completedAtMs={match.completedAtMs}
        />
      ) : null}

      {organiser && canRecordResult(match.state) && sheet.value !== null ? (
        <>
          <ResultForm
            sheet={sheet.value}
            recordedResult={match.recordedResult}
            record={(teamScores, signal) => api.recordResult(matchId, teamScores, signal)}
            onSettled={reloadDetail}
          />
          <CompletePanel
            state={match.state}
            recordedResult={match.recordedResult}
            complete={(signal) => api.completeMatch(matchId, signal)}
            onSettled={reloadDetail}
          />
        </>
      ) : null}

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

          {organiser ? (
            <GuestAvailabilityPanel
              key={`guests-${match.matchId}`}
              candidateDaysMs={match.candidateDaysMs}
              guests={
                players.phase === 'failed' ? 'failed' : players.value === null ? null : guestsOf(players.value)
              }
              marked={match.guestAvailability}
              submit={(guestId, days, signal) =>
                api.setGuestAvailability(squadId, matchId, guestId, days, signal)
              }
              clear={(guestId, signal) => api.clearGuestAvailability(squadId, matchId, guestId, signal)}
              onSettled={reloadAfterWrite}
            />
          ) : null}

          {tally.phase === 'failed' ? (
            <FailureNotice onRetry={tally.reload} />
          ) : tally.value === null ? (
            <LoadingNotice label={TALLY_LOADING_LABEL} />
          ) : (
            <>
              <AvailabilityTally
                candidateDaysMs={match.candidateDaysMs}
                tally={tally.value}
              />
              {organiser ? (
                <ConfirmPanel
                  dayCounts={dayCounts}
                  confirm={(day, signal) => api.confirmMatch(squadId, matchId, day, signal)}
                  onSettled={reloadAfterWrite}
                />
              ) : null}
            </>
          )}
        </>
      ) : (
        <>
          {match.state === 'Cancelled' ? null : (
            <p className="matches-hint">{AVAILABILITY_CLOSED_STATEMENT}</p>
          )}
          {sheetReadable ? (
            sheet.phase === 'failed' ? (
              <FailureNotice onRetry={sheet.reload} />
            ) : sheet.value === null ? (
              <LoadingNotice label={TEAM_SHEET_LOADING_LABEL} />
            ) : (
              <TeamSheetView squadId={squadId} sheet={sheet.value} />
            )
          ) : match.state === 'Cancelled' ? null : match.participants.length > 0 ||
            editingParticipants ||
            playsThemselves ? (
            <ParticipantsPanel
              participants={match.participants}
              self={
                playsThemselves
                  ? {
                      isParticipant: match.callerIsParticipant,
                      join: (signal) => api.joinMatch(squadId, matchId, signal),
                      leave: (signal) => api.leaveMatch(squadId, matchId, signal),
                      onSettled: reloadDetail,
                    }
                  : undefined
              }
              editing={
                editingParticipants
                  ? {
                      players: players.phase === 'failed' ? 'failed' : players.value,
                      addParticipant: (membershipId, signal) =>
                        api.addParticipant(squadId, matchId, membershipId, signal),
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
              // A changed player list re-reads the teams, so someone new shows
              // up as unassigned straight away.
              key={match.participants.map((p) => p.membershipId).join()}
              api={api}
              matchId={matchId}
              participants={match.participants}
              locked={match.state === 'TeamsRolled'}
              authState={authState}
              onLocked={reloadAfterLock}
            />
          ) : null}
        </>
      )}

      {organiser ? (
        <MatchActionsPanel
          state={match.state}
          sheet={sheet.value}
          getWorkingTeams={(signal) => api.getWorkingTeams(matchId, signal)}
          start={(signal) => api.startMatch(matchId, signal)}
          cancel={(signal) => api.cancelMatch(matchId, signal)}
          onSettled={reloadAfterLock}
        />
      ) : null}

      <BackToSquadLink squadId={squadId} />
    </div>
  );
}

export default MatchScreen;
