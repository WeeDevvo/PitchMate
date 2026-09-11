/**
 * The Squads_Feature's one syntactic identity check.
 *
 * Requirement 6.6 makes an unparseable `squadId` path segment a *presentation*
 * decision rather than an error: the Squad_Screen issues no `GetSquad` call and
 * renders the same Not_Found_Treatment it renders for a squad that does not
 * exist and for a squad the caller cannot reach. That is the point of the check —
 * a malformed identifier must be indistinguishable from an inaccessible squad,
 * so a person cannot probe identities by watching how the screen answers
 * (Property 13). The check is therefore a predicate with no failure reasons: a
 * caller only ever needs to know whether a request is worth issuing.
 *
 * The accepted form is the 36-character hyphenated identity the backend's GUID
 * v7 identities are serialised as — 8, 4, 4, 4, and 12 hexadecimal digits in
 * either letter case. Nothing else is accepted and nothing is repaired:
 *
 * | Candidate                                              | Accepted |
 * | ------------------------------------------------------ | -------- |
 * | `018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b`, any letter case | yes      |
 * | the 32-digit unhyphenated form                         | no       |
 * | a braced, parenthesised, or `urn:uuid:` form           | no       |
 * | a well-formed identity inside whitespace               | no       |
 * | a non-string of any type, absent included              | no       |
 *
 * Nothing is trimmed, because a value the route carried and a value sent to the
 * backend must be the same value: accepting `' 018f…'` would mean issuing a call
 * for an identity nobody supplied. Nothing is case-folded either, because the
 * identity is opaque to this feature.
 *
 * The predicate is **total**: every input of every type yields `true` or `false`
 * and raises nothing. Totality is structural rather than defensive — a `typeof`
 * test, a length comparison, and one non-global regular expression test on a
 * value already known to be a string. No value is coerced, so a hostile
 * `toString` or `valueOf` never runs, and there is no unknown structure to
 * recurse into.
 *
 * The same form is checked by the App_Shell's Squad_Scope normaliser. The pattern
 * is declared here rather than imported so that this module stays a leaf: `lib/`
 * is React-free, DOM-free, and free of `@pitchmate/api-client` (Requirement
 * 18.2), and the two declarations answer identically by construction because
 * both are pinned to the same stated form by their own properties.
 *
 * Requirements: 6.6
 */

/**
 * The length of the accepted identity form: 32 hexadecimal digits plus 4
 * hyphens. Tested before the pattern, so an arbitrarily long candidate is
 * rejected on a length comparison rather than by matching.
 */
export const SQUAD_IDENTIFIER_LENGTH = 36;

/**
 * The 36-character hyphenated identity form: 8, 4, 4, 4, and 12 hexadecimal
 * digits, either letter case. Anchored at both ends, so no surrounding
 * character is tolerated; neither global nor sticky, so it carries no
 * `lastIndex` state between calls.
 */
const SQUAD_IDENTIFIER_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a candidate squad identity is syntactically well formed and so worth a
 * `GetSquad` call.
 *
 * Total over every input and free of exceptions. Narrows to `string` so a caller
 * that has checked can pass the value on without re-asserting its type.
 *
 * @param candidate the `squadId` path segment exactly as the route carried it,
 *   unasserted — `undefined` when the segment is absent, and possibly any other
 *   value
 * @returns `true` only for a well-formed 36-character hyphenated identity
 *
 * Requirements: 6.6
 */
export function isSquadIdentifier(candidate: unknown): candidate is string {
  // 6.6: a value that is not a string — absent, `null`, a number, a boolean, an
  // array, an object, a boxed string — is not an identifier. No coercion is
  // attempted, so no accessor on the candidate runs.
  if (typeof candidate !== 'string') {
    return false;
  }

  // 6.6: the empty string and every string of the wrong length, whitespace-only
  // strings and the 32-digit unhyphenated form among them, are not identifiers.
  if (candidate.length !== SQUAD_IDENTIFIER_LENGTH) {
    return false;
  }

  // 6.6: a string of the right length that is not the hyphenated hexadecimal
  // form — wrong separators, hyphens in the wrong places, a non-hexadecimal
  // digit, a trailing space, 36 whitespace characters — is not an identifier.
  return SQUAD_IDENTIFIER_PATTERN.test(candidate);
}
