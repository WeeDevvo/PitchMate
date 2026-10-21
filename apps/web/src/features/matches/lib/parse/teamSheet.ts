/**
 * The parser for `GetTeamSheet` (`GET /matches/{matchId}/team-sheet`).
 *
 * The contract marks every member optional, but a sheet is only produced once a
 * kickoff lineup exists, and one without its time, place or teams would be no
 * team sheet at all. So each member is required here, and a body missing one
 * fails rather than rendering a partial sheet.
 */
import {
  fail,
  ok,
  readArray,
  readBoolean,
  readInstantMs,
  readObject,
  readProperty,
  readString,
  readUuid,
  type ParseResult,
} from '../../../../wire';
import type { RosterEntry } from './teams';

export interface TeamSheetTeam {
  readonly teamName: string;
  readonly bibFlag: boolean;
  readonly roster: readonly RosterEntry[];
}

export interface TeamSheet {
  readonly location: string;
  readonly kickoffMs: number;
  readonly teams: readonly TeamSheetTeam[];
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

function parseTeam(value: unknown): ParseResult<TeamSheetTeam> {
  const object = readObject(value, 'team');
  if (!object.ok) return object;

  const teamName = readString(readProperty(object.value, 'teamName'), 'teamName');
  if (!teamName.ok) return teamName;

  const bibFlag = readBoolean(readProperty(object.value, 'bibFlag'), 'bibFlag');
  if (!bibFlag.ok) return bibFlag;

  const entries = readArray(readProperty(object.value, 'roster'), 'roster');
  if (!entries.ok) return entries;

  const roster: RosterEntry[] = [];
  for (const entry of entries.value) {
    const parsed = parseRosterEntry(entry);
    if (!parsed.ok) return fail(`roster element: ${parsed.reason}`);
    roster.push(parsed.value);
  }

  return ok({ teamName: teamName.value, bibFlag: bibFlag.value, roster });
}

/** Parse a `TeamSheet` body. */
export function parseTeamSheet(body: unknown): ParseResult<TeamSheet> {
  const object = readObject(body, 'team sheet');
  if (!object.ok) return object;

  const location = readString(readProperty(object.value, 'location'), 'location');
  if (!location.ok) return location;

  const kickoff = readInstantMs(readProperty(object.value, 'confirmedDay'), 'confirmedDay');
  if (!kickoff.ok) return kickoff;

  const entries = readArray(readProperty(object.value, 'teams'), 'teams');
  if (!entries.ok) return entries;

  const teams: TeamSheetTeam[] = [];
  for (const entry of entries.value) {
    const parsed = parseTeam(entry);
    if (!parsed.ok) return fail(`teams element: ${parsed.reason}`);
    teams.push(parsed.value);
  }

  return ok({ location: location.value, kickoffMs: kickoff.value, teams });
}
