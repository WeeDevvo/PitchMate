/**
 * Redirect_Capture — building the Log_In_Route target that carries the
 * requested shell path across an authentication.
 *
 * When a visitor addresses a shell route while the Auth_State is
 * `unauthenticated`, the Route_Guard navigates to the Log_In_Route and hands the
 * path the person actually asked for to the Auth_Feature, so that authenticating
 * returns them there rather than to the Default_Authenticated_Route
 * (Requirement 2.2). This module is the whole of that construction:
 *
 * - The requested path — **including any query string and fragment it carries**
 *   — is percent-encoded into a *single* query parameter value, so decoding that
 *   value yields the requested path character-for-character for a requested path
 *   of up to {@link MAX_CAPTURED_PATH_LENGTH} characters inclusive
 *   (Requirement 2.5). Encoding the whole path as one value is what makes the
 *   round trip exact: `?`, `#`, `&`, `=`, and `+` inside the requested path are
 *   escaped, so they cannot be mistaken for structure of the Log_In_Route's own
 *   query string.
 * - A requested path longer than {@link MAX_CAPTURED_PATH_LENGTH} characters
 *   yields the Log_In_Route with **no** parameter at all, so the Auth_Feature
 *   falls back to the Default_Authenticated_Route rather than being handed a
 *   truncated — and therefore wrong — destination (Requirement 2.7).
 *
 * The Log_In_Route path and the parameter name are **arguments**, never literals
 * declared here: they come from the Auth_Feature's public barrel (its log-in
 * route path and `REDIRECT_PARAM_NAME`), so the shell holds no copy of either
 * (Requirements 2.6, 15.2). That is also why this module performs no
 * redirect-target *resolution*: deciding whether a captured target is safe to
 * navigate to after authentication is the Auth_Feature's `resolveRedirectTarget`
 * and has exactly one implementation, there.
 *
 * The function is **total**: every input — including a value of the wrong type,
 * an absent value, and a string carrying an unpaired surrogate that
 * `encodeURIComponent` rejects — yields a string and raises no exception. Where
 * there is nothing capturable, the result is the Log_In_Route on its own, which
 * is always a valid place to send someone.
 *
 * This module is React-free and DOM-free like every module under `lib/`
 * (Requirements 14.16, 15.5): `encodeURIComponent` is an ECMAScript global, not
 * a DOM one.
 *
 * Requirements: 2.5, 2.6, 2.7
 */

/**
 * The longest requested path whose capture the Redirect_Capture parameter
 * carries. A requested path of exactly this many characters is captured; one
 * character more is dropped entirely (Requirements 2.5, 2.7).
 */
export const MAX_CAPTURED_PATH_LENGTH = 2048;

/**
 * Percent-encode one string, or report that it cannot be encoded.
 *
 * `encodeURIComponent` throws a `URIError` for a string containing an unpaired
 * surrogate. Such a string is not a reachable path, but totality does not admit
 * exceptions, so the failure is reported as a value instead (Requirement 14.12).
 */
function encodeOrNull(value: string): string | null {
  try {
    return encodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Build the Log_In_Route target for a requested shell path.
 *
 * @param requestedPath the shell path the person asked for, with any query
 *   string and fragment it carried
 * @param loginRoute the Auth_Feature's Log_In_Route path (Requirement 2.6)
 * @param paramName the Auth_Feature's Redirect_Capture parameter name
 *   (Requirement 2.6)
 * @returns the Log_In_Route carrying the requested path as a single
 *   percent-encoded parameter value, or the Log_In_Route alone where there is
 *   nothing to capture or the requested path exceeds
 *   {@link MAX_CAPTURED_PATH_LENGTH} characters
 */
export function loginRedirectTarget(
  requestedPath: string,
  loginRoute: string,
  paramName: string,
): string {
  // The Log_In_Route is the fallback for every case below, so it is normalised
  // first. A caller that supplies no usable route gets the empty string back
  // rather than an exception — the guard is total, and its caller passes the
  // Auth_Feature's exported route.
  const route = typeof loginRoute === 'string' ? loginRoute : '';

  if (typeof requestedPath !== 'string' || requestedPath.length === 0) {
    return route;
  }

  if (typeof paramName !== 'string' || paramName.length === 0) {
    return route;
  }

  // Requirement 2.7: too long to carry, so carry nothing.
  if (requestedPath.length > MAX_CAPTURED_PATH_LENGTH) {
    return route;
  }

  const encodedName = encodeOrNull(paramName);
  const encodedPath = encodeOrNull(requestedPath);

  if (encodedName === null || encodedPath === null) {
    return route;
  }

  // A fragment on the Log_In_Route itself must stay last, so the parameter is
  // inserted ahead of it. The Auth_Feature's route is a plain path today; this
  // keeps the construction correct rather than merely correct-by-accident.
  const fragmentAt = route.indexOf('#');
  const base = fragmentAt === -1 ? route : route.slice(0, fragmentAt);
  const fragment = fragmentAt === -1 ? '' : route.slice(fragmentAt);
  const separator = base.includes('?') ? '&' : '?';

  return `${base}${separator}${encodedName}=${encodedPath}${fragment}`;
}
