/**
 * Response_Parsers for guest claims by claim link (ADR 0003): the issued link,
 * the admins' list of where each guest's claim stands, the preview a player sees
 * before accepting, and the squad named after accepting.
 *
 * The issued link carries a secret. It is parsed into a value for the one-time
 * reveal and nowhere else, exactly like an invite's: no message, attribute or
 * stored value receives it. Instants are read through the shared
 * `readInstantMs`, so a time with no UTC designator fails the body. The first bad
 * member fails the whole body, and a list with one bad row is rejected rather
 * than shown short.
 */

import { isGuestClaimStatus, type GuestClaimStatus } from '../wireEnums';
import {
  ok,
  printInstant,
  readArray,
  readInstantMs,
  readObject,
  readOptional,
  readProperty,
  readString,
  readUuid,
  readWireEnumName,
  type ParseResult,
} from './primitives';

/** A freshly issued claim link, shown once. */
export interface IssuedClaimLink {
  readonly claimId: string;
  readonly redeemableLink: string;
  readonly expiresAtMs: number;
}

/** Where one membership's claim stands. */
export interface GuestClaimRow {
  readonly membershipId: string;
  readonly status: GuestClaimStatus;
  /** When the link stops (or stopped) working; `null` once claimed. */
  readonly expiresAtMs: number | null;
  /** Who accepted, while the claim awaits completion; otherwise `null`. */
  readonly acceptedByName: string | null;
}

/** What a usable claim link is for. */
export interface GuestClaimPreview {
  readonly squadName: string;
  readonly guestDisplayName: string;
}

/** The squad a player just accepted a claim in. */
export interface AcceptedGuestClaim {
  readonly squadName: string;
}

/** Parse an `InitiateGuestClaimResult` body. */
export function parseIssuedClaimLink(body: unknown): ParseResult<IssuedClaimLink> {
  const source = readObject(body, 'issued claim link');
  if (!source.ok) {
    return source;
  }

  const claimId = readUuid(readProperty(source.value, 'claimId'), 'issued claim link claimId');
  if (!claimId.ok) {
    return claimId;
  }

  const redeemableLink = readString(
    readProperty(source.value, 'redeemableLink'),
    'issued claim link redeemableLink',
    { minLength: 1 },
  );
  if (!redeemableLink.ok) {
    return redeemableLink;
  }

  const expiresAtMs = readInstantMs(
    readProperty(source.value, 'expiresAt'),
    'issued claim link expiresAt',
  );
  if (!expiresAtMs.ok) {
    return expiresAtMs;
  }

  return ok({
    claimId: claimId.value,
    redeemableLink: redeemableLink.value,
    expiresAtMs: expiresAtMs.value,
  });
}

/** The wire body a parsed link came from. */
export function printIssuedClaimLink(link: IssuedClaimLink): unknown {
  return {
    claimId: link.claimId,
    redeemableLink: link.redeemableLink,
    expiresAt: printInstant(link.expiresAtMs),
  };
}

/** Parse one `GuestClaimSummary` row. */
export function parseGuestClaimRow(body: unknown): ParseResult<GuestClaimRow> {
  const source = readObject(body, 'guest claim');
  if (!source.ok) {
    return source;
  }

  const membershipId = readUuid(
    readProperty(source.value, 'membershipId'),
    'guest claim membershipId',
  );
  if (!membershipId.ok) {
    return membershipId;
  }

  const status = readWireEnumName(
    readProperty(source.value, 'status'),
    'guest claim status',
    isGuestClaimStatus,
  );
  if (!status.ok) {
    return status;
  }

  const expiresAtMs = readOptional(
    readProperty(source.value, 'expiresAt'),
    'guest claim expiresAt',
    readInstantMs,
  );
  if (!expiresAtMs.ok) {
    return expiresAtMs;
  }

  const acceptedByName = readOptional(
    readProperty(source.value, 'acceptedByName'),
    'guest claim acceptedByName',
    readString,
  );
  if (!acceptedByName.ok) {
    return acceptedByName;
  }

  return ok({
    membershipId: membershipId.value,
    status: status.value,
    expiresAtMs: expiresAtMs.value,
    acceptedByName: acceptedByName.value,
  });
}

/** Parse the whole `ListGuestClaims` body, keeping its order. */
export function parseGuestClaimRows(body: unknown): ParseResult<readonly GuestClaimRow[]> {
  const elements = readArray(body, 'guest claims');
  if (!elements.ok) {
    return elements;
  }

  const rows: GuestClaimRow[] = [];
  for (const element of elements.value) {
    const row = parseGuestClaimRow(element);
    if (!row.ok) {
      return row;
    }
    rows.push(row.value);
  }

  return ok(rows);
}

/** The wire body a parsed list came from. */
export function printGuestClaimRows(rows: readonly GuestClaimRow[]): unknown {
  return rows.map((row) => ({
    membershipId: row.membershipId,
    status: row.status,
    expiresAt: row.expiresAtMs === null ? null : printInstant(row.expiresAtMs),
    acceptedByName: row.acceptedByName,
  }));
}

/** Parse a `GuestClaimPreview` body. */
export function parseGuestClaimPreview(body: unknown): ParseResult<GuestClaimPreview> {
  const source = readObject(body, 'guest claim preview');
  if (!source.ok) {
    return source;
  }

  const squadName = readString(readProperty(source.value, 'squadName'), 'guest claim preview squadName');
  if (!squadName.ok) {
    return squadName;
  }

  const guestDisplayName = readString(
    readProperty(source.value, 'guestDisplayName'),
    'guest claim preview guestDisplayName',
  );
  if (!guestDisplayName.ok) {
    return guestDisplayName;
  }

  return ok({ squadName: squadName.value, guestDisplayName: guestDisplayName.value });
}

/** Parse an `AcceptGuestClaimResult` body. */
export function parseAcceptedGuestClaim(body: unknown): ParseResult<AcceptedGuestClaim> {
  const source = readObject(body, 'accepted guest claim');
  if (!source.ok) {
    return source;
  }

  const squadName = readString(readProperty(source.value, 'squadName'), 'accepted guest claim squadName');
  if (!squadName.ok) {
    return squadName;
  }

  return ok({ squadName: squadName.value });
}
