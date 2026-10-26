/**
 * The parser for `GetMatchDetail` (`GET /matches/{matchId}`).
 *
 * All or nothing, like every parser here. `recordedResult` and `completedAt`
 * are null until a result is recorded and the match completed.
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
import { isMatchState, isResultFidelity, type MatchState, type ResultFidelity } from '../wireEnums';
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

/** The days an organiser marked for one guest, who has no account to answer with. */
export interface GuestAvailability {
  readonly membershipId: string;
  readonly markedDaysMs: readonly number[];
}

/** One team's final score, keyed by the locked team it was given against. */
export interface TeamScore {
  readonly teamId: string;
  readonly score: number;
}

/** The result recorded for a played match. It can be re-recorded until completion. */
export interface RecordedResult {
  readonly fidelity: ResultFidelity;
  readonly teamScores: readonly TeamScore[];
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
  /** Whether the caller is one of the participants, so they can leave rather than join. */
  readonly callerIsParticipant: boolean;
  readonly callerAvailability: CallerAvailability;
  readonly recordedResult: RecordedResult | null;
  /** When the match was completed and ratings applied, or `null` before then. */
  readonly completedAtMs: number | null;
  /** What was marked for each active guest; empty unless the caller is an owner or admin. */
  readonly guestAvailability: readonly GuestAvailability[];
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

function parseGuestAvailability(value: unknown): ParseResult<GuestAvailability> {
  const object = readObject(value, 'guest availability');
  if (!object.ok) return object;

  const membershipId = readUuid(
    readProperty(object.value, 'squadMembershipId'),
    'squadMembershipId',
  );
  if (!membershipId.ok) return membershipId;

  const markedDays = readInstantList(
    readProperty(object.value, 'markedDays'),
    'markedDays',
  );
  if (!markedDays.ok) return markedDays;

  return ok({ membershipId: membershipId.value, markedDaysMs: markedDays.value });
}

function parseTeamScore(value: unknown): ParseResult<TeamScore> {
  const object = readObject(value, 'team score');
  if (!object.ok) return object;

  const teamId = readUuid(readProperty(object.value, 'teamId'), 'teamId');
  if (!teamId.ok) return teamId;

  const score = readCount(readProperty(object.value, 'score'), 'score');
  if (!score.ok) return score;

  return ok({ teamId: teamId.value, score: score.value });
}

function parseRecordedResult(value: unknown): ParseResult<RecordedResult> {
  const object = readObject(value, 'recordedResult');
  if (!object.ok) return object;

  const fidelity = readWireEnumName(
    readProperty(object.value, 'fidelity'),
    'fidelity',
    isResultFidelity,
  );
  if (!fidelity.ok) return fidelity;

  const entries = readArray(readProperty(object.value, 'teamScores'), 'teamScores');
  if (!entries.ok) return entries;

  const teamScores: TeamScore[] = [];
  for (const entry of entries.value) {
    const parsed = parseTeamScore(entry);
    if (!parsed.ok) return fail(`teamScores element: ${parsed.reason}`);
    teamScores.push(parsed.value);
  }

  return ok({ fidelity: fidelity.value, teamScores });
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

  const callerIsParticipant = readBoolean(
    readProperty(source, 'callerIsParticipant'),
    'callerIsParticipant',
  );
  if (!callerIsParticipant.ok) return callerIsParticipant;

  const callerAvailability = parseCallerAvailability(
    readProperty(source, 'callerAvailability'),
  );
  if (!callerAvailability.ok) return callerAvailability;

  const recordedResult = readOptional(
    readProperty(source, 'recordedResult'),
    'recordedResult',
    parseRecordedResult,
  );
  if (!recordedResult.ok) return recordedResult;

  const completedAt = readOptional(
    readProperty(source, 'completedAt'),
    'completedAt',
    readInstantMs,
  );
  if (!completedAt.ok) return completedAt;

  const guestEntries = readArray(
    readProperty(source, 'guestAvailability'),
    'guestAvailability',
  );
  if (!guestEntries.ok) return guestEntries;

  const guestAvailability: GuestAvailability[] = [];
  for (const entry of guestEntries.value) {
    const parsed = parseGuestAvailability(entry);
    if (!parsed.ok) return fail(`guestAvailability element: ${parsed.reason}`);
    guestAvailability.push(parsed.value);
  }

  return ok({
    matchId: matchId.value,
    squadId: squadId.value,
    state: state.value,
    location: location.value,
    candidateDaysMs: candidateDays.value,
    confirmedDayMs: confirmedDay.value,
    participantCount: participantCount.value,
    participants,
    callerIsParticipant: callerIsParticipant.value,
    callerAvailability: callerAvailability.value,
    recordedResult: recordedResult.value,
    completedAtMs: completedAt.value,
    guestAvailability,
  });
}
