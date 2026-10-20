/**
 * The parsers for the organiser's working teams (`GetWorkingTeams`) and for the
 * squad's guests, read from `GetSquad` so an organiser can add one to a match.
 */
import {
  fail,
  ok,
  readArray,
  readBoolean,
  readNumber,
  readObject,
  readOptional,
  readProperty,
  readString,
  readUuid,
  readWireEnumName,
  type ParseResult,
  type ValueReader,
} from '../../../../wire';
import { isMembershipState } from '../wireEnums';

/* -------------------------------------------------------------------------- */
/* Working teams                                                              */
/* -------------------------------------------------------------------------- */

export interface RosterEntry {
  readonly membershipId: string;
  readonly displayName: string;
}

export interface WorkingTeam {
  readonly teamId: string;
  readonly teamName: string;
  readonly bibFlag: boolean;
  readonly roster: readonly RosterEntry[];
}

/** The engine's view of the current split, one win probability per team. */
export interface SplitPrediction {
  /** In team order, each in the closed range 0 to 1. */
  readonly winProbabilities: readonly number[];
  readonly drawProbability: number;
}

export interface WorkingTeams {
  readonly teams: readonly WorkingTeam[];
  /** `null` when there is no split to judge (fewer than two non-empty teams). */
  readonly prediction: SplitPrediction | null;
  /** Participants on no team, by membership identity. */
  readonly unassigned: readonly string[];
}

/** A probability: a finite number in the closed range 0 to 1, never clamped. */
const readProbability: ValueReader<number> = (value, label) => {
  const number = readNumber(value, label);
  if (!number.ok) return number;
  if (number.value < 0 || number.value > 1) {
    return fail(`${label} is outside the probability range`);
  }
  return ok(number.value);
};

function readList<T>(
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

function parseRosterEntry(value: unknown): ParseResult<RosterEntry> {
  const object = readObject(value, 'roster entry');
  if (!object.ok) return object;

  const membershipId = readUuid(
    readProperty(object.value, 'squadMembershipId'),
    'squadMembershipId',
  );
  if (!membershipId.ok) return membershipId;

  const displayName = readString(readProperty(object.value, 'displayName'), 'displayName');
  if (!displayName.ok) return displayName;

  return ok({ membershipId: membershipId.value, displayName: displayName.value });
}

function parseTeam(value: unknown): ParseResult<WorkingTeam> {
  const object = readObject(value, 'team');
  if (!object.ok) return object;
  const source = object.value;

  const teamId = readUuid(readProperty(source, 'teamId'), 'teamId');
  if (!teamId.ok) return teamId;

  const teamName = readString(readProperty(source, 'teamName'), 'teamName');
  if (!teamName.ok) return teamName;

  const bibFlag = readBoolean(readProperty(source, 'bibFlag'), 'bibFlag');
  if (!bibFlag.ok) return bibFlag;

  const roster = readList(readProperty(source, 'roster'), 'roster', parseRosterEntry);
  if (!roster.ok) return roster;

  return ok({
    teamId: teamId.value,
    teamName: teamName.value,
    bibFlag: bibFlag.value,
    roster: roster.value,
  });
}

function parsePrediction(value: unknown): ParseResult<SplitPrediction> {
  const object = readObject(value, 'prediction');
  if (!object.ok) return object;

  const wins = readList(
    readProperty(object.value, 'winProbabilities'),
    'winProbabilities',
    (element) => readProbability(element, 'winProbability'),
  );
  if (!wins.ok) return wins;

  const draw = readProbability(
    readProperty(object.value, 'drawProbability'),
    'drawProbability',
  );
  if (!draw.ok) return draw;

  return ok({ winProbabilities: wins.value, drawProbability: draw.value });
}

/** Parse a `WorkingTeamsView` body. */
export function parseWorkingTeams(body: unknown): ParseResult<WorkingTeams> {
  const object = readObject(body, 'working teams');
  if (!object.ok) return object;

  const teams = readList(readProperty(object.value, 'teams'), 'teams', parseTeam);
  if (!teams.ok) return teams;

  const prediction = readOptional(
    readProperty(object.value, 'prediction'),
    'prediction',
    (value) => parsePrediction(value),
  );
  if (!prediction.ok) return prediction;

  if (
    prediction.value !== null &&
    prediction.value.winProbabilities.length !== teams.value.length
  ) {
    return fail('prediction does not name one win probability per team');
  }

  const unassigned = readList(
    readProperty(object.value, 'unassignedParticipants'),
    'unassignedParticipants',
    (element) => readUuid(element, 'unassigned participant'),
  );
  if (!unassigned.ok) return unassigned;

  return ok({
    teams: teams.value,
    prediction: prediction.value,
    unassigned: unassigned.value,
  });
}

/* -------------------------------------------------------------------------- */
/* The squad's guests                                                         */
/* -------------------------------------------------------------------------- */

export interface SquadGuest {
  readonly membershipId: string;
  readonly displayName: string;
}

/**
 * Parse a `SquadData` body to the squad's active guests. Every member is read
 * (so one malformed member still fails the body), and only active guests are
 * kept; ratings and other member fields are never named.
 */
export function parseSquadGuests(body: unknown): ParseResult<readonly SquadGuest[]> {
  const object = readObject(body, 'squad');
  if (!object.ok) return object;

  const members = readList(readProperty(object.value, 'members'), 'members', (value) => {
    const member = readObject(value, 'member');
    if (!member.ok) return member;

    const membershipId = readUuid(readProperty(member.value, 'membershipId'), 'membershipId');
    if (!membershipId.ok) return membershipId;

    const displayName = readString(readProperty(member.value, 'displayName'), 'displayName');
    if (!displayName.ok) return displayName;

    const isGuest = readBoolean(readProperty(member.value, 'isGuest'), 'isGuest');
    if (!isGuest.ok) return isGuest;

    const state = readOptional(readProperty(member.value, 'state'), 'state', (v, label) =>
      readWireEnumName(v, label, isMembershipState),
    );
    if (!state.ok) return state;

    return ok({
      membershipId: membershipId.value,
      displayName: displayName.value,
      guest: isGuest.value && state.value === 'Active',
    });
  });
  if (!members.ok) return members;

  return ok(
    members.value
      .filter((member) => member.guest)
      .map(({ membershipId, displayName }) => ({ membershipId, displayName })),
  );
}
