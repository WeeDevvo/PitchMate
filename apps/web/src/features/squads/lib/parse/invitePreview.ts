/**
 * The `PreviewInvite` body shape: `{ requiresAuthentication, message }`.
 *
 * This is the one anonymous squads call, and its body deliberately discloses
 * nothing: the backend answers a fixed `requiresAuthentication: true` and a
 * generic instruction that names no squad and no invite, whether or not the
 * presented secret is usable. The parser keeps that property intact by reading
 * exactly those two fields and nothing else — there is no property here from
 * which a screen could infer that a squad exists.
 *
 * `message` is parsed but **not rendered**. Requirement 17.2 forbids surfacing
 * backend wording, so the Invite_Landing_Route shows its own fixed copy from
 * `lib/messages.ts`. The field is read because it is part of the contract and its
 * shape is worth validating; it is not read in order to be displayed.
 *
 * `requiresAuthentication` is a strict boolean rather than a defaulted one. A
 * defaulted `false` would be the dangerous direction: it would say authentication
 * is unnecessary on the strength of a value nobody sent.
 *
 * Requirements: 16.4, 16.5, 16.9, 16.10, 17.2
 */

import {
  ok,
  readBoolean,
  readObject,
  readProperty,
  readString,
  type ParseResult,
} from './primitives';

/** The anonymous preview of an invite: what is required, and the backend's own wording. */
export interface InvitePreview {
  readonly requiresAuthentication: boolean;
  readonly message: string;
}

/**
 * The `PreviewInvite` body parsed into an Invite_Preview.
 *
 * Total over every input and free of exceptions; the result is built last, from
 * two validated readings (Requirement 16.4). Extra properties are never read
 * (16.9).
 *
 * Requirements: 16.4, 16.9
 */
export function parseInvitePreview(body: unknown): ParseResult<InvitePreview> {
  const source = readObject(body, 'invite preview');

  if (!source.ok) {
    return source;
  }

  const requiresAuthentication = readBoolean(
    readProperty(source.value, 'requiresAuthentication'),
    'invite preview requiresAuthentication',
  );

  if (!requiresAuthentication.ok) {
    return requiresAuthentication;
  }

  const message = readString(
    readProperty(source.value, 'message'),
    'invite preview message',
  );

  if (!message.ok) {
    return message;
  }

  return ok({
    requiresAuthentication: requiresAuthentication.value,
    message: message.value,
  });
}

/**
 * An Invite_Preview rendered back into the wire shape
 * {@link parseInvitePreview} accepts.
 *
 * Requirements: 16.5
 */
export function printInvitePreview(preview: InvitePreview): unknown {
  return {
    requiresAuthentication: preview.requiresAuthentication,
    message: preview.message,
  };
}
