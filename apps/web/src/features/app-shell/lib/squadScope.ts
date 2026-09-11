/**
 * The App_Shell's single pure Squad_Scope normaliser.
 *
 * A Squad_Scope reaches the shell from outside the Shell_Frame — from a `squadId`
 * route parameter on a nested shell route, or from a hosting Destination_Content
 * calling `usePublishSquadScope` — so the value is untrusted. Requirement 7.1
 * fixes what happens to an unusable one: it is **not** an error. A value that is
 * absent, empty, whitespace-only, or not a well-formed squad identity means *no
 * Squad_Scope is active*, and the list, unread-count, and mark-all-read calls go
 * out with no squad identity, answering with the account-wide Notification_List
 * and Unread_Count rather than a failure message.
 *
 * That makes the whole decision a single mapping from any value to either an
 * identity or its absence:
 *
 * | Supplied value                                          | Normalised scope |
 * | ------------------------------------------------------- | ---------------- |
 * | a well-formed 36-character hyphenated identity          | that identity    |
 * | anything else — absent, empty, whitespace, malformed    | `null`           |
 *
 * `null` is the one representation of "no Squad_Scope", so `undefined`, `''`,
 * `'   '`, `'not-an-identity'`, a number, an array, and an object all collapse to
 * the same value and no caller has to distinguish them (Requirement 7.1).
 *
 * A well-formed identity is returned **exactly as supplied**, including its
 * letter case: the backend treats the identity as opaque, so normalising case
 * here would invent a value nobody supplied. Nothing is trimmed either — a
 * surrounding space makes a value 37 characters or breaks the pattern, and
 * accepting it would mean the identity sent to the backend differed from the one
 * the route carried.
 *
 * The function is **total**: every input yields either a string or `null` and
 * raises no exception. Totality is structural rather than defensive — a `typeof`
 * test, a length comparison, and one non-global regular expression test on a
 * value already known to be a string. Nothing is coerced to a string or a
 * number, so a hostile `toString` or `valueOf` never runs, and there is no
 * unknown structure to recurse into.
 *
 * This module is React-free and DOM-free like every module under `lib/`, and
 * imports nothing at all — in particular not `@pitchmate/api-client`
 * (Requirements 14.16, 15.5).
 *
 * Requirements: 7.1, 7.2
 */

/**
 * The length of the accepted identity form: 32 hexadecimal digits plus 4 hyphens
 * (Requirement 7.1). Tested before the pattern so an arbitrarily long string is
 * rejected on a length comparison rather than by matching.
 */
export const SQUAD_SCOPE_IDENTITY_LENGTH = 36;

/**
 * The 36-character hyphenated identity form: 8, 4, 4, 4, and 12 hexadecimal
 * digits, accepted in either letter case (Requirement 7.1). Anchored at both
 * ends, so no surrounding character is tolerated; neither global nor sticky, so
 * it carries no `lastIndex` state between calls.
 *
 * This is the same form the notification list parser accepts for the identities
 * it reads off the wire, kept declared here rather than shared so that neither
 * module reaches into the other's internals.
 */
const SQUAD_SCOPE_IDENTITY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normalise a supplied squad identity into the active Squad_Scope.
 *
 * Total over every input and free of exceptions.
 *
 * @param candidate the squad identity exactly as supplied by the requested shell
 *   route or the hosting Destination_Content, unasserted — `undefined` when
 *   absent, and possibly any other value
 * @returns the identity unchanged where it is a well-formed 36-character
 *   hyphenated identity, otherwise `null` meaning no Squad_Scope is active and
 *   the notification calls carry no squad identity
 *
 * Requirements: 7.1, 7.2
 */
export function normaliseSquadScope(candidate: unknown): string | null {
  // 7.1: a value that is not a string — absent, `null`, a number, a boolean, an
  // array, an object — leaves no Squad_Scope active. No coercion is attempted.
  if (typeof candidate !== 'string') {
    return null;
  }

  // 7.1: the empty string and every string of the wrong length, whitespace-only
  // strings among them, leave no Squad_Scope active.
  if (candidate.length !== SQUAD_SCOPE_IDENTITY_LENGTH) {
    return null;
  }

  // 7.1: a string of the right length that is not the hyphenated hexadecimal
  // form — wrong separators, a non-hexadecimal digit, a braced form, a trailing
  // space, 36 whitespace characters — leaves no Squad_Scope active.
  if (!SQUAD_SCOPE_IDENTITY_PATTERN.test(candidate)) {
    return null;
  }

  // 7.2: a well-formed identity becomes the active Squad_Scope, returned
  // character-for-character as supplied so the value sent to the backend is the
  // value the route carried.
  return candidate;
}
