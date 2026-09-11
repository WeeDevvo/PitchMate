/**
 * The `GenerateInvite` body shape:
 * `{ inviteId, redeemableLink, code, expiresAt: string | null }`.
 *
 * This is the only response in the feature that carries an Invite_Secret, and it
 * carries it exactly once — the backend stores only a one-way hash, so nothing
 * can re-read the link or the code afterwards. That shapes two decisions here:
 *
 *  - **Both secret-bearing fields are required.** A body missing either is a
 *    failure rather than a partially useful value, because an Invite_Reveal that
 *    presented a link without its code (or the reverse) would be a surface a
 *    person cannot recover from — the value is gone, and only generating another
 *    invite can replace it.
 *  - **No failure reason names a value.** Reasons here are composed from literal
 *    labels only, exactly as `primitives.ts` requires, so a malformed body can
 *    never put an Invite_Secret into a reason that travels into a log
 *    (Requirement 4.10).
 *
 * `redeemableLink` is read as a plain string rather than validated as a URL. The
 * backend builds `https://pitch-mate.co.uk/join/{token}` and the redemption path
 * extracts the token from the final segment (`lib/inviteSecret.ts` owns that
 * extraction). Re-deriving a URL grammar here would put a second opinion about
 * the link's shape in a second place, and a link this parser rejected would
 * destroy a secret that had already been issued.
 *
 * `expiresAt` is `null` for a non-expiring invite — an absence with meaning, not
 * a missing value — and is normalised to epoch milliseconds so the Invite_Manager
 * compares instants rather than strings.
 *
 * Requirements: 4.10, 16.4, 16.5, 16.9, 16.10
 */

import {
  ok,
  printInstant,
  readInstantMs,
  readObject,
  readOptional,
  readProperty,
  readString,
  readUuid,
  type ParseResult,
} from './primitives';

/**
 * A freshly generated invite, including the secret-bearing link and code the
 * backend returns exactly once. `expiresAtMs` is `null` for a non-expiring
 * invite.
 */
export interface GeneratedInvite {
  readonly inviteId: string;
  readonly redeemableLink: string;
  readonly code: string;
  readonly expiresAtMs: number | null;
}

/**
 * The `GenerateInvite` body parsed into a Generated_Invite.
 *
 * Total over every input and free of exceptions; the result is built last, from
 * four validated readings (Requirement 16.4). Extra properties are never read
 * (16.9).
 *
 * Requirements: 16.4, 16.9
 */
export function parseGeneratedInvite(body: unknown): ParseResult<GeneratedInvite> {
  const source = readObject(body, 'generated invite');

  if (!source.ok) {
    return source;
  }

  const inviteId = readUuid(
    readProperty(source.value, 'inviteId'),
    'generated invite inviteId',
  );

  if (!inviteId.ok) {
    return inviteId;
  }

  const redeemableLink = readString(
    readProperty(source.value, 'redeemableLink'),
    'generated invite redeemableLink',
    { minLength: 1 },
  );

  if (!redeemableLink.ok) {
    return redeemableLink;
  }

  const code = readString(readProperty(source.value, 'code'), 'generated invite code', {
    minLength: 1,
  });

  if (!code.ok) {
    return code;
  }

  // `null` or absent is a non-expiring invite, which is a meaningful absence
  // rather than a missing value.
  const expiresAtMs = readOptional(
    readProperty(source.value, 'expiresAt'),
    'generated invite expiresAt',
    readInstantMs,
  );

  if (!expiresAtMs.ok) {
    return expiresAtMs;
  }

  return ok({
    inviteId: inviteId.value,
    redeemableLink: redeemableLink.value,
    code: code.value,
    expiresAtMs: expiresAtMs.value,
  });
}

/**
 * A Generated_Invite rendered back into the wire shape
 * {@link parseGeneratedInvite} accepts: the expiry as ISO-8601 with an explicit
 * `Z`, or `null` for a non-expiring invite.
 *
 * Requirements: 16.5
 */
export function printGeneratedInvite(invite: GeneratedInvite): unknown {
  return {
    inviteId: invite.inviteId,
    redeemableLink: invite.redeemableLink,
    code: invite.code,
    expiresAt: invite.expiresAtMs === null ? null : printInstant(invite.expiresAtMs),
  };
}
