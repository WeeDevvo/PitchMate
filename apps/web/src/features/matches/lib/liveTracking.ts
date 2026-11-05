/**
 * Rules for the live tracker: the match clock, the events an organiser records
 * pitch-side, and what the screen shows while some of them are still on their
 * way to the server.
 *
 * The backend's event log is the record. The tracker starts from it, then keeps
 * a session log of the events it sends, each pending until the server settles
 * it, so the score can move the moment a goal is tapped and a failed send can be
 * retried with the same identities. Corrections are new events, never edits:
 * undoing a goal sends a retraction that names it.
 */
import type { TeamScore } from './parse/matchDetail';
import type { TeamSheet } from './parse/teamSheet';
import type { RosterEntry } from './parse/teams';
import type { EventOutcome } from './wireEnums';

/** The latest minute the backend accepts for an event. */
export const MATCH_MINUTE_MAX = 200;

const MINUTE_MS = 60_000;

/**
 * The match minute at `nowMs` for a match that kicked off at `startedAtMs`: the
 * whole minutes elapsed, so the first minute is 0, clamped to the range the
 * backend accepts.
 */
export function matchMinute(startedAtMs: number, nowMs: number): number {
  const elapsed = Math.floor((nowMs - startedAtMs) / MINUTE_MS);
  return Math.min(MATCH_MINUTE_MAX, Math.max(0, elapsed));
}

