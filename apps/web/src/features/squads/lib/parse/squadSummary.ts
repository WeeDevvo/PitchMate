/**
 * The `ListMySquads` body shape: one Squad_Summary per squad the caller belongs
 * to, and the pair of membership enum readers the Squad_Detail parser reuses.
 *
 * The wire shape, read from `MySquadSummary` in the backend rather than assumed,
 * is `{ squadId, name, role: int | null, state: int | null }`. Both enum fields
 * are nullable at the source — the handler projects `membership?.Role` and
 * `membership?.State` — which is exactly the case Requirement 16.8 makes a valid
 * parsed **absence** rather than a failure. Getting that wrong in either
 * direction would be visible on the screen: failing the body would empty the
 * Squads_Home for a caller whose membership could not be resolved, and defaulting
 * the absence would put a role on a card that the backend never claimed.
 *
 * A *present* enum field is still validated. An absence is `null` or a missing
 * property and nothing else, so a `role` of `7`, `'owner'`, or `true` fails the
 * summary carrying it rather than reading as "no role" — an unnamed code is a
 * contract mismatch, not an absence (16.6).
 *
 * The two present-value readers are declared here and imported by
 * `squadDetail.ts`, so a Member_Role accepted on a card and a Member_Role
 * accepted on a Player_Row cannot disagree. What differs between the two shapes
 * is only whether an absence is tolerated, and that decision stays with each
 * field: a summary's `state` may be absent, a member's may not.
 *
 * Requirements: 16.4, 16.5, 16.6, 16.8, 16.9, 16.10
 */

import {
  codeFromMemberRole,
  codeFromMembershipState,
  memberRoleFromCode,
  membershipStateFromCode,
  type MemberRole,
  type MembershipStateValue,
} from '../enumCodes';
import {
  fail,
  ok,
  readArray,
  readObject,
  readOptional,
  readProperty,
  readString,
  readUuid,
  type ParseResult,
  type ValueReader,
} from './primitives';

/**
 * One squad in the caller's own squad listing. `role` and `state` are `null`
 * whenever the backend sent no membership for the caller (Requirement 16.8).
 */
export interface SquadSummary {
  readonly squadId: string;
  readonly name: string;
  readonly role: MemberRole | null;
  readonly state: MembershipStateValue | null;
}

/**
 * A present Member_Role code read as its named value, failing when the
 * Enum_Code_Map names no such code (Requirement 16.6).
 *
 * Handed to `readOptional` wherever an absence is tolerated, and called directly
 * wherever it is not — which is why the tolerance is not baked in here. Also
 * imported by `squadDetail.ts`; see the module note.
 */
export const readMemberRoleValue: ValueReader<MemberRole> = (value, label) => {
  const role = memberRoleFromCode(value);

  if (role === undefined) {
    return fail(`${label} names no role`);
  }

  return ok(role);
};

/**
 * A present Membership_State code read as its named value, failing when the
 * Enum_Code_Map names no such code (Requirement 16.6).
 */
export const readMembershipStateValue: ValueReader<MembershipStateValue> = (
  value,
  label,
) => {
  const state = membershipStateFromCode(value);

  if (state === undefined) {
    return fail(`${label} names no membership state`);
  }

  return ok(state);
};

/**
 * One Squad_Summary parsed from a `ListMySquads` element.
 *
 * Total over every input and free of exceptions. The result is built **last**,
 * from four readings already known to be valid, so a bad field yields a failure
 * rather than a summary with that field defaulted or dropped (Requirement 16.4).
 * Properties this parser does not name are never read, so a body carrying extra
 * ones parses to the same value (16.9).
 *
 * Requirements: 16.4, 16.8, 16.9
 */
export function parseSquadSummary(body: unknown): ParseResult<SquadSummary> {
  const source = readObject(body, 'squad summary');

  if (!source.ok) {
    return source;
  }

  const squadId = readUuid(
    readProperty(source.value, 'squadId'),
    'squad summary squadId',
  );

  if (!squadId.ok) {
    return squadId;
  }

  const name = readString(readProperty(source.value, 'name'), 'squad summary name');

  if (!name.ok) {
    return name;
  }

  // 16.8: `null` and an absent property are the same absence and both parse.
  const role = readOptional(
    readProperty(source.value, 'role'),
    'squad summary role',
    readMemberRoleValue,
  );

  if (!role.ok) {
    return role;
  }

  const state = readOptional(
    readProperty(source.value, 'state'),
    'squad summary state',
    readMembershipStateValue,
  );

  if (!state.ok) {
    return state;
  }

  return ok({
    squadId: squadId.value,
    name: name.value,
    role: role.value,
    state: state.value,
  });
}

/**
 * The whole `ListMySquads` body: an array of Squad_Summary values.
 *
 * One bad element fails the **body**, not just that element. A squads listing
 * silently missing a squad would be worse than a failure a person can retry:
 * the Squads_Home would render a complete-looking list that omits a squad the
 * caller belongs to, with nothing on screen saying so.
 *
 * Requirements: 16.4
 */
export function parseSquadSummaryList(
  body: unknown,
): ParseResult<readonly SquadSummary[]> {
  const elements = readArray(body, 'squad summary list');

  if (!elements.ok) {
    return elements;
  }

  const summaries: SquadSummary[] = [];

  for (const element of elements.value) {
    const summary = parseSquadSummary(element);

    if (!summary.ok) {
      return summary;
    }

    summaries.push(summary.value);
  }

  return ok(summaries);
}

/**
 * A Squad_Summary rendered back into the wire shape {@link parseSquadSummary}
 * accepts: exactly the four properties it reads, with each enum as its code and
 * each absence as `null` (Requirement 16.5).
 */
export function printSquadSummary(summary: SquadSummary): unknown {
  return {
    squadId: summary.squadId,
    name: summary.name,
    role: summary.role === null ? null : codeFromMemberRole(summary.role),
    state: summary.state === null ? null : codeFromMembershipState(summary.state),
  };
}

/**
 * A squads listing rendered back into the wire shape
 * {@link parseSquadSummaryList} accepts.
 *
 * Requirements: 16.5
 */
export function printSquadSummaryList(
  summaries: readonly SquadSummary[],
): unknown {
  return summaries.map(printSquadSummary);
}
