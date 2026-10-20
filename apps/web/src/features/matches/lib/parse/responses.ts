/**
 * The parsers for the Matches_Feature's smaller bodies: the availability tally,
 * the created draft, and the caller's standing in a squad.
 */
import {
  fail,
  ok,
  readArray,
  readCount,
  readInstantMs,
  readObject,
  readOptional,
  readProperty,
  readUuid,
  readWireEnumName,
  type ParseResult,
} from '../../../../wire';
import {
  isMembershipState,
  isSquadRole,
  type MembershipState,
  type SquadRole,
} from '../wireEnums';

/* -------------------------------------------------------------------------- */
/* Availability tally                                                         */
/* -------------------------------------------------------------------------- */

/** How many members can make one candidate day. */
export interface DayTally {
  readonly dayMs: number;
  readonly count: number;
}

/**
 * Parse an `AvailabilityTally` body. The contract types `days` as nullable, so
 * an absent or `null` list reads as no days rather than as a failure; members'
 * identities (`availableMemberIds`) are never read.
 */
export function parseAvailabilityTally(body: unknown): ParseResult<readonly DayTally[]> {
  const object = readObject(body, 'availability tally');
  if (!object.ok) return object;

  const days = readOptional(readProperty(object.value, 'days'), 'days', readArray);
  if (!days.ok) return days;

  const tallies: DayTally[] = [];
  for (const entry of days.value ?? []) {
    const day = readObject(entry, 'day tally');
    if (!day.ok) return fail(`days element: ${day.reason}`);

    const instant = readInstantMs(readProperty(day.value, 'day'), 'day');
    if (!instant.ok) return fail(`days element: ${instant.reason}`);

    const count = readCount(readProperty(day.value, 'count'), 'count');
    if (!count.ok) return fail(`days element: ${count.reason}`);

    tallies.push({ dayMs: instant.value, count: count.value });
  }

  return ok(tallies);
}

/* -------------------------------------------------------------------------- */
/* Created draft                                                              */
/* -------------------------------------------------------------------------- */

/** Parse a `CreateMatchDraftResult` body to the new match's identity. */
export function parseCreatedDraft(body: unknown): ParseResult<string> {
  const object = readObject(body, 'created draft');
  if (!object.ok) return object;

  return readUuid(readProperty(object.value, 'matchId'), 'matchId');
}

/* -------------------------------------------------------------------------- */
/* The caller's standing in a squad                                           */
/* -------------------------------------------------------------------------- */

/** The caller's role and membership state in one squad, either possibly absent. */
export interface SquadStanding {
  readonly squadId: string;
  readonly role: SquadRole | null;
  readonly state: MembershipState | null;
}

function parseStanding(value: unknown): ParseResult<SquadStanding> {
  const object = readObject(value, 'squad summary');
  if (!object.ok) return object;
  const source = object.value;

  const squadId = readUuid(readProperty(source, 'squadId'), 'squadId');
  if (!squadId.ok) return squadId;

  const role = readOptional(readProperty(source, 'role'), 'role', (value, label) =>
    readWireEnumName(value, label, isSquadRole),
  );
  if (!role.ok) return role;

  const state = readOptional(readProperty(source, 'state'), 'state', (value, label) =>
    readWireEnumName(value, label, isMembershipState),
  );
  if (!state.ok) return state;

  return ok({ squadId: squadId.value, role: role.value, state: state.value });
}

/** Parse a `ListMySquads` body to the caller's standing in each squad. */
export function parseSquadStandings(
  body: unknown,
): ParseResult<readonly SquadStanding[]> {
  const entries = readArray(body, 'squads');
  if (!entries.ok) return entries;

  const standings: SquadStanding[] = [];
  for (const entry of entries.value) {
    const standing = parseStanding(entry);
    if (!standing.ok) return fail(`squads element: ${standing.reason}`);
    standings.push(standing.value);
  }

  return ok(standings);
}
