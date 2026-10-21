/**
 * The parser for `GetMatchDetail` (`GET /matches/{matchId}`).
 *
 * All or nothing, like every parser here. `recordedResult` and `completedAt`
 * belong to the later result flow and are never read.
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
import { readInstantList } from './matchList';

/** One participant of a confirmed match. */
export interface Participant {
  readonly membershipId: string;
  readonly displayName: string;
  readonly isGuest: boolean;
  readonly rosterPosition: number;
}

/** What the caller has said about their own availability. */
export interface CallerAvailability {
  readonly hasStoredResponse: boolean;
  readonly markedDaysMs: readonly number[];
}

/** A match as its own screen presents it. */
export interface MatchDetail {
  readonly matchId: string;
  readonly squadId: string;
  readonly state: MatchState;
  readonly location: string;
  readonly candidateDaysMs: readonly number[];
  readonly confirmedDayMs: number | null;
  readonly participantCount: number;
  readonly participants: readonly Participant[];
  /** The fewest available players a day needs before it can be confirmed. */
  readonly minimumPlayerThreshold: number;
  readonly callerAvailability: CallerAvailability;
}

function parseParticipant(value: unknown): ParseResult<Participant> {
  const object = readObject(value, 'participant');
  if (!object.ok) return object;
  const source = object.value;

  const membershipId = readUuid(
    readProperty(source, 'squadMembershipId'),
    'squadMembershipId',
  );
  if (!membershipId.ok) return membershipId;

  const displayName = readString(readProperty(source, 'displayName'), 'displayName');
  if (!displayName.ok) return displayName;

  const isGuest = readBoolean(readProperty(source, 'isGuest'), 'isGuest');
  if (!isGuest.ok) return isGuest;

  const rosterPosition = readCount(
    readProperty(source, 'rosterPosition'),
    'rosterPosition',
  );
  if (!rosterPosition.ok) return rosterPosition;

  return ok({
    membershipId: membershipId.value,
    displayName: displayName.value,
    isGuest: isGuest.value,
    rosterPosition: rosterPosition.value,
  });
}

function parseCallerAvailability(value: unknown): ParseResult<CallerAvailability> {
  const object = readObject(value, 'callerAvailability');
  if (!object.ok) return object;

  const hasStoredResponse = readBoolean(
    readProperty(object.value, 'hasStoredResponse'),
    'hasStoredResponse',
  );
  if (!hasStoredResponse.ok) return hasStoredResponse;

  const markedDays = readInstantList(
    readProperty(object.value, 'markedDays'),
    'markedDays',
  );
  if (!markedDays.ok) return markedDays;

  return ok({
    hasStoredResponse: hasStoredResponse.value,
    markedDaysMs: markedDays.value,
  });
}

/** Parse a `MatchDetail` body. */
export function parseMatchDetail(body: unknown): ParseResult<MatchDetail> {
  const object = readObject(body, 'match detail');
  if (!object.ok) return object;
  const source = object.value;

  const matchId = readUuid(readProperty(source, 'matchId'), 'matchId');
  if (!matchId.ok) return matchId;

  const squadId = readUuid(readProperty(source, 'squadId'), 'squadId');
  if (!squadId.ok) return squadId;

  const state = readWireEnumName(readProperty(source, 'state'), 'state', isMatchState);
  if (!state.ok) return state;

  const location = readString(readProperty(source, 'location'), 'location');
  if (!location.ok) return location;

  const candidateDays = readInstantList(
    readProperty(source, 'candidateDays'),
    'candidateDays',
  );
  if (!candidateDays.ok) return candidateDays;

  const confirmedDay = readOptional(
    readProperty(source, 'confirmedDay'),
    'confirmedDay',
    readInstantMs,
  );
  if (!confirmedDay.ok) return confirmedDay;

  const participantCount = readCount(
    readProperty(source, 'participantCount'),
    'participantCount',
  );
  if (!participantCount.ok) return participantCount;

  const participantEntries = readArray(
    readProperty(source, 'participants'),
    'participants',
  );
  if (!participantEntries.ok) return participantEntries;

  const participants: Participant[] = [];
  for (const entry of participantEntries.value) {
    const participant = parseParticipant(entry);
    if (!participant.ok) {
      return fail(`participants element: ${participant.reason}`);
    }
    participants.push(participant.value);
  }

  const threshold = readCount(
    readProperty(source, 'effectiveMinimumPlayerThreshold'),
    'effectiveMinimumPlayerThreshold',
  );
  if (!threshold.ok) return threshold;

  const callerAvailability = parseCallerAvailability(
    readProperty(source, 'callerAvailability'),
  );
  if (!callerAvailability.ok) return callerAvailability;

  return ok({
    matchId: matchId.value,
    squadId: squadId.value,
    state: state.value,
    location: location.value,
    candidateDaysMs: candidateDays.value,
    confirmedDayMs: confirmedDay.value,
    participantCount: participantCount.value,
    participants,
    minimumPlayerThreshold: threshold.value,
    callerAvailability: callerAvailability.value,
  });
}
