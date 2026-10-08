/**
 * The `RedeemInvite` body shape — the one operation with **two** valid wire
 * forms.
 *
 * A redemption that joins or reactivates a membership returns
 * `{ membershipId, outcome }`. The already-a-member no-op used to return `200`
 * with an **empty body**, which the transport seam hands to this parser as an
 * absence; the contract now declares one body for that status and reports the
 * no-op as the `AlreadyMember` outcome (Requirement 6.4). The empty form stays
 * accepted, because a success a client can no longer read is the one outcome
 * least worth risking here.
 * Both are successful redemptions, so both parse: failing the empty body would
 * turn "you are already in this squad" into the Generic_Squads_Failure, telling a
 * person their invite did not work when in fact nothing needed doing.
 *
 * Every field is therefore optional, and the parsed value carries three
 * absences for the no-op form. `squadId` is optional for a different reason: the
 * backend **does not send it at all** today (`RedeemInviteResult` carries only the
 * membership and the outcome). Requirements 4.6 and 5.8 describe a branch that
 * navigates straight to a redeemed squad when a redemption yields a squad
 * identity, and that branch stays implemented against this field — but the
 * fallback path, navigating to the Squads_Home and re-listing, is the *normal*
 * path today rather than an edge case. Reading a field the backend may add later
 * costs nothing now and keeps the screens from needing a change when it lands.
 *
 * A *present* field is still validated: a `membershipId` that is not an identity,
 * or an `outcome` outside the generated `RedeemOutcome` vocabulary, fails the
 * body. Optional means absent-or-valid, never unvalidated.
 *
 * Requirements: 4.6, 5.8, 12.8, 16.4, 16.5, 16.6, 16.9, 16.10
 */

import { isRedeemOutcome, type RedeemOutcome } from '../wireEnums';
import {
  ok,
  readObject,
  readOptional,
  readProperty,
  readUuid,
  readWireEnumName,
  type ParseResult,
} from './primitives';

/**
 * The outcome of redeeming an invite. Every field is `null` for the
 * already-a-member no-op, which the backend answers with an empty body;
 * `squadId` is `null` for every redemption the backend performs today.
 */
export interface Redemption {
  readonly membershipId: string | null;
  readonly outcome: RedeemOutcome | null;
  readonly squadId: string | null;
}

/** The parsed value of the no-op form, shared so the absence has one shape. */
const EMPTY_REDEMPTION: Redemption = {
  membershipId: null,
  outcome: null,
  squadId: null,
};

/**
 * The `RedeemInvite` body parsed into a Redemption, accepting both the
 * identity-bearing form and the empty body of the already-a-member no-op.
 *
 * Total over every input and free of exceptions; the result is built last, from
 * three validated readings (Requirement 16.4). Extra properties are never read
 * (16.9).
 *
 * Requirements: 16.4, 16.6, 16.9
 */
export function parseRedemption(body: unknown): ParseResult<Redemption> {
  // The already-a-member no-op: `200` with no body, which the seam passes on as an
  // absence. An empty object reaches the same value through the readings below.
  if (body === undefined || body === null) {
    return ok(EMPTY_REDEMPTION);
  }

  const source = readObject(body, 'redemption');

  if (!source.ok) {
    return source;
  }

  const membershipId = readOptional(
    readProperty(source.value, 'membershipId'),
    'redemption membershipId',
    readUuid,
  );

  if (!membershipId.ok) {
    return membershipId;
  }

  // 12.8: a present outcome is a member name of the generated `RedeemOutcome`
  // union — the enum whose implicit 0-based numbering used to make a code table
  // the most dangerous reading in the feature. By name there is nothing to get
  // off by one.
  const outcome = readOptional(
    readProperty(source.value, 'outcome'),
    'redemption outcome',
    (field, fieldLabel) => readWireEnumName(field, fieldLabel, isRedeemOutcome),
  );

  if (!outcome.ok) {
    return outcome;
  }

  // Not sent by the backend today; read so the direct-navigation branch of
  // Requirements 4.6 and 5.8 needs no change when it is.
  const squadId = readOptional(
    readProperty(source.value, 'squadId'),
    'redemption squadId',
    readUuid,
  );

  if (!squadId.ok) {
    return squadId;
  }

  return ok({
    membershipId: membershipId.value,
    outcome: outcome.value,
    squadId: squadId.value,
  });
}

/**
 * A Redemption rendered back into a wire shape {@link parseRedemption} accepts:
 * the three properties it reads, each absence as `null`.
 *
 * The no-op form prints as three nulls rather than as an absent body, because a
 * printer's contract is to produce a value the parser accepts and both readings
 * yield the same Redemption — printing an object keeps this a single code path
 * while leaving the round trip exact (Requirement 16.5).
 *
 * Requirements: 12.11, 16.5
 */
export function printRedemption(redemption: Redemption): unknown {
  return {
    membershipId: redemption.membershipId,
    outcome: redemption.outcome,
    squadId: redemption.squadId,
  };
}
