/**
 * Pure email-validation logic for the web auth screens.
 *
 * This mirrors the backend's email policy purely for client-side UX feedback —
 * the server remains the single source of truth and its result always wins.
 * The module is framework-free (no React, no DOM) so it can be property-tested
 * in a browserless environment (Requirement 15.1).
 */

/** The outcome of validating a candidate Email_Address. */
export type EmailValidation =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: 'empty' | 'too-long' | 'malformed' };

/** Maximum length of a trimmed Email_Address, inclusive. */
export const EMAIL_MAX_LENGTH = 254;

/**
 * Validate a candidate Email_Address, mirroring backend policy for UX only.
 *
 * The input is trimmed first; the trimmed string is the reported `value` on
 * success. It is valid if and only if, after trimming, it is 1 to 254
 * characters and contains exactly one `"@"` separating a non-empty local part
 * from a domain composed of dot-separated labels that are each non-empty.
 *
 * Failure reasons are reported in priority order:
 * - `empty` when the trimmed length is 0;
 * - `too-long` when the trimmed length exceeds {@link EMAIL_MAX_LENGTH};
 * - `malformed` when the structural `local-part@domain` shape is not met.
 *
 * Requirements: 2.4, 3.3, 5.3, 15.1, 15.7
 */
export function validateEmail(raw: string): EmailValidation {
  const value = raw.trim();

  if (value.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  if (value.length > EMAIL_MAX_LENGTH) {
    return { ok: false, reason: 'too-long' };
  }

  if (!hasValidShape(value)) {
    return { ok: false, reason: 'malformed' };
  }

  return { ok: true, value };
}

/**
 * True iff the trimmed candidate has exactly one `"@"` separating a non-empty
 * local part from a domain of dot-separated, each-non-empty labels.
 */
function hasValidShape(value: string): boolean {
  const atIndex = value.indexOf('@');

  // Exactly one "@": the first must exist and be the only one.
  if (atIndex === -1 || value.indexOf('@', atIndex + 1) !== -1) {
    return false;
  }

  const localPart = value.slice(0, atIndex);
  const domain = value.slice(atIndex + 1);

  if (localPart.length === 0 || domain.length === 0) {
    return false;
  }

  // Domain is one or more dot-separated labels, each non-empty. This rejects a
  // leading dot, a trailing dot, and any consecutive dots.
  return domain.split('.').every((label) => label.length > 0);
}
