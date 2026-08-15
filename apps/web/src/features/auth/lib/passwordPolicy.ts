/**
 * Pure password-policy logic for the auth feature.
 *
 * Framework-free (no React, no DOM): this mirrors the client-side password
 * policy used by the Sign_Up and Reset_Confirm screens. The Password_Policy is
 * satisfied if and only if the password length falls within the inclusive band
 * [PASSWORD_MIN, PASSWORD_MAX].
 */

/** Minimum accepted password length (inclusive). */
export const PASSWORD_MIN = 12;

/** Maximum accepted password length (inclusive). */
export const PASSWORD_MAX = 128;

/**
 * The result of evaluating the Password_Policy against a password.
 *
 * `ok: true` when the length is within the accepted band; otherwise `ok: false`
 * with a `reason` distinguishing a too-short from a too-long password.
 */
export type PasswordValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'too-short' | 'too-long' };

/**
 * Evaluate the Password_Policy for a password.
 *
 * Satisfied (`ok: true`) if and only if `password.length` is between
 * PASSWORD_MIN and PASSWORD_MAX inclusive. Returns `too-short` when the length
 * is below PASSWORD_MIN and `too-long` when it exceeds PASSWORD_MAX.
 *
 * Requirements: 2.3, 6.3, 15.1, 15.6
 */
export function validatePassword(password: string): PasswordValidation {
  const { length } = password;
  if (length < PASSWORD_MIN) {
    return { ok: false, reason: 'too-short' };
  }
  if (length > PASSWORD_MAX) {
    return { ok: false, reason: 'too-long' };
  }
  return { ok: true };
}