/** The running clock, `mm:ss`, from kickoff; never negative. */
export function clockText(startedAtMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/* Events --------------------------------------------------------------------- */

/** A goal for `teamId`; an own goal's scorer plays for another team. */
export interface GoalEvent {
  readonly kind: 'goal';
  readonly eventId: string;
  readonly minute: number;
  readonly teamId: string;
  readonly scorerId: string | null;
  readonly ownGoal: boolean;
}

/** `keeperId` goes in goal for `teamId` from `minute`. */
export interface KeeperEvent {
  readonly kind: 'keeper';
  readonly eventId: string;
  readonly minute: number;
  readonly teamId: string;
  readonly keeperId: string;
}

/** Takes back the goal `targetEventId`. */
export interface GoalUndoEvent {
  readonly kind: 'goal-undo';
  readonly eventId: string;
  readonly minute: number;
  readonly targetEventId: string;
}

/** Takes back the keeper stint `targetEventId`. */
export interface KeeperUndoEvent {
  readonly kind: 'keeper-undo';
  readonly eventId: string;
  readonly minute: number;
  readonly targetEventId: string;
}

export type TrackedEvent = GoalEvent | KeeperEvent | GoalUndoEvent | KeeperUndoEvent;

/** Pending until the server answers; then recorded (applied, or already there) or rejected. */
export type EventStatus = 'pending' | 'recorded' | 'rejected';

export interface LoggedEvent {
  readonly event: TrackedEvent;
  readonly status: EventStatus;
}

/** The server's verdict on one event of a batch. */
export interface EventResult {
  readonly eventId: string;
  readonly outcome: EventOutcome;
}

/** The log with one more event, pending. */
export function appendEvent(log: readonly LoggedEvent[], event: TrackedEvent): readonly LoggedEvent[] {
  return [...log, { event, status: 'pending' }];
}

/**
 * The log started from the server's: every event the server has, recorded and
 * in its order, then any event of `log` the server does not have yet. An event
 * the server has is recorded whatever `log` said about it.
 */
export function mergeServerLog(
  log: readonly LoggedEvent[],
  serverEvents: readonly TrackedEvent[],
): readonly LoggedEvent[] {
  const known = new Set(serverEvents.map(({ eventId }) => eventId));
  return [
    ...serverEvents.map((event): LoggedEvent => ({ event, status: 'recorded' })),
    ...log.filter(({ event }) => !known.has(event.eventId)),
  ];
}

/** The events still to send, oldest first. */
export function pendingEvents(log: readonly LoggedEvent[]): readonly TrackedEvent[] {
  return log.filter(({ status }) => status === 'pending').map(({ event }) => event);
}

/**
 * The log after the server settled a batch: an applied or duplicate event is
 * recorded, a rejected one is not, and an event the batch did not name keeps
 * its status. Only pending events change.
 */
export function settleEvents(
  log: readonly LoggedEvent[],
  results: readonly EventResult[],
): readonly LoggedEvent[] {
  const outcomes = new Map(results.map(({ eventId, outcome }) => [eventId, outcome]));
  return log.map((entry) => {
    const outcome = outcomes.get(entry.event.eventId);
    if (entry.status !== 'pending' || outcome === undefined) return entry;
    return { event: entry.event, status: outcome === 'Rejected' ? 'rejected' : 'recorded' };
  });
}

function isLive(entry: LoggedEvent): boolean {
  return entry.status !== 'rejected';
}

/** The identities of goals an undo in the log takes back. */
function undoneGoalIds(log: readonly LoggedEvent[]): ReadonlySet<string> {
  return new Set(
    log.flatMap((entry) => (isLive(entry) && entry.event.kind === 'goal-undo' ? [entry.event.targetEventId] : [])),
  );
}

/** This session's goals that stand: sent or sending, and not undone. */
export function standingGoals(log: readonly LoggedEvent[]): readonly GoalEvent[] {
  const undone = undoneGoalIds(log);
  return log.flatMap((entry) =>
    isLive(entry) && entry.event.kind === 'goal' && !undone.has(entry.event.eventId) ? [entry.event] : [],
  );
}

/** The most recent standing goal, the one an undo would take back. */
export function lastStandingGoal(log: readonly LoggedEvent[]): GoalEvent | null {
  const goals = standingGoals(log);
  return goals.length === 0 ? null : goals[goals.length - 1];
}

/**
 * The score to show: the server's running score, plus the goals and undos it
 * has not recorded yet. A team the server has not scored starts from 0, and no
 * team ever shows below 0.
 */
export function displayedScores(
  sheet: TeamSheet,
  serverScores: readonly TeamScore[],
  log: readonly LoggedEvent[],
): readonly TeamScore[] {
  const scores = new Map(sheet.teams.map(({ teamId }) => [teamId, 0]));
  for (const { teamId, score } of serverScores) {
    if (scores.has(teamId)) scores.set(teamId, score);
  }

  const goals = new Map(
    log.flatMap((entry) => (entry.event.kind === 'goal' ? [[entry.event.eventId, entry] as const] : [])),
  );

  for (const entry of log) {
    if (entry.status !== 'pending') continue;
    const { event } = entry;
    if (event.kind === 'goal') {
      // A pending goal an undo already takes back never counts.
      if (undoneGoalIds(log).has(event.eventId)) continue;
      scores.set(event.teamId, (scores.get(event.teamId) ?? 0) + 1);
    } else if (event.kind === 'goal-undo') {
      // Only an undo of a goal the server already counted lowers its score.
      const target = goals.get(event.targetEventId);
      if (target?.status === 'recorded' && target.event.kind === 'goal') {
        scores.set(target.event.teamId, (scores.get(target.event.teamId) ?? 0) - 1);
      }
    }
  }

  return sheet.teams.map(({ teamId }) => ({ teamId, score: Math.max(0, scores.get(teamId) ?? 0) }));
}

/** Who is in goal for each team: the latest stint that stands, by team. */
export function currentKeepers(log: readonly LoggedEvent[]): ReadonlyMap<string, string> {
  const undone = new Set(
    log.flatMap((entry) => (isLive(entry) && entry.event.kind === 'keeper-undo' ? [entry.event.targetEventId] : [])),
  );
  const keepers = new Map<string, string>();
  for (const entry of log) {
    if (isLive(entry) && entry.event.kind === 'keeper' && !undone.has(entry.event.eventId)) {
      keepers.set(entry.event.teamId, entry.event.keeperId);
    }
  }
  return keepers;
}

/**
 * The players who could have scored a goal for `teamId`, likeliest first:
 * most goals this session, then team-sheet order. For an own goal they are the
 * other teams' players, since an own goal counts for the team it went past.
 */
export function scorerChoices(
  sheet: TeamSheet,
  teamId: string,
  ownGoal: boolean,
  log: readonly LoggedEvent[],
): readonly RosterEntry[] {
  const pool = sheet.teams.filter((team) => (ownGoal ? team.teamId !== teamId : team.teamId === teamId));
  const roster = pool.flatMap((team) => team.roster);

  const goals = new Map<string, number>();
  for (const goal of standingGoals(log)) {
    if (goal.scorerId !== null && !goal.ownGoal) {
      goals.set(goal.scorerId, (goals.get(goal.scorerId) ?? 0) + 1);
    }
  }

  return roster
    .map((entry, index) => ({ entry, index, goals: goals.get(entry.membershipId) ?? 0 }))
    .sort((a, b) => b.goals - a.goals || a.index - b.index)
    .map(({ entry }) => entry);
}

/* Timeline and corrections ------------------------------------------------------ */

/** A goal or keeper change as the timeline shows it: still standing, or taken back. */
export interface TimelineGoal {
  readonly kind: 'goal';
  readonly event: GoalEvent;
  readonly standing: boolean;
  readonly pending: boolean;
  /** Each team's score after this goal, in team-sheet order; `null` for a goal taken back. */
  readonly scoreAfter: readonly number[] | null;
}

export interface TimelineKeeper {
  readonly kind: 'keeper';
  readonly event: KeeperEvent;
  readonly standing: boolean;
  readonly pending: boolean;
}

/**
 * A correction: the event that took `target` back, and, when the correction
 * put a goal back in its place (a changed scorer), that `replacement`.
 */
export interface TimelineCorrection {
  readonly kind: 'correction';
  readonly event: GoalUndoEvent | KeeperUndoEvent;
  readonly target: GoalEvent | KeeperEvent;
  readonly replacement: GoalEvent | null;
  readonly pending: boolean;
}

export type TimelineEntry = TimelineGoal | TimelineKeeper | TimelineCorrection;

/**
 * The two events that correct a goal: take `target` back, and log `replacement`
 * at the same minute in its place. The replacement's identity is minted after
 * the retraction's, so the server's log (ordered by identity) keeps them
 * together, which is how the timeline pairs them again after a reload.
 */
export function goalCorrection(
  target: GoalEvent,
  replacement: Pick<GoalEvent, 'teamId' | 'scorerId' | 'ownGoal'>,
  minute: number,
  mintId: () => string,
): readonly [GoalUndoEvent, GoalEvent] {
  const undo: GoalUndoEvent = { kind: 'goal-undo', eventId: mintId(), minute, targetEventId: target.eventId };
  const goal: GoalEvent = { kind: 'goal', eventId: mintId(), minute: target.minute, ...replacement };
  return [undo, goal];
}

/**
 * The match as a timeline, in minute order: every goal and keeper change the
 * log holds, standing or taken back, each correction straight after the event it
 * took back, and the running score after each standing goal. Events the server
 * turned away are left out. Within a minute, events keep the log's order.
 */
export function timeline(teamIds: readonly string[], log: readonly LoggedEvent[]): readonly TimelineEntry[] {
  const live = log.filter(isLive);
  const indexOf = new Map(live.map((entry, index) => [entry.event.eventId, index]));
  const targets = new Map(
    live.flatMap((entry) =>
      entry.event.kind === 'goal' || entry.event.kind === 'keeper' ? [[entry.event.eventId, entry.event] as const] : [],
    ),
  );

  const undone = new Set<string>();
  const corrections = new Map<string, TimelineCorrection[]>();
  for (const [index, entry] of live.entries()) {
    const { event } = entry;
    if (event.kind !== 'goal-undo' && event.kind !== 'keeper-undo') continue;
    const target = targets.get(event.targetEventId);
    const matchesKind = target !== undefined && (event.kind === 'goal-undo' ? target.kind === 'goal' : target.kind === 'keeper');
    if (!matchesKind) continue;

    undone.add(target.eventId);
    const next = live[index + 1]?.event;
    const replacement =
      target.kind === 'goal' && next?.kind === 'goal' && next.minute === target.minute ? next : null;
    const list = corrections.get(target.eventId) ?? [];
    list.push({ kind: 'correction', event, target, replacement, pending: entry.status === 'pending' });
    corrections.set(target.eventId, list);
  }

  const occurrences = live
    .filter((entry) => entry.event.kind === 'goal' || entry.event.kind === 'keeper')
    .sort(
      (a, b) =>
        a.event.minute - b.event.minute ||
        (indexOf.get(a.event.eventId) ?? 0) - (indexOf.get(b.event.eventId) ?? 0),
    );

  const score = new Map(teamIds.map((teamId) => [teamId, 0]));
  const entries: TimelineEntry[] = [];
  for (const entry of occurrences) {
    const { event } = entry;
    const standing = !undone.has(event.eventId);
    const pending = entry.status === 'pending';
    if (event.kind === 'goal') {
      if (standing) score.set(event.teamId, (score.get(event.teamId) ?? 0) + 1);
      entries.push({
        kind: 'goal',
        event,
        standing,
        pending,
        scoreAfter: standing ? teamIds.map((teamId) => score.get(teamId) ?? 0) : null,
      });
    } else if (event.kind === 'keeper') {
      entries.push({ kind: 'keeper', event, standing, pending });
    }
    // Only the first retraction of an event took it back; a repeat changes nothing.
    const first = corrections.get(event.eventId)?.[0];
    if (first !== undefined) entries.push(first);
  }
  return entries;
}

/** How many goals `membershipId` scored this session, own goals aside. */
export function sessionGoalsFor(log: readonly LoggedEvent[], membershipId: string): number {
  return standingGoals(log).filter((goal) => goal.scorerId === membershipId && !goal.ownGoal).length;
}
