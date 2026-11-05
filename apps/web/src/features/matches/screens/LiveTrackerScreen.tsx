/**
 * The live tracker: an organiser records a match in play from the touchline.
 *
 * The score and clock read at arm's length, GOAL sits at the bottom in thumb
 * reach, and every choice after it is one tap on a big target: the team, then
 * the scorer (or skip, or an own goal). A logged goal can be undone straight
 * away; the keeper for either team can be changed at any minute; the timeline
 * lists everything logged and fixes any of it (a goal's scorer changed or the
 * goal removed, a keeper change removed) with a correction, never an edit; and
 * ending the match makes the tracked score final and completes it.
 *
 * Every event is minted with its own GUID v7 identity and sent at once. The
 * score moves the moment a goal is tapped, a send that does not get through is
 * kept and can be sent again, and the connection's state is always shown in a
 * word and an icon. The tracker starts from the server's event log, so a
 * reload still shows who is in goal and can undo a goal logged before it; only
 * an event not yet sent is lost to a reload, as nothing is stored on the device.
 *
 * Only an organiser of a squad with live tracking on, for a match in play, gets
 * the tracker; anyone else is told why and pointed back to the match. A match
 * whose kickoff time was never recorded runs its clock from when the tracker
 * opened.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { Badge, Banner, Button, Scoreboard, Toast, buttonClasses } from '../../../ui';

import { SQUAD_SCOPE_ROUTE_PARAMETER, usePublishSquadScopeFromRoute } from '../../app-shell';
import { useAuth } from '../../auth';
import { readUuid } from '../../../wire';
import type { MatchesApi } from '../api/matchesApi';
import { EndMatchDialog } from '../components/EndMatchDialog';
import { GoalPicker, type GoalPick } from '../components/GoalPicker';
import { KeeperDialog } from '../components/KeeperDialog';
import { TrackerTimeline } from '../components/TrackerTimeline';
import { FailureNotice, LoadingNotice, MatchNotFound } from '../components/StatusNotices';
import { EVENT_ID_RANDOM_BYTES, eventIdFrom } from '../lib/eventIds';
import {
  clockText,
  currentKeepers,
  displayedScores,
  goalCorrection,
  lastStandingGoal,
  matchMinute,
  pendingEvents,
  type GoalEvent,
  type KeeperEvent,
  type LoggedEvent,
} from '../lib/liveTracking';
import { isOrganiser } from '../lib/matchState';
import {
  BACK_TO_MATCH_LABEL,
  CLOCK_FALLBACK_NOTE,
  CLOCK_LABEL,
  END_MATCH_LABEL,
  EVENT_REJECTED_STATEMENT,
  GOAL_LABEL,
  GOAL_REMOVED_STATEMENT,
  GOAL_UNDONE_STATEMENT,
  KEEPER_LABEL,
  KEEPER_REMOVED_STATEMENT,
  LIVE_LABEL,
  SEND_AGAIN_LABEL,
  SYNC_LABELS,
  TIMELINE_LABEL,
  TRACKER_HALTED_STATEMENT,
  TRACKER_HEADING,
  TRACKER_LOADING_LABEL,
  TRACKER_NOT_IN_PLAY_STATEMENT,
  TRACKER_NOT_ORGANISER_STATEMENT,
  TRACKER_OFF_STATEMENT,
  UNDO_GOAL_LABEL,
  UNDO_LABEL,
  changeScorerHeading,
  goalCorrectedStatement,
  goalLoggedStatement,
  keeperLine,
  keeperLoggedStatement,
  liveScoreStatement,
  scoreText,
  unsyncedStatement,
} from '../lib/messages';
import type { TeamSheet } from '../lib/parse/teamSheet';
import { MATCH_ROUTE_PARAMETER, matchPath } from '../lib/routePaths';
import { useEventLog, type SyncState } from '../state/useEventLog';
import { useNow } from '../state/useNow';
import { useRemote } from '../state/useRemote';

import '../styles/matches.css';

/** How long a logged goal can be undone from its toast. */
export const UNDO_WINDOW_MS = 10_000;

const CLOCK_TICK_MS = 1_000;

export interface LiveTrackerScreenProps {
  readonly api: MatchesApi;
}

function asIdentity(value: string | undefined): string | null {
  const read = readUuid(value, 'route identity');
  return read.ok ? read.value : null;
}

