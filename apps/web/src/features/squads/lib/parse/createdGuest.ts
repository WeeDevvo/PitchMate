/**
 * The `CreateGuest` body shape: `{ guestMembershipId }`.
 *
 * One identity, and it is the created guest's membership — not a user identity,
 * because a guest has no account. The Squad_Screen re-reads the squad after a
 * successful creation rather than splicing the guest into the rendered list, so
 * this value is read for the outcome it confirms rather than for a row it fills;
 * a body without a well-formed identity is still a failure, because "created" is
 * a claim this feature should only make about a guest the backend named.
 *
 * The one field is an identity, so this shape carries **no enum-valued field**:
 * the named-enum reading of Requirement 12.8 has nothing to apply to here, and
 * the module is unchanged by that migration rather than exempt from it. The
 * Skill_Tier an admin seeds a guest with is a *request* field, typed from the
 * contract by the transport facade, and never comes back in this body.
 *
 * Requirements: 12.5, 12.7, 16.4, 16.5, 16.9, 16.10
 */

import { ok, readObject, readProperty, readUuid, type ParseResult } from './primitives';

/** The outcome of creating a guest: the created guest membership's identity. */
export interface CreatedGuest {
  readonly guestMembershipId: string;
}

/**
 * The `CreateGuest` body parsed into a Created_Guest.
 *
 * Total over every input and free of exceptions (Requirement 16.4). Extra
 * properties are never read (16.9).
 *
 * Requirements: 16.4, 16.9
 */
export function parseCreatedGuest(body: unknown): ParseResult<CreatedGuest> {
  const source = readObject(body, 'created guest');

  if (!source.ok) {
    return source;
  }

  const guestMembershipId = readUuid(
    readProperty(source.value, 'guestMembershipId'),
    'created guest guestMembershipId',
  );

  if (!guestMembershipId.ok) {
    return guestMembershipId;
  }

  return ok({ guestMembershipId: guestMembershipId.value });
}

/**
 * A Created_Guest rendered back into the wire shape {@link parseCreatedGuest}
 * accepts.
 *
 * Requirements: 16.5
 */
export function printCreatedGuest(created: CreatedGuest): unknown {
  return { guestMembershipId: created.guestMembershipId };
}
