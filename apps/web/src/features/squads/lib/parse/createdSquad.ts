/**
 * The `CreateSquad` body shape: `{ squadId, ownerMembershipId }`.
 *
 * Both identities matter to what happens next. The Squads_Home navigates to the
 * created squad on `squadId`, so a body without a well-formed one is a failure
 * rather than a success a screen cannot act on — a "created" outcome followed by
 * no navigation would leave a person unsure whether the squad exists.
 * `ownerMembershipId` is read for the same reason it is sent: it identifies the
 * caller's own membership in the new squad.
 *
 * Requirements: 16.4, 16.5, 16.9, 16.10
 */

import { ok, readObject, readProperty, readUuid, type ParseResult } from './primitives';

/** The outcome of creating a squad: the squad, and the caller's owner membership. */
export interface CreatedSquad {
  readonly squadId: string;
  readonly ownerMembershipId: string;
}

/**
 * The `CreateSquad` body parsed into a Created_Squad.
 *
 * Total over every input and free of exceptions; the result is built last, from
 * two validated readings (Requirement 16.4). Extra properties are never read
 * (16.9).
 *
 * Requirements: 16.4, 16.9
 */
export function parseCreatedSquad(body: unknown): ParseResult<CreatedSquad> {
  const source = readObject(body, 'created squad');

  if (!source.ok) {
    return source;
  }

  const squadId = readUuid(
    readProperty(source.value, 'squadId'),
    'created squad squadId',
  );

  if (!squadId.ok) {
    return squadId;
  }

  const ownerMembershipId = readUuid(
    readProperty(source.value, 'ownerMembershipId'),
    'created squad ownerMembershipId',
  );

  if (!ownerMembershipId.ok) {
    return ownerMembershipId;
  }

  return ok({
    squadId: squadId.value,
    ownerMembershipId: ownerMembershipId.value,
  });
}

/**
 * A Created_Squad rendered back into the wire shape {@link parseCreatedSquad}
 * accepts.
 *
 * Requirements: 16.5
 */
export function printCreatedSquad(created: CreatedSquad): unknown {
  return {
    squadId: created.squadId,
    ownerMembershipId: created.ownerMembershipId,
  };
}