function newEventId(atMs: number = Date.now()): string {
  return eventIdFrom(atMs, crypto.getRandomValues(new Uint8Array(EVENT_ID_RANDOM_BYTES)));
}

/**
 * Mints identities that sort in the order they are minted, a millisecond apart,
 * for events that must stay together in the server's log (a correction pair).
 */
function orderedEventIds(): () => string {
  let atMs = Date.now();
  return () => newEventId(atMs++);
}

const SYNC_BADGES: Readonly<Record<SyncState, { tone: 'neutral' | 'info' | 'provisional'; icon: 'cloudCheck' | 'sync' | 'cloudOff' }>> = {
  synced: { tone: 'neutral', icon: 'cloudCheck' },
  syncing: { tone: 'info', icon: 'sync' },
  unsynced: { tone: 'provisional', icon: 'cloudOff' },
};

export function LiveTrackerScreen({ api }: LiveTrackerScreenProps): ReactElement {
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
  const inPlay = belongs && match.state === 'InProgress';

  const standing = useRemote(
    squadId,
    useCallback((signal: AbortSignal) => api.getSquadStanding(squadId ?? '', signal), [api, squadId]),
    authState,
  );
  const tracking = useRemote(
    belongs ? squadId : null,
    useCallback((signal: AbortSignal) => api.getLiveTracking(squadId ?? '', signal), [api, squadId]),
    authState,
  );
  const sheet = useRemote(
    inPlay ? matchId : null,
    useCallback((signal: AbortSignal) => api.getTeamSheet(matchId ?? '', signal), [api, matchId]),
    authState,
  );

  if (detail.phase === 'not-found' || (match !== null && !belongs)) {
    return (
      <div className="matches-screen">
        <MatchNotFound squadId={routeSquadId} />
      </div>
    );
  }

  const failed = [detail, standing, tracking, sheet].find((remote) => remote.phase === 'failed' && remote.value === null);
  if (failed !== undefined) {
    return (
      <div className="matches-screen">
        <h1 className="matches-heading">{TRACKER_HEADING}</h1>
        <FailureNotice onRetry={failed.reload} />
      </div>
    );
  }

  if (match === null || squadId === null || matchId === null || standing.phase === 'loading' || standing.phase === 'idle') {
    return <TrackerLoading />;
  }

  const unavailable = !isOrganiser(standing.value)
    ? TRACKER_NOT_ORGANISER_STATEMENT
    : !inPlay
      ? TRACKER_NOT_IN_PLAY_STATEMENT
      : tracking.value === false
        ? TRACKER_OFF_STATEMENT
        : null;

  if (unavailable !== null) {
    return (
      <div className="matches-screen">
        <h1 className="matches-heading">{TRACKER_HEADING}</h1>
        <p className="matches-notice" role="status">
          {unavailable}
        </p>
        <Link className={buttonClasses({ variant: 'secondary' })} to={matchPath(squadId, matchId)}>
          {BACK_TO_MATCH_LABEL}
        </Link>
      </div>
    );
  }

  if (tracking.value === null || sheet.value === null) {
    return <TrackerLoading />;
  }

  return (
    <Tracker
      api={api}
      squadId={squadId}
      matchId={matchId}
      location={match.location}
      startedAtMs={match.startedAtMs}
      sheet={sheet.value}
      onHalted={detail.reload}
    />
  );
}

function TrackerLoading(): ReactElement {
  return (
    <div className="matches-screen">
      <h1 className="matches-heading">{TRACKER_HEADING}</h1>
      <LoadingNotice label={TRACKER_LOADING_LABEL} />
    </div>
  );
}

interface TrackerProps {
  readonly api: MatchesApi;
  readonly squadId: string;
  readonly matchId: string;
  readonly location: string;
  readonly startedAtMs: number | null;
  readonly sheet: TeamSheet;
  readonly onHalted: () => void;
}

interface Notice {
  readonly text: string;
  /** Whether the toast offers to undo the goal it reports. */
  readonly undoable: boolean;
}

