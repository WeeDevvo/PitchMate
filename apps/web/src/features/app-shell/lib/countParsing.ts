/**
 * The App_Shell's count-envelope parser and printer.
 *
 * Two notification responses carry nothing but a count: the unread-count
 * response and the mark-all-read response. Both are now **named objects** rather
 * than bare JSON numbers — `UnreadCountResponse { count }` and
 * `MarkAllReadResponse { markedCount }` (Requirement 7.1, 7.2) — so the
 * App_Shell reads the named member of an object body (Requirement 7.6) instead
 * of taking the body itself as the number.
 *
 * The envelope changed; the rule about the value inside it did not.
 * {@link parseNonNegativeInteger} is still the **one** value-level rule behind
 * both responses (app-shell Requirement 10.9): a non-negative integer from 0 to
 * 2,147,483,647 inclusive, or a parse-failure. The two envelope parsers differ
 * only in the member name they read, so there is no second notion of an
 * acceptable count.
 *
 * Everything that is not an integer in that range is rejected, explicitly
 * including an absent member, `null`, an array, an object, a string (a *numeric*
 * string included — `'7'` is not a number), a boolean, and a number that is not
 * an integer. `NaN`, `Infinity`, and `-Infinity` are not integers and so are
 * rejected too. A body that is not an object at all — a bare number included,
 * which is what the previous contract sent — is a parse-failure, which is the
 * point of the change: the old wire form no longer parses, so a half-migrated
 * client fails loudly rather than reading a number that no longer means what it
 * used to.
 *
 * **All or nothing** (Requirement 12.5, 12.7): a body yields either a fully
 * read count or the parse-failure outcome. Nothing is clamped, defaulted,
 * coerced, or repaired, and the App_Shell treats a parse-failure as a failed
 * call, so an unschematised body takes the Generic_Notification_Failure path
 * rather than becoming a nonsense badge.
 *
 * **Total** (Requirements 12.6, 10.12): every input yields one of the two
 * outcomes and raises no exception, including a value nested a hundred levels
 * deep. Totality is structural rather than defensive — the parser establishes
 * that the body is a plain object, reads one named property through a guarded
 * read, and then applies `typeof` and arithmetic comparisons to the value it
 * found. It never walks an interior, so depth costs one type test, and it never
 * converts a value to a string or a number, so a hostile `toString` or
 * `valueOf` never runs. The one operation an arbitrary input could make raise is
 * the read of a property defined as a throwing accessor, which is guarded: such
 * a member reads as absent and so fails the body carrying it.
 *
 * **Additive-change tolerant**: only the member a parser names is ever read, so
 * a property added to either response later cannot fail a body.
 *
 * Each parser has a printer counterpart ({@link printUnreadCountResponse},
 * {@link printMarkAllReadResponse}) that renders a count back into the wire
 * shape its parser accepts, which is what the round-trip property is written
 * over (Requirement 12.11).
 *
 * This module is React-free and DOM-free like every module under `lib/`
 * (Requirements 14.16, 15.5), and imports nothing at all.
 *
 * Requirements: 7.6, 10.9, 10.12, 12.5, 12.6, 12.7, 12.10, 12.11
 */

/**
 * The largest count the parser accepts: `2 ** 31 - 1`, the upper bound of the
 * backend's signed 32-bit integer count (Requirement 10.9). A value one greater
 * is a parse-failure.
 */
export const MAX_COUNT_VALUE = 2_147_483_647;

/**
 * The smallest count the parser accepts. A count is never negative, so `-1` is a
 * parse-failure rather than a clamped zero (Requirement 10.9).
 */
export const MIN_COUNT_VALUE = 0;

/**
 * The member name `UnreadCountResponse` carries the count in (Requirement 7.1).
 * Declared once here so the parser, the printer, and their tests cannot disagree
 * about it.
 */
export const UNREAD_COUNT_MEMBER = 'count';

/**
 * The member name `MarkAllReadResponse` carries the count in
 * (Requirement 7.2) — distinct from the unread-count member, because the two
 * responses answer different questions.
 */
export const MARK_ALL_READ_MEMBER = 'markedCount';

/**
 * The outcome of parsing a count response body: exactly one non-negative
 * integer, or the parse-failure outcome (Requirements 10.9, 10.12, 12.5).
 *
 * This is the same one-outcome shape convention the notification list parser
 * uses — a tagged union whose failure arm carries no value — so a caller can
 * never read a parsed value it has not first proved is there.
 */
export type CountParse =
  | { readonly kind: 'parsed'; readonly value: number }
  | { readonly kind: 'parse-failure' };

/** The one parse-failure value, shared so callers can compare cheaply. */
const PARSE_FAILURE: CountParse = { kind: 'parse-failure' };

