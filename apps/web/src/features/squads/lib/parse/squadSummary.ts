/**
 * The `ListMySquads` body shape: one Squad_Summary per squad the caller belongs
 * to, and the pair of membership enum readers the Squad_Detail parser reuses.
 *
 * The wire shape, read from `MySquadSummary` in the backend rather than assumed,
 * is `{ squadId, name, role: name | null, state: name | null }`. Both enum fields
 * are nullable at the source — the handler projects `membership?.Role` and
 * `membership?.State` — which is exactly the case Requirement 16.8 makes a valid
 * parsed **absence** rather than a failure. Getting that wrong in either
 * direction would be visible on the screen: failing the body would empty the
 * Squads_Home for a caller whose membership could not be resolved, and defaulting
 * the absence would put a role on a card that the backend never claimed.
 *
 * A *present* enum field is still validated, now **by name** against the
 * Generated_Enum_Union rather than by looking a number up in a hand-kept code
 * table (Requirement 12.8). An absence is `null` or a missing property and
 * nothing else, so a `role` of `7`, `'owner'` in the wrong case, or `true` fails
 * the summary carrying it rather than reading as "no role" — a value outside the
 * generated vocabulary is a contract mismatch, not an absence (12.8, 16.6).
 *
 * ### The vocabulary is the contract's own
 *
 * A parsed `role` is now a `SquadRole` member name — `Owner`, `Admin`, `Member` —
 * aliased from the Committed_Types rather than named again here (Requirement
 * 12.2), and a parsed `state` is a `MembershipState` name. There is no code table
 * between the wire and the parsed value and no second declaration of either
 * vocabulary, so the printer emits what the parser read and the two cannot drift.
 *
 * The two present-value readers are declared here and imported by
 * `squadDetail.ts`, so a Member_Role accepted on a card and a Member_Role
 * accepted on a Player_Row cannot disagree. What differs between the two shapes
 * is only whether an absence is tolerated, and that decision stays with each
 * field: a summary's `state` may be absent, a member's may not.
 *
 * Requirements: 12.1, 12.5, 12.7, 12.8, 16.4, 16.5, 16.8, 16.9, 16.10
 */

import {
  isMembershipState,
  isSquadRole,
  type MembershipState,
  type SquadRole,
} from '../wireEnums';
import {
  ok,
  readArray,
  readObject,
  readOptional,
  readProperty,
  readString,
  readUuid,
  readWireEnumName,
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
  readonly role: SquadRole | null;
  readonly state: MembershipState | null;
}

/**
 * A present Member_Role read as a Wire_Enum_Name, failing for any value outside
 * the generated `SquadRole` vocabulary (Requirement 12.8).
 *
 * Handed to `readOptional` wherever an absence is tolerated, and called directly
 * wherever it is not — which is why the tolerance is not baked in here. Also
 * imported by `squadDetail.ts`; see the module note.
 */
export const readMemberRoleValue: ValueReader<SquadRole> = (value, label) =>
  readWireEnumName(value, label, isSquadRole);

/**
 * A present Membership_State read as a Wire_Enum_Name, failing for any value
 * outside the generated `MembershipState` vocabulary (Requirement 12.8).
 */
export const readMembershipStateValue: ValueReader<MembershipState> = (
  value,
  label,
) => readWireEnumName(value, label, isMembershipState);

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
 * accepts: exactly the four properties it reads, with each enum as its
 * Wire_Enum_Name and each absence as `null` (Requirements 12.11, 16.5).
 */
export function printSquadSummary(summary: SquadSummary): unknown {
  return {
    squadId: summary.squadId,
    name: summary.name,
    role: summary.role,
    state: summary.state,
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
