/**
 * The `ListInvites` body shape:
 * `[{ inviteId, state: int, createdAt, createdBy: string | null, expiresAt: string | null }]`.
 *
 * An invite summary deliberately carries **nothing** from which the redeemable
 * secret could be reconstructed — the backend's `InviteSummary` exposes neither
 * the token nor its hash — so this parser names five properties and no more.
 *
 * Three field decisions are worth stating:
 *
 *  - **`state` is required**, and an unnamed code fails the body (Requirement
 *    16.6). The Invite_Manager renders a revoke control only on an `active`
 *    invite, so a defaulted state could offer revocation on an invite that is
 *    already revoked or expired — or hide it from one that is live.
 *  - **`createdAt` is required**, because the Invite_Order sorts by it: descending
 *    creation instant with ties broken by identity (Requirement 11.3). An invented
 *    instant would silently reorder the list.
 *  - **`createdBy` is a free-form optional string, not an identity.** The backend
 *    stamps it from its audit actor and documents `null` for a system operation,
 *    so reading it as a UUID would fail bodies the backend legitimately sends.
 *
 * `expiresAt` is `null` for a non-expiring invite, and both instants are
 * normalised to epoch milliseconds so ordering and expiry presentation compare
 * numbers rather than strings.
 *
 * Requirements: 11.3, 16.4, 16.5, 16.6, 16.9, 16.10
 */

import {
  codeFromInviteState,
  inviteStateFromCode,
  type InviteStateValue,
} from '../enumCodes';
import {
  fail,
  ok,
  printInstant,
  readArray,
  readInstantMs,
  readObject,
  readOptional,
  readProperty,
  readString,
  readUuid,
  type ParseResult,
  type ValueReader,
} from './primitives';

/**
 * One invite as an owner or admin sees it. `expiresAtMs` is `null` for a
 * non-expiring invite; `createdBy` is `null` for a system operation.
 */
export interface InviteSummary {
  readonly inviteId: string;
  readonly state: InviteStateValue;
  readonly createdAtMs: number;
  readonly createdBy: string | null;
  readonly expiresAtMs: number | null;
}

/**
 * A present Invite_State code read as its named value, failing when the
 * Enum_Code_Map names no such code (Requirement 16.6).
 *
 * `expired` is derived by the backend clock and arrives like any other state, so
 * this feature does no expiry arithmetic of its own.
 */
const readInviteStateValue: ValueReader<InviteStateValue> = (value, label) => {
  const state = inviteStateFromCode(value);

  if (state === undefined) {
    return fail(`${label} names no invite state`);
  }

  return ok(state);
};

/**
 * One Invite_Summary parsed from a `ListInvites` element.
 *
 * Total over every input and free of exceptions; the result is built last, from
 * five validated readings (Requirement 16.4). Extra properties are never read
 * (16.9).
 *
 * Requirements: 16.4, 16.6, 16.9
 */
export function parseInviteSummary(body: unknown): ParseResult<InviteSummary> {
  const source = readObject(body, 'invite summary');

  if (!source.ok) {
    return source;
  }

  const inviteId = readUuid(
    readProperty(source.value, 'inviteId'),
    'invite summary inviteId',
  );

  if (!inviteId.ok) {
    return inviteId;
  }

  const state = readInviteStateValue(
    readProperty(source.value, 'state'),
    'invite summary state',
  );

  if (!state.ok) {
    return state;
  }

  const createdAtMs = readInstantMs(
    readProperty(source.value, 'createdAt'),
    'invite summary createdAt',
  );

  if (!createdAtMs.ok) {
    return createdAtMs;
  }

  // An audit actor string, `null` for a system operation — not an identity.
  const createdBy = readOptional(
    readProperty(source.value, 'createdBy'),
    'invite summary createdBy',
    readString,
  );

  if (!createdBy.ok) {
    return createdBy;
  }

  const expiresAtMs = readOptional(
    readProperty(source.value, 'expiresAt'),
    'invite summary expiresAt',
    readInstantMs,
  );

  if (!expiresAtMs.ok) {
    return expiresAtMs;
  }

  return ok({
    inviteId: inviteId.value,
    state: state.value,
    createdAtMs: createdAtMs.value,
    createdBy: createdBy.value,
    expiresAtMs: expiresAtMs.value,
  });
}

/**
 * The whole `ListInvites` body.
 *
 * One bad element fails the body. An invite quietly dropped from the list is an
 * invite an admin cannot revoke, which is the outcome least worth risking on a
 * surface whose purpose is controlling who can join.
 *
 * Requirements: 16.4
 */
export function parseInviteSummaryList(
  body: unknown,
): ParseResult<readonly InviteSummary[]> {
  const elements = readArray(body, 'invite summary list');

  if (!elements.ok) {
    return elements;
  }

  const summaries: InviteSummary[] = [];

  for (const element of elements.value) {
    const summary = parseInviteSummary(element);

    if (!summary.ok) {
      return summary;
    }

    summaries.push(summary.value);
  }

  return ok(summaries);
}

/**
 * An Invite_Summary rendered back into the wire shape
 * {@link parseInviteSummary} accepts: the state as its code, both instants as
 * ISO-8601 with an explicit `Z`, and each absence as `null`.
 *
 * Requirements: 16.5
 */
export function printInviteSummary(summary: InviteSummary): unknown {
  return {
    inviteId: summary.inviteId,
    state: codeFromInviteState(summary.state),
    createdAt: printInstant(summary.createdAtMs),
    createdBy: summary.createdBy,
    expiresAt: summary.expiresAtMs === null ? null : printInstant(summary.expiresAtMs),
  };
}

/**
 * An invite listing rendered back into the wire shape
 * {@link parseInviteSummaryList} accepts.
 *
 * Requirements: 16.5
 */
export function printInviteSummaryList(
  summaries: readonly InviteSummary[],
): unknown {
  return summaries.map(printInviteSummary);
}
