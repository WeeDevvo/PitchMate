/**
 * The App_Shell's single pure non-negative integer parser.
 *
 * Two notification responses carry nothing but a count: the unread-count
 * response and the mark-all-read response. Requirement 10.9 asks for **one**
 * parser behind both, yielding either a non-negative integer from 0 to
 * 2,147,483,647 inclusive or a parse-failure outcome — and for the App_Shell to
 * treat a parse-failure as a failed call, so an unschematised body takes the
 * Generic_Notification_Failure path rather than becoming a nonsense badge.
 *
 * Everything that is not an integer in that range is rejected, explicitly
 * including an absent value, `null`, an array, an object, a string (a
 * *numeric* string included — `'7'` is not a number), a boolean, and a number
 * that is not an integer (Requirement 10.9). `NaN`, `Infinity`, and `-Infinity`
 * are not integers and so are rejected too.
 *
 * The function is **total**: every input yields one of the two outcomes and
 * raises no exception, including a value nested a hundred levels deep
 * (Requirement 10.12). Totality here is structural rather than defensive — the
 * body is a `typeof` test plus arithmetic comparisons on a value already known
 * to be a number, so there is nothing to recurse into and nothing to coerce. No
 * input is converted to a string or a number, so a hostile `toString` or
 * `valueOf` never runs.
 *
 * This module is React-free and DOM-free like every module under `lib/`
 * (Requirements 14.16, 15.5), and imports nothing at all.
 *
 * Requirements: 10.9, 10.12
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
 * The outcome of parsing a count response body: exactly one non-negative
 * integer, or the parse-failure outcome (Requirements 10.9, 10.12).
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
 * Parse an unread-count or mark-all-read response body into a non-negative
 * integer.
 *
 * Total over every input and free of exceptions (Requirement 10.12).
 *
 * @param body the response body exactly as received, unasserted
 * @returns the parsed count for an integer in
 *   {@link MIN_COUNT_VALUE}..{@link MAX_COUNT_VALUE} inclusive, otherwise the
 *   parse-failure outcome
 *
 * Requirements: 10.9, 10.12
 */
export function parseNonNegativeInteger(body: unknown): CountParse {
  // 10.9: anything that is not a number — absent, null, array, object, string
  // (numeric strings included), boolean — is a parse-failure. No coercion, so
  // no hostile `valueOf` or `toString` is ever invoked.
  if (typeof body !== 'number') {
    return PARSE_FAILURE;
  }

  // 10.9: a number that is not an integer is a parse-failure. `Number.isInteger`
  // is false for `NaN`, `Infinity`, and `-Infinity`, so the non-finite values are
  // excluded here rather than needing a separate guard.
  if (!Number.isInteger(body)) {
    return PARSE_FAILURE;
  }

  // 10.9: an integer outside 0..2,147,483,647 inclusive is a parse-failure — it
  // is rejected, not clamped, because a count out of range means the response is
  // not the shape the contract promises.
  if (body < MIN_COUNT_VALUE || body > MAX_COUNT_VALUE) {
    return PARSE_FAILURE;
  }

  // `-0` is an integer within range and compares equal to `0`. Normalising it to
  // `0` keeps the parsed value a plain non-negative count, so a caller
  // formatting it can never render `-0`.
  return { kind: 'parsed', value: body === 0 ? 0 : body };
}
