/**
 * The parser for `ListSquadMatches` (`GET /squads/{squadId}/matches`).
 *
 * All or nothing: one malformed entry fails the whole list rather than quietly
 * dropping a match from the squad screen. Properties this feature does not
 * present (`lockedTeams`, `recordedResult`, `completedAt`) are never read.
 */
import {
  fail,
  ok,
  readArray,
  readBoolean,
  readCount,
  readInstantMs,
  readObject,
  readOptional,
  readProperty,
  readString,
  readUuid,
  readWireEnumName,
  type ParseResult,
} from '../../../../wire';
import { isMatchState, type MatchState } from '../wireEnums';

/** One match as the squad's match list presents it. */
export interface MatchSummary {
  readonly matchId: string;
  readonly state: MatchState;
  readonly location: string;
  /** The confirmed day in epoch milliseconds, or `null` before confirmation. */
  readonly confirmedDayMs: number | null;
  /** The candidate days in epoch milliseconds, in the order the backend sent. */
  readonly candidateDaysMs: readonly number[];
  readonly participantCount: number;
}

/** The squad's match list, and whether the backend truncated it. */
export interface MatchList {
  readonly matches: readonly MatchSummary[];
  readonly truncated: boolean;
}

/** Read an array whose every element is an instant. */
export function readInstantList(
  value: unknown,
  label: string,
): ParseResult<readonly number[]> {
  const array = readArray(value, label);
  if (!array.ok) {
    return array;
  }

  const instants: number[] = [];
  for (const element of array.value) {
    const instant = readInstantMs(element, `${label} element`);
    if (!instant.ok) {
      return instant;
    }
    instants.push(instant.value);
  }

  return ok(instants);
}

function parseMatchSummary(value: unknown): ParseResult<MatchSummary> {
  const body = readObject(value, 'match');
  if (!body.ok) {
    return body;
  }
  const source = body.value;

  const matchId = readUuid(readProperty(source, 'matchId'), 'matchId');
  if (!matchId.ok) return matchId;

  const state = readWireEnumName(readProperty(source, 'state'), 'state', isMatchState);
  if (!state.ok) return state;

  const location = readString(readProperty(source, 'location'), 'location');
  if (!location.ok) return location;

  const confirmedDay = readOptional(
    readProperty(source, 'confirmedDay'),
    'confirmedDay',
    readInstantMs,
  );
  if (!confirmedDay.ok) return confirmedDay;

  const candidateDays = readInstantList(
    readProperty(source, 'candidateDays'),
    'candidateDays',
  );
  if (!candidateDays.ok) return candidateDays;

  const participantCount = readCount(
    readProperty(source, 'participantCount'),
    'participantCount',
  );
  if (!participantCount.ok) return participantCount;

  return ok({
    matchId: matchId.value,
    state: state.value,
    location: location.value,
    confirmedDayMs: confirmedDay.value,
    candidateDaysMs: candidateDays.value,
    participantCount: participantCount.value,
  });
}

/** Parse a `MatchList` body. */
export function parseMatchList(body: unknown): ParseResult<MatchList> {
  const object = readObject(body, 'match list');
  if (!object.ok) {
    return object;
  }

  const entries = readArray(readProperty(object.value, 'matches'), 'matches');
  if (!entries.ok) {
    return entries;
  }

  const matches: MatchSummary[] = [];
  for (const entry of entries.value) {
    const parsed = parseMatchSummary(entry);
    if (!parsed.ok) {
      return fail(`matches element: ${parsed.reason}`);
    }
    matches.push(parsed.value);
  }

  const truncated = readBoolean(readProperty(object.value, 'truncated'), 'truncated');
  if (!truncated.ok) {
    return truncated;
  }

  return ok({ matches, truncated: truncated.value });
}