function Tracker({ api, squadId, matchId, location, startedAtMs, sheet, onHalted }: TrackerProps): ReactElement {
  const navigate = useNavigate();
  const now = useNow(CLOCK_TICK_MS);
  // A match whose kickoff was never recorded is timed from when the tracker opened.
  const [openedAtMs] = useState(() => Date.now());
  const kickoffMs = startedAtMs ?? openedAtMs;

  const events = useEventLog({ matchId, api, onHalted });
  const [pickingAtMinute, setPickingAtMinute] = useState<number | null>(null);
  const [keeperOpen, setKeeperOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [fixing, setFixing] = useState<GoalEvent | null>(null);
  const [endOpen, setEndOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const goalButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const minute = (): number => matchMinute(kickoffMs, Date.now());
  const nameOf = (membershipId: string): string =>
    sheet.teams.flatMap((team) => team.roster).find((entry) => entry.membershipId === membershipId)?.displayName ?? '';
  const teamNameOf = (teamId: string): string => sheet.teams.find((team) => team.teamId === teamId)?.teamName ?? '';

  const scores = displayedScores(sheet, events.serverScores ?? [], events.log);
  const teams = sheet.teams.map((team, index) => ({ ...team, score: scores[index]?.score ?? 0 }));
  const [teamA, teamB] = teams;
  const keepers = currentKeepers(events.log);
  const lastGoal = lastStandingGoal(events.log);
  const pending = pendingEvents(events.log).length;
  const rejected = events.log.some((entry: LoggedEvent) => entry.status === 'rejected');
  const syncBadge = SYNC_BADGES[events.sync];

  const recordGoal = (pick: GoalPick, at: number): void => {
    events.record({ kind: 'goal', eventId: newEventId(), minute: at, ...pick });
    setPickingAtMinute(null);
    setNotice({
      text: goalLoggedStatement(
        pick.scorerId === null ? null : nameOf(pick.scorerId),
        teamNameOf(pick.teamId),
        pick.ownGoal,
        at,
      ),
      undoable: true,
    });
    // Back on the main view, focus returns to GOAL for the next one.
    requestAnimationFrame(() => goalButtonRef.current?.focus());
  };

  const undoLastGoal = (): void => {
    if (lastGoal === null) return;
    events.record({ kind: 'goal-undo', eventId: newEventId(), minute: minute(), targetEventId: lastGoal.eventId });
    setNotice({ text: GOAL_UNDONE_STATEMENT, undoable: false });
  };

  const correctGoal = (target: GoalEvent, pick: GoalPick): void => {
    for (const event of goalCorrection(target, pick, minute(), orderedEventIds())) events.record(event);
    setFixing(null);
    setNotice({
      text: goalCorrectedStatement(
        pick.scorerId === null ? null : nameOf(pick.scorerId),
        teamNameOf(pick.teamId),
        pick.ownGoal,
        target.minute,
      ),
      undoable: false,
    });
  };

  const removeGoal = (target: GoalEvent): void => {
    events.record({ kind: 'goal-undo', eventId: newEventId(), minute: minute(), targetEventId: target.eventId });
    setNotice({ text: GOAL_REMOVED_STATEMENT, undoable: false });
  };

  const removeKeeper = (target: KeeperEvent): void => {
    events.record({ kind: 'keeper-undo', eventId: newEventId(), minute: minute(), targetEventId: target.eventId });
    setNotice({ text: KEEPER_REMOVED_STATEMENT, undoable: false });
  };

  const recordKeeper = (teamId: string, keeperId: string): void => {
    const at = minute();
    events.record({ kind: 'keeper', eventId: newEventId(), minute: at, teamId, keeperId });
    setKeeperOpen(false);
    setNotice({ text: keeperLoggedStatement(nameOf(keeperId), teamNameOf(teamId), at), undoable: false });
  };

  return (
    <div className="matches-screen matches-tracker">
      <div className="matches-tracker__bar">
        <Link className="matches-link" to={matchPath(squadId, matchId)}>
          {BACK_TO_MATCH_LABEL}
        </Link>
        <Badge tone={syncBadge.tone} icon={syncBadge.icon}>
          {SYNC_LABELS[events.sync]}
        </Badge>
      </div>

      <div className="matches-titles">
        <p className="matches-overline">{TRACKER_HEADING}</p>
        <h1 className="matches-heading">{location}</h1>
      </div>

      {events.halted ? (
        <Banner tone="error">{TRACKER_HALTED_STATEMENT}</Banner>
      ) : pickingAtMinute !== null ? (
        <GoalPicker
          sheet={sheet}
          minute={pickingAtMinute}
          log={events.log}
          onPick={(pick) => recordGoal(pick, pickingAtMinute)}
          onCancel={() => {
            setPickingAtMinute(null);
            requestAnimationFrame(() => goalButtonRef.current?.focus());
          }}
        />
      ) : fixing !== null ? (
        <GoalPicker
          sheet={sheet}
          minute={fixing.minute}
          log={events.log}
          initialTeamId={fixing.teamId}
          initialOwnGoal={fixing.ownGoal}
          title={changeScorerHeading(fixing.minute)}
          onPick={(pick) => correctGoal(fixing, pick)}
          onCancel={() => setFixing(null)}
        />
      ) : timelineOpen ? (
        <>
          <TrackerTimeline
            sheet={sheet}
            log={events.log}
            nameOf={nameOf}
            onChangeScorer={setFixing}
            onRemoveGoal={removeGoal}
            onRemoveKeeper={removeKeeper}
            onClose={() => setTimelineOpen(false)}
          />
          {notice === null ? null : (
            <div className="matches-tracker__notice">
              <Toast tone="success">{notice.text}</Toast>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="matches-tracker__clock">
            <Badge tone="live">{LIVE_LABEL}</Badge>
            <span className="matches-tracker__time pm-num" role="timer" aria-label={CLOCK_LABEL}>
              {clockText(kickoffMs, now)}
            </span>
          </div>
          {startedAtMs === null ? <p className="matches-hint">{CLOCK_FALLBACK_NOTE}</p> : null}

          {teamA !== undefined && teamB !== undefined ? (
            <Scoreboard
              teamA={teamA.teamName}
              teamB={teamB.teamName}
              scoreA={teamA.score}
              scoreB={teamB.score}
              bibs={teamA.bibFlag ? 'a' : teamB.bibFlag ? 'b' : null}
              status="provisional"
              showStatus={false}
            />
          ) : null}
          <p className="pm-sr" role="status" aria-live="polite">
            {liveScoreStatement(teams.map((team) => ({ name: team.teamName, score: team.score })))}
          </p>
          <ul className="matches-tracker__keepers">
            {sheet.teams.map((team) => {
              const keeperId = keepers.get(team.teamId);
              return (
                <li key={team.teamId}>{keeperLine(team.teamName, keeperId === undefined ? null : nameOf(keeperId))}</li>
              );
            })}
          </ul>

          {events.sync === 'unsynced' ? (
            <Banner tone="warn">
              {unsyncedStatement(pending)}{' '}
              <Button size="sm" variant="secondary" icon="sync" onClick={events.retry}>
                {SEND_AGAIN_LABEL}
              </Button>
            </Banner>
          ) : null}
          {rejected ? <Banner tone="error">{EVENT_REJECTED_STATEMENT}</Banner> : null}

          <div className="matches-tracker__notice">
            {notice === null ? null : (
              <Toast
                tone="success"
                actionLabel={notice.undoable && lastGoal !== null ? UNDO_LABEL : undefined}
                onAction={undoLastGoal}
              >
                {notice.text}
              </Toast>
            )}
          </div>

          <div className="matches-tracker__tools">
            <Button
              variant="secondary"
              icon="undo"
              aria-disabled={lastGoal === null ? true : undefined}
              onClick={undoLastGoal}
            >
              {UNDO_GOAL_LABEL}
            </Button>
            <Button variant="secondary" icon="glove" onClick={() => setKeeperOpen(true)}>
              {KEEPER_LABEL}
            </Button>
            <Button variant="secondary" icon="list" onClick={() => setTimelineOpen(true)}>
              {TIMELINE_LABEL}
            </Button>
            <Button variant="secondary" icon="flag" onClick={() => setEndOpen(true)}>
              {END_MATCH_LABEL}
            </Button>
          </div>
          <Button
            ref={goalButtonRef}
            size="pitch"
            block
            icon="ball"
            className="matches-tracker__goal"
            onClick={() => setPickingAtMinute(minute())}
          >
            {GOAL_LABEL}
          </Button>
        </>
      )}

      <KeeperDialog
        open={keeperOpen}
        sheet={sheet}
        keepers={keepers}
        onPick={recordKeeper}
        onClose={() => setKeeperOpen(false)}
      />
      <EndMatchDialog
        open={endOpen}
        score={scoreText(teams.map((team) => team.score))}
        unsynced={pending > 0}
        finalise={(signal) => api.finaliseTrackedResult(matchId, signal)}
        onClose={() => setEndOpen(false)}
        onEnded={() => navigate(matchPath(squadId, matchId))}
      />
    </div>
  );
}

export default LiveTrackerScreen;
