/**
 * The parsers for the live-tracking reads and writes:
 *
 * - `RecordMatchEvents` (`POST /matches/{matchId}/events`): the server's verdict
 *   on each event of a batch, by its identity;
 * - `GetMatchRunningScore` (`GET /matches/{matchId}/running-score`) and
 *   `FinaliseTrackedResult` (`POST /matches/{matchId}/tracked-result`): one score
 *   per locked team;
 * - `GetMatchEvents` (`GET /matches/{matchId}/events`): every recorded event,
 *   oldest first, as the tracker's own event shapes;
 * - `GetFeatureFlags` (`GET /squads/{squadId}/features`): whether the squad has
 *   live tracking on.
 *
 * A rejection's reason text is never read, so no backend message reaches the
 * screen.
 */
import {
  fail,
  ok,
  readArray,
  readBoolean,
  readCount,
  readObject,
  readProperty,
  readUuid,
  readWireEnumName,
  type ParseResult,
} from '../../../../wire';
import type { EventResult, TrackedEvent } from '../liveTracking';
import { isEventKind, isEventOutcome, isSquadFeature } from '../wireEnums';
import { parseTeamScore, type TeamScore } from './matchDetail';

function readEach<T>(
  value: unknown,
  label: string,
  readElement: (element: unknown) => ParseResult<T>,
): ParseResult<readonly T[]> {
  const array = readArray(value, label);
  if (!array.ok) return array;

  const elements: T[] = [];
  for (const element of array.value) {
    const read = readElement(element);
    if (!read.ok) return fail(`${label} element: ${read.reason}`);
    elements.push(read.value);
  }
  return ok(elements);
}

function parseEventResult(value: unknown): ParseResult<EventResult> {
  const object = readObject(value, 'outcome');
  if (!object.ok) return object;

  const eventId = readUuid(readProperty(object.value, 'eventId'), 'eventId');
  if (!eventId.ok) return eventId;

  const outcome = readWireEnumName(readProperty(object.value, 'outcome'), 'outcome', isEventOutcome);
  if (!outcome.ok) return outcome;

  return ok({ eventId: eventId.value, outcome: outcome.value });
}

/** Parse a `BatchResultResponse` body to each event's outcome, in batch order. */
export function parseBatchResult(body: unknown): ParseResult<readonly EventResult[]> {
  const object = readObject(body, 'batch result');
  if (!object.ok) return object;
  return readEach(readProperty(object.value, 'outcomes'), 'outcomes', parseEventResult);
}

function parseTrackedEvent(value: unknown): ParseResult<TrackedEvent> {
  const object = readObject(value, 'event');
  if (!object.ok) return object;
  const source = object.value;

  const eventId = readUuid(readProperty(source, 'eventId'), 'eventId');
  if (!eventId.ok) return eventId;

  const kind = readWireEnumName(readProperty(source, 'kind'), 'kind', isEventKind);
  if (!kind.ok) return kind;

  const minute = readCount(readProperty(source, 'minute'), 'minute');
  if (!minute.ok) return minute;

  const base = { eventId: eventId.value, minute: minute.value };

  switch (kind.value) {
    case 'GoalScored': {
      const teamId = readUuid(readProperty(source, 'scoringTeamId'), 'scoringTeamId');
      if (!teamId.ok) return teamId;
      const scorer = readProperty(source, 'scorerMembershipId');
      const scorerId = scorer === null || scorer === undefined ? ok(null) : readUuid(scorer, 'scorerMembershipId');
      if (!scorerId.ok) return scorerId;
      const ownGoal = readBoolean(readProperty(source, 'ownGoal'), 'ownGoal');
      if (!ownGoal.ok) return ownGoal;
      return ok({ kind: 'goal', ...base, teamId: teamId.value, scorerId: scorerId.value, ownGoal: ownGoal.value });
    }
    case 'KeeperStintStarted': {
      const teamId = readUuid(readProperty(source, 'keptTeamId'), 'keptTeamId');
      if (!teamId.ok) return teamId;
      const keeperId = readUuid(readProperty(source, 'keeperMembershipId'), 'keeperMembershipId');
      if (!keeperId.ok) return keeperId;
      return ok({ kind: 'keeper', ...base, teamId: teamId.value, keeperId: keeperId.value });
    }
    case 'GoalRetracted':
    case 'KeeperStintRetracted': {
      const target = readUuid(readProperty(source, 'targetEventId'), 'targetEventId');
      if (!target.ok) return target;
      return ok({ kind: kind.value === 'GoalRetracted' ? 'goal-undo' : 'keeper-undo', ...base, targetEventId: target.value });
    }
  }
}

/** Parse a `MatchEventLogResponse` body to its events, oldest first. */
export function parseEventLog(body: unknown): ParseResult<readonly TrackedEvent[]> {
  const object = readObject(body, 'event log');
  if (!object.ok) return object;
  return readEach(readProperty(object.value, 'events'), 'events', parseTrackedEvent);
}

/** Parse a `RunningScoreResponse` or `FinaliseTrackedResultResponse` body to its team scores. */
export function parseTeamScores(body: unknown): ParseResult<readonly TeamScore[]> {
  const object = readObject(body, 'score');
  if (!object.ok) return object;
  return readEach(readProperty(object.value, 'teamScores'), 'teamScores', parseTeamScore);
}

/** Parse a `GetFeatureFlags` body to whether live match tracking is on. */
export function parseLiveTrackingEnabled(body: unknown): ParseResult<boolean> {
  const flags = readEach(body, 'features', (value) => {
    const object = readObject(value, 'feature');
    if (!object.ok) return object;

    const feature = readWireEnumName(readProperty(object.value, 'feature'), 'feature', isSquadFeature);
    if (!feature.ok) return feature;

    const enabled = readBoolean(readProperty(object.value, 'isEnabled'), 'isEnabled');
    if (!enabled.ok) return enabled;

    return ok({ feature: feature.value, enabled: enabled.value });
  });
  if (!flags.ok) return flags;

  return ok(flags.value.some(({ feature, enabled }) => feature === 'LiveMatchTracking' && enabled));
}
