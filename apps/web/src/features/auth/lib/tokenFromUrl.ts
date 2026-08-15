/**
 * Pure token extraction from a URL search string for the web auth screens.
 *
 * Verification and password-reset links carry a one-time `token` in the query
 * string; this module reads that value from a supplied search string only. It
 * is framework-free (no React, no DOM, never touches `window.location`) so it
 * can be property-tested in a browserless environment (Requirement 15.1).
 */

/**
 * Extract the `token` query-string value from a URL/search string.
 *
 * The supplied string is parsed with the standard `URLSearchParams` API, which
 * tolerates an optional leading `?` and handles percent-decoding. Returns the
 * decoded `token` value when it is present and non-empty, otherwise null. Pure:
 * it reads only the supplied `search` string and never `window.location`.
 *
 * Requirements: 1.5, 1.6, 6.4, 7.7, 15.1
 */
export function extractToken(search: string): string | null {
  const token = new URLSearchParams(search).get('token');

  if (token === null || token.length === 0) {
    return null;
  }

  return token;
}