/**
 * Parse a count value into a non-negative integer — the single value-level rule
 * behind both count responses (Requirement 10.9).
 *
 * Total over every input and free of exceptions (Requirement 10.12).
 *
 * @param value the member read from a count response body, unasserted
 * @returns the parsed count for an integer in
 *   {@link MIN_COUNT_VALUE}..{@link MAX_COUNT_VALUE} inclusive, otherwise the
 *   parse-failure outcome
 *
 * Requirements: 10.9, 10.12
 */
export function parseNonNegativeInteger(value: unknown): CountParse {
  // 10.9: anything that is not a number — absent, null, array, object, string
  // (numeric strings included), boolean — is a parse-failure. No coercion, so
  // no hostile `valueOf` or `toString` is ever invoked.
  if (typeof value !== 'number') {
    return PARSE_FAILURE;
  }

  // 10.9: a number that is not an integer is a parse-failure. `Number.isInteger`
  // is false for `NaN`, `Infinity`, and `-Infinity`, so the non-finite values are
  // excluded here rather than needing a separate guard.
  if (!Number.isInteger(value)) {
    return PARSE_FAILURE;
  }

  // 10.9: an integer outside 0..2,147,483,647 inclusive is a parse-failure — it
  // is rejected, not clamped, because a count out of range means the response is
  // not the shape the contract promises.
  if (value < MIN_COUNT_VALUE || value > MAX_COUNT_VALUE) {
    return PARSE_FAILURE;
  }

  // `-0` is an integer within range and compares equal to `0`. Normalising it to
  // `0` keeps the parsed value a plain non-negative count, so a caller
  // formatting it can never render `-0`.
  return { kind: 'parsed', value: value === 0 ? 0 : value };
}

/**
 * Parse a count response body by reading one named member of it
 * (Requirements 7.6, 12.10).
 *
 * The body must be a plain object: `undefined`, `null`, an array, and every
 * primitive — a bare number included — are parse-failures. The named member is
 * then held to {@link parseNonNegativeInteger}. No other property is read, so a
 * field added to the response later changes nothing here.
 *
 * Total over every input and free of exceptions (Requirement 12.6).
 *
 * @param body the response body exactly as received, unasserted
 * @param member the member name carrying the count, a literal of this module
 *
 * Requirements: 7.6, 12.5, 12.6, 12.7, 12.10
 */
export function parseCountEnvelope(body: unknown, member: string): CountParse {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return PARSE_FAILURE;
  }

  return parseNonNegativeInteger(readMember(body as Record<string, unknown>, member));
}

/**
 * Parse an `UnreadCountResponse` body: `{ count }` (Requirements 7.1, 7.6).
 *
 * Requirements: 7.6, 12.10
 */
export function parseUnreadCountResponse(body: unknown): CountParse {
  return parseCountEnvelope(body, UNREAD_COUNT_MEMBER);
}

/**
 * Parse a `MarkAllReadResponse` body: `{ markedCount }` (Requirements 7.2, 7.6).
 *
 * Requirements: 7.6, 12.10
 */
export function parseMarkAllReadResponse(body: unknown): CountParse {
  return parseCountEnvelope(body, MARK_ALL_READ_MEMBER);
}

/**
 * A count rendered back into the wire shape {@link parseCountEnvelope} accepts
 * for `member` (Requirement 12.11).
 *
 * Total and exception-free. A value that is not an acceptable count is printed
 * as it stands, into a body its parser **rejects** rather than raising — an
 * unprintable count must not appear to round-trip.
 *
 * Requirements: 12.11
 */
export function printCountEnvelope(count: number, member: string): unknown {
  return { [member]: count };
}

/**
 * An Unread_Count rendered as an `UnreadCountResponse` body (Requirement 12.11).
 *
 * Requirements: 12.11
 */
export function printUnreadCountResponse(count: number): unknown {
  return printCountEnvelope(count, UNREAD_COUNT_MEMBER);
}

/**
 * A marked count rendered as a `MarkAllReadResponse` body (Requirement 12.11).
 *
 * Requirements: 12.11
 */
export function printMarkAllReadResponse(count: number): unknown {
  return printCountEnvelope(count, MARK_ALL_READ_MEMBER);
}

/**
 * One named member of a wire object, or `undefined` when the object carries no
 * such member.
 *
 * The read of a property is the only operation here an arbitrary input could
 * make raise, because a property can be defined as an accessor that throws.
 * Guarding it is what makes "never raises" absolute rather than conditional on
 * the body being ordinary JSON: a throwing member reads as absent, which the
 * value rule then turns into a parse-failure for the body carrying it
 * (Requirement 12.6).
 */
function readMember(source: Record<string, unknown>, member: string): unknown {
  try {
    return source[member];
  } catch {
    return undefined;
  }
}
