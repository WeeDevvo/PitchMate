/**
 * The client-side validation of a Squad_Name and a Player_Display_Name: the *only*
 * two rules this feature applies to a name before submitting it.
 *
 * Requirement 3.4 fixes the shape — a pure function of a string depending on
 * neither React nor the DOM, yielding either an accepted trimmed value or a
 * **named** validation failure — so `components/CreateSquadForm.tsx` holds no
 * validation of its own and the rule can be stated without rendering a form.
 * Requirements 3.2 and 3.3 fix the rule itself: non-empty after trimming, at most
 * 100 characters after trimming, and the *trimmed* value is what gets submitted.
 *
 * **The rule is deliberately this thin.** Requirement 3.9 makes the backend the
 * authority on whether a name is acceptable, and a backend rejection is presented
 * as an *outcome* message rather than as a field validation message — so a
 * client-side rule that guessed at the backend's taste would silently block a name
 * the backend would have taken. What is checked here is exactly what the form can
 * know on its own: that something was typed, and that it fits the column. Anything
 * more — reserved words, character classes, the per-squad uniqueness of a display
 * name — belongs to the backend and comes back as
 * `DISPLAY_NAME_UNAVAILABLE`-style copy, not as a red field.
 *
 * **Length is counted after trimming**, and counted in the same unit the backend's
 * `MaxLength(100)` counts in: UTF-16 code units, which is what `String.length`
 * reports. So a 100-character name padded with spaces is accepted (the padding is
 * removed before counting), and a name of 100 astral characters — 200 code units —
 * is rejected here exactly as the backend would reject it. Counting grapheme
 * clusters instead would accept names the backend then refuses, which is the one
 * failure mode this bound exists to prevent.
 *
 * **The failure is named, not worded.** `'empty'` and `'too-long'` are identifiers
 * for the caller to map to a message from `lib/messages.ts` and associate with the
 * offending field (Requirement 3.3); no user-facing string is declared here, for
 * the same reason no other module under `lib/` declares one.
 *
 * The two exported functions apply one rule. They are separate exports rather than
 * one function with a field argument because the *call site* is what identifies the
 * field a message attaches to, and because the two names are governed by different
 * backend columns that could diverge — a divergence would then have a place to
 * live rather than needing a new signature.
 *
 * This module is React-free and DOM-free like every module under `lib/`, and
 * imports nothing at all (Requirement 18.2).
 *
 * Requirements: 3.2, 3.3, 3.4, 3.9
 */

/**
 * The longest accepted name, in UTF-16 code units, counted after trimming.
 *
 * Matches the backend's `MaxLength(100)` on both columns. Exported so the fields
 * that render these names can carry the same bound as a `maxLength` attribute
 * without restating the number.
 */
export const NAME_MAX_LENGTH = 100;

/**
 * Why a name was rejected.
 *
 * Two names, both of which a person can act on by editing the field — which is
 * what distinguishes them from a backend rejection, which the person can only act
 * on by choosing a different name.
 *
 * | Reason      | The input                                             |
 * | ----------- | ----------------------------------------------------- |
 * | `empty`     | is empty, or holds only whitespace                     |
 * | `too-long`  | exceeds {@link NAME_MAX_LENGTH} code units after trimming |
 */
export type NameValidationFailureReason = 'empty' | 'too-long';

/**
 * The result of validating a name: either the accepted trimmed value or one named
 * failure (Requirement 3.4).
 *
 * A discriminated union rather than `string | null`, so a caller cannot mistake a
 * failure for a value, and so the accepted member is the only thing in the type
 * that carries a submittable string. There is no third shape and no partial
 * value — the same discipline `lib/parse/` holds to.
 */
export type NameValidation =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: NameValidationFailureReason };

/**
 * The one rule both exported validators apply.
 *
 * Total and free of exceptions: a `typeof` guard on the candidate, one `trim`, and
 * one length comparison. The candidate is never coerced, so a value that is not a
 * string — which a form field should never produce, but which is not worth
 * trusting the type over — classifies as `'empty'` rather than raising.
 */
function validateName(input: string): NameValidation {
  // Guarded at runtime rather than trusted from the type, because the value
  // originates in a form field. Nothing typed is nothing entered.
  if (typeof input !== 'string') {
    return { ok: false, reason: 'empty' };
  }

  // 3.2: leading and trailing whitespace is removed *before* both the emptiness
  // test and the length test, and the trimmed value is what gets submitted — so a
  // name entered with a stray trailing space is accepted, and stored without it.
  const trimmed = input.trim();

  // 3.3: empty after trimming. A field of spaces is not a name.
  if (trimmed === '') {
    return { ok: false, reason: 'empty' };
  }

  // 3.3: longer than the backend's column after trimming. `>` rather than `>=`:
  // exactly 100 code units is accepted, which is the boundary the backend accepts.
  if (trimmed.length > NAME_MAX_LENGTH) {
    return { ok: false, reason: 'too-long' };
  }

  return { ok: true, value: trimmed };
}

/**
 * Validates a Squad_Name entered into the Create_Squad_Form.
 *
 * Pure, total, and free of exceptions; the same input always yields the same
 * result, and the accepted value is the input trimmed — never reshaped, recased,
 * or otherwise edited, because the backend stores what the person typed.
 *
 * @param input the field value exactly as entered
 * @returns the trimmed name to submit, or the named reason it cannot be
 *
 * Requirements: 3.2, 3.3, 3.4
 */
export function validateSquadName(input: string): NameValidation {
  return validateName(input);
}

/**
 * Validates a Player_Display_Name — the creator's own on the Create_Squad_Form,
 * the optional one on the Join_Code_Form, and a guest's on the Guest_Form, which
 * all share the same column and the same "non-empty after trimming" rule
 * (Requirements 3.2, 4.2, 12.2).
 *
 * Same rule and same guarantees as {@link validateSquadName}. In particular it
 * says nothing about whether the name is *available* within the squad: display
 * names are unique per squad, only the backend knows the squad's other names, and
 * a clash comes back as an outcome message rather than as a validation failure
 * (Requirement 3.9).
 *
 * @param input the field value exactly as entered
 * @returns the trimmed name to submit, or the named reason it cannot be
 *
 * Requirements: 3.2, 3.3, 3.4
 */
export function validateDisplayName(input: string): NameValidation {
  return validateName(input);
}
