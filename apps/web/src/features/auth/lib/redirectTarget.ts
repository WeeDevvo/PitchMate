/**
 * Pure post-authentication redirect resolution for the web auth screens.
 *
 * Given a captured candidate Redirect_Target (from a pre-auth capture point
 * such as a query parameter or an in-memory hand-off), this resolves either a
 * validated same-origin in-app path or the configured default authenticated
 * route. It never returns a cross-origin destination.
 *
 * The module is framework-free (no React, no DOM, no `window` access) so it can
 * be property-tested in a browserless environment (Requirement 15.1). All
 * inputs are supplied by the caller; nothing is read from ambient state.
 */

/**
 * Configuration for {@link resolveRedirectTarget}.
 *
 * Requirements 11.3, 11.4, 11.5, 15.3, 15.4
 */
export interface RedirectResolutionConfig {
  /** The default authenticated route — itself a same-origin in-app path. */
  readonly defaultAuthenticatedRoute: string;
  /** Auth route paths to reject (e.g. `/signup`, `/login`, `/reset-password`). */
  readonly authRoutePaths: readonly string[];
  /** Maximum accepted candidate length, inclusive (e.g. 2048). */
  readonly maxLength: number;
}

/**
 * Resolve a captured candidate to a SAFE same-origin in-app path, or the
 * configured default authenticated route.
 *
 * A candidate is accepted (and returned unchanged) only when it is a safe
 * same-origin in-app path: a non-empty string that begins with a single `/`,
 * does not begin with `//` (protocol-relative), contains no backslashes (which
 * some browsers normalise to `/`), contains no control characters (which
 * browsers may strip), is within {@link RedirectResolutionConfig.maxLength}
 * characters, can be decoded without error, and whose path portion does not
 * match any configured authentication route.
 *
 * Every other input — absent, empty, over-length, undecodable, an absolute URL,
 * a protocol-relative URL, a cross-origin value, or a value resolving to an
 * auth route — resolves to the default authenticated route. The result is
 * therefore always a same-origin in-app path or the default route, and is
 * never a cross-origin destination.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 15.1, 15.3, 15.4
 */
export function resolveRedirectTarget(
  candidate: string | null | undefined,
  config: RedirectResolutionConfig,
): string {
  const fallback = config.defaultAuthenticatedRoute;

  // 11.2: absent or empty candidate falls back to the default route.
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return fallback;
  }

  // 11.3: over-length candidates are discarded.
  if (candidate.length > config.maxLength) {
    return fallback;
  }

  // 11.3: undecodable candidates (malformed percent-encoding) are discarded.
  let decoded: string;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    return fallback;
  }

  // 11.3, 11.4: both the raw candidate and its decoded form must be safe
  // same-origin in-app paths. Checking the decoded form unmasks percent-encoded
  // attacks such as `%2F%2Fevil.com` decoding to `//evil.com`.
  if (!isSafeInAppPath(candidate) || !isSafeInAppPath(decoded)) {
    return fallback;
  }

  // 11.5: a candidate resolving to an authentication route is discarded.
  if (
    isAuthRoute(candidate, config.authRoutePaths) ||
    isAuthRoute(decoded, config.authRoutePaths)
  ) {
    return fallback;
  }

  // 11.1: a valid same-origin in-app path is returned unchanged.
  return candidate;
}

/**
 * True iff `value` is a safe same-origin in-app path: it begins with a single
 * `/`, is not protocol-relative (`//`), and contains neither backslashes nor
 * control characters. Requiring a leading `/` inherently rejects absolute URLs
 * (`https://…`), scheme values (`javascript:…`), and bare relative paths.
 */
function isSafeInAppPath(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  // Must be an absolute in-app path; rejects absolute URLs, scheme prefixes,
  // and relative values.
  if (value[0] !== '/') {
    return false;
  }

  // Protocol-relative URL (e.g. `//evil.com`) is cross-origin.
  if (value[1] === '/') {
    return false;
  }

  // Backslashes can be normalised to `/` by browsers, enabling `/\evil.com`.
  if (value.includes('\\')) {
    return false;
  }

  // Control characters (including tab/CR/LF) may be stripped by browsers,
  // changing the effective destination.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(value)) {
    return false;
  }

  return true;
}

/**
 * True iff the path portion of `value` (ignoring any query string or fragment)
 * exactly matches one of the configured authentication routes.
 */
function isAuthRoute(value: string, authRoutePaths: readonly string[]): boolean {
  const pathOnly = value.split(/[?#]/, 1)[0];
  return authRoutePaths.includes(pathOnly);
}
